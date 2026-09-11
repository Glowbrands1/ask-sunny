/**
 * THE ANALYTICS FILTERS, and the URL they live in.
 *
 * Held in the query string rather than in React state, for three reasons that
 * all turned out to matter: a filtered view is a link somebody can send to the
 * DM it concerns, the server renders the page so the filters have to arrive
 * with the request, and switching between Overview, By Location, By Leader and
 * Usage Types must not silently drop what was filtered — the tabs are links
 * carrying the same search params.
 *
 * Client-safe. No database client, no secret, no server-only import.
 */

import { ROLES } from "@/lib/permissions";
import type { Role } from "@/types";

/* ------------------------------------------------------------ windows ---- */

export const DATE_RANGES = [
  { key: "7d", label: "Last 7 days", days: 7 },
  { key: "30d", label: "Last 30 days", days: 30 },
  { key: "90d", label: "Last 90 days", days: 90 },
  { key: "mtd", label: "This month", days: null },
  { key: "ytd", label: "This year", days: null },
] as const;

export type DateRangeKey = (typeof DATE_RANGES)[number]["key"];

export const DEFAULT_RANGE: DateRangeKey = "30d";

export function isDateRangeKey(value: unknown): value is DateRangeKey {
  return DATE_RANGES.some((range) => range.key === value);
}

export function rangeLabel(key: DateRangeKey): string {
  return DATE_RANGES.find((range) => range.key === key)?.label ?? key;
}

export interface AnalyticsFilters {
  range: DateRangeKey;
  /** A custom window overrides `range` when both ends parse. */
  from: string | null;
  to: string | null;
  district: string | null;
  salonId: string | null;
  role: Role | null;
  actorId: string | null;
  /**
   * Show only the rows with no activity in the window.
   *
   * A VIEW FILTER, not a query filter, and the distinction is deliberate: the
   * database functions already return every salon and every leader including
   * the silent ones, so "inactive only" is a predicate over rows that have
   * already arrived rather than a seventh argument on five SQL functions. It
   * cannot change a total, which is what keeps "3 of 15 active" honest while
   * the table below it shows twelve rows.
   */
  inactiveOnly: boolean;
}

export const EMPTY_FILTERS: AnalyticsFilters = {
  range: DEFAULT_RANGE,
  from: null,
  to: null,
  district: null,
  salonId: null,
  role: null,
  actorId: null,
  inactiveOnly: false,
};

/** True when anything is narrowing the view, which is what Reset clears. */
export function hasActiveFilters(filters: AnalyticsFilters): boolean {
  return (
    filters.district !== null ||
    filters.salonId !== null ||
    filters.role !== null ||
    filters.actorId !== null ||
    filters.from !== null ||
    filters.to !== null ||
    filters.inactiveOnly ||
    filters.range !== DEFAULT_RANGE
  );
}

/* ------------------------------------------------------------ parsing ---- */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function first(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

/**
 * Read the filters out of a request's search params.
 *
 * EVERY VALUE IS VALIDATED INTO ITS OWN TYPE OR DROPPED. `salon` and `leader`
 * must look like uuids and `role` must be a role this build knows, because both
 * are passed to a database function as typed arguments — a junk value should
 * come back as "no filter" rather than as an error page from Postgres, and an
 * unparsed string must never reach a query.
 *
 * A malformed filter is silently ignored rather than reported. The alternative
 * is an error screen for a hand-edited URL, which helps nobody: the filter bar
 * shows what is actually in force, so a dropped value is visible there.
 */
export function parseFilters(
  params: Record<string, string | string[] | undefined>,
): AnalyticsFilters {
  const rangeRaw = first(params.range);
  const fromRaw = first(params.from);
  const toRaw = first(params.to);
  const roleRaw = first(params.role);
  const salonRaw = first(params.salon);
  const leaderRaw = first(params.leader);
  const districtRaw = first(params.district);
  const inactiveRaw = first(params.inactive);

  const from = fromRaw && ISO_DATE.test(fromRaw) ? fromRaw : null;
  const to = toRaw && ISO_DATE.test(toRaw) ? toRaw : null;

  return {
    range: isDateRangeKey(rangeRaw) ? rangeRaw : DEFAULT_RANGE,
    /*
     * BOTH ENDS OR NEITHER. One end of a custom window is not a window, and
     * honouring it would silently pair a typed date with a default the user
     * never chose.
     */
    from: from && to ? from : null,
    to: from && to ? to : null,
    district: districtRaw && districtRaw.trim() !== "" ? districtRaw : null,
    salonId: salonRaw && UUID.test(salonRaw) ? salonRaw : null,
    role: ROLES.includes(roleRaw as Role) ? (roleRaw as Role) : null,
    actorId: leaderRaw && UUID.test(leaderRaw) ? leaderRaw : null,
    /* Exactly "1", so a stray `?inactive=maybe` is off rather than on. */
    inactiveOnly: inactiveRaw === "1",
  };
}

/** The inverse: filters back into a query string, omitting everything unset. */
export function serializeFilters(filters: AnalyticsFilters): string {
  const params = new URLSearchParams();
  if (filters.range !== DEFAULT_RANGE) params.set("range", filters.range);
  if (filters.from && filters.to) {
    params.set("from", filters.from);
    params.set("to", filters.to);
  }
  if (filters.district) params.set("district", filters.district);
  if (filters.salonId) params.set("salon", filters.salonId);
  if (filters.role) params.set("role", filters.role);
  if (filters.actorId) params.set("leader", filters.actorId);
  if (filters.inactiveOnly) params.set("inactive", "1");
  return params.toString();
}

/* ------------------------------------------------------------ windows ---- */

export interface ResolvedWindow {
  /** Inclusive start, as an ISO instant. */
  from: string;
  /** EXCLUSIVE end — the queries use `< to`, so a day is never double-counted. */
  to: string;
  /** The comparable preceding window, for "vs the prior period". */
  previousFrom: string;
  previousTo: string;
  /** Whole days covered, which decides the trend bucket. */
  days: number;
  label: string;
}

/**
 * Turn the filters into two concrete windows: the one asked for, and the
 * comparable one before it.
 *
 * THE COMPARISON WINDOW IS THE SAME LENGTH, IMMEDIATELY BEFORE. That is what
 * makes "vs the prior period" a fair statement rather than a flattering one —
 * a 30-day window is compared against the 30 days before it, not against a
 * calendar month of a different length.
 *
 * `anchor` is the business day, not the host's: the app decides what "today" is
 * in the salons' timezone, and an analytics window that rolled over at 8pm
 * Eastern would put this evening's activity into tomorrow.
 */
export function resolveWindow(
  filters: AnalyticsFilters,
  anchorIsoDate: string,
): ResolvedWindow {
  const endExclusive = startOfUtcDay(addDays(anchorIsoDate, 1));

  if (filters.from && filters.to) {
    const from = startOfUtcDay(filters.from);
    /* Inclusive to the user, exclusive to the query: they picked a last day. */
    const to = startOfUtcDay(addDays(filters.to, 1));
    const days = Math.max(1, Math.round((to - from) / DAY_MS));
    return {
      from: new Date(from).toISOString(),
      to: new Date(to).toISOString(),
      previousFrom: new Date(from - days * DAY_MS).toISOString(),
      previousTo: new Date(from).toISOString(),
      days,
      label: `${filters.from} to ${filters.to}`,
    };
  }

  const start = windowStart(filters.range, anchorIsoDate, endExclusive);
  const days = Math.max(1, Math.round((endExclusive - start) / DAY_MS));

  return {
    from: new Date(start).toISOString(),
    to: new Date(endExclusive).toISOString(),
    previousFrom: new Date(start - days * DAY_MS).toISOString(),
    previousTo: new Date(start).toISOString(),
    days,
    label: rangeLabel(filters.range),
  };
}

/**
 * Daily up to about a quarter, weekly up to two years, monthly beyond.
 *
 * The point is readability, not precision: 365 daily points on a chart the width
 * of a card is a texture rather than a trend.
 */
export function bucketFor(days: number): "day" | "week" | "month" {
  if (days <= 92) return "day";
  if (days <= 730) return "week";
  return "month";
}

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfUtcDay(isoDate: string): number {
  return Date.parse(`${isoDate}T00:00:00.000Z`);
}

function addDays(isoDate: string, days: number): string {
  const shifted = new Date(startOfUtcDay(isoDate) + days * DAY_MS);
  return shifted.toISOString().slice(0, 10);
}

function windowStart(
  range: DateRangeKey,
  anchorIsoDate: string,
  endExclusive: number,
): number {
  const fixed = DATE_RANGES.find((entry) => entry.key === range)?.days ?? null;
  if (fixed !== null) return endExclusive - fixed * DAY_MS;

  const [year, month] = anchorIsoDate.split("-");
  if (range === "mtd") return startOfUtcDay(`${year}-${month}-01`);
  return startOfUtcDay(`${year}-01-01`);
}
