import type { BedSpaPeriod } from "./types";

/**
 * PERIOD IDENTITY AND DISPLAY, WITH NO SERVER DEPENDENCY.
 *
 * Split out of `read.ts` because the filter bar is a CLIENT component and needs
 * the period token and the option type — and `read.ts` carries
 * `import "server-only"`, which correctly turns that into a build failure. The
 * split is the fix rather than relaxing the guard: nothing here touches
 * Supabase, the filesystem or a secret, and everything that does stays behind
 * the guard.
 *
 * THE TOKEN CARRIES ITS GRAIN, and that is the whole reason this is not just a
 * date. MTD, YTD and LTM through 31 August are three periods ending on the same
 * day, covering one month, eight months and twelve months of sessions. A bare
 * date in a URL names one of the three at random, so it is refused and the page
 * falls back to the newest period instead — which is what an unqualified link
 * should mean.
 */

/** One period offered in a report's Period control. */
export interface BedSpaPeriodOption extends BedSpaPeriod {
  readonly periodId: string;
  /** What the control shows, e.g. `MTD · Aug 2026`. */
  readonly label: string;
  readonly ingestedAt: string | null;
  /** How many salons the period covers, counted from the live facts. */
  readonly salonCount: number;
}

export const GRAIN_LABEL: Readonly<Record<string, string>> = {
  mtd: "MTD",
  ytd: "YTD",
  ltm: "LTM",
};

export const GRAIN_SENTENCE: Readonly<Record<string, string>> = {
  mtd: "Month to date",
  ytd: "Year to date",
  ltm: "Last twelve months",
};

/** `2026-08-31` -> `Aug 2026`, in UTC so the month never shifts. */
export function monthLabel(periodEnd: string): string {
  const [year, month, day] = periodEnd.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** `2026-08-31` -> `Aug 31, 2026`. Always UTC. */
export function formatBedSpaDate(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * `Sep 8, 2026 10:24 UTC`, from the STORED ingestion timestamp.
 *
 * Never the render clock: a "loaded" time that moves when the page is refreshed
 * is not a provenance claim.
 */
export function formatLoadedAt(iso: string | null): string {
  if (!iso) return "load time not recorded";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "load time not recorded";
  return `${date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  })} ${date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  })} UTC`;
}

/**
 * What the Period control shows.
 *
 * LTM names both ends, because "LTM · Aug 2026" would look identical to that
 * month's own MTD row in a dropdown while covering twelve times as much.
 */
export function periodLabel(grain: string, periodStart: string, periodEnd: string): string {
  const grainText = GRAIN_LABEL[grain] ?? grain.toUpperCase();
  if (grain === "ltm") {
    return `${grainText} · ${monthLabel(periodStart)} – ${monthLabel(periodEnd)}`;
  }
  return `${grainText} · ${monthLabel(periodEnd)}`;
}

/** `2026-09-17` -> `{year: 2026, month: 9, day: 17}`, or null if not a plain ISO date. */
function isoParts(iso: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? "");
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

/** `Sep`, in UTC so the month never shifts. */
function shortMonth(parts: { year: number; month: number; day: number }): string {
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).toLocaleDateString("en-US", {
    month: "short",
    timeZone: "UTC",
  });
}

/**
 * ============================================================================
 * WHAT THE SPA ENGAGEMENT PERIOD CONTROL SHOWS
 * ============================================================================
 *
 * A SEPARATE FORMATTER, AND NOT A CHANGE TO `periodLabel`, because that one is
 * shared with Bed Usage and SPA Wellness and both read correctly today. Bed
 * Usage delivers one period per month and SPA Wellness three windows that each
 * end on the month's last day, so naming the month tells their readers which
 * row is which. Spa Engagement does not work that way.
 *
 * THE PROBLEM THIS SOLVES. Spa Engagement arrives MONTH TO DATE, several times
 * within the same month, and every one of those deliveries is an `mtd` period
 * in September 2026. The shared label names only the month, so
 *
 *     2026-09-01 -> 2026-09-01     MTD · Sep 2026
 *     2026-09-01 -> 2026-09-17     MTD · Sep 2026
 *
 * are two different windows — one day against seventeen — that a reader cannot
 * tell apart in the dropdown, and cannot tell apart once selected either.
 *
 * SO THE RANGE IS NAMED, THE WAY THE WORKBOOK NAMES IT. Its own heading reads
 * `Spa Sessions per Unique Tanner per Spa Bed: 9/1 - 9/17`, so the control says
 * `MTD · Sep 1–17, 2026` and a single-day period says `MTD · Sep 1, 2026`.
 *
 * THE DATES ARE THE STORED ONES. `period_start` and `period_end` as ingested —
 * never the filename, never the render clock. This function is display only:
 * period identity, the URL token and selection are all unchanged and still key
 * on grain and `period_end`.
 *
 * AN UNREADABLE DATE FALLS BACK to the shared label rather than guessing. A
 * coarse label is recoverable; an invented range is not.
 */
export function spaEngagementPeriodLabel(
  grain: string,
  periodStart: string,
  periodEnd: string,
): string {
  const start = isoParts(periodStart);
  const end = isoParts(periodEnd);
  if (!start || !end) return periodLabel(grain, periodStart, periodEnd);

  const grainText = GRAIN_LABEL[grain] ?? grain.toUpperCase();

  // One day. `Sep 1–1` would be a range that is not one.
  if (periodStart === periodEnd) return `${grainText} · ${formatBedSpaDate(periodEnd)}`;

  // The ordinary case: a month-to-date window inside one month.
  if (start.year === end.year && start.month === end.month) {
    return `${grainText} · ${shortMonth(end)} ${start.day}–${end.day}, ${end.year}`;
  }

  // Wider windows are not what this report delivers today, but a formatter
  // that only handles its expected input is a formatter that prints nonsense
  // the first time the input widens.
  if (start.year === end.year) {
    return `${grainText} · ${shortMonth(start)} ${start.day} – ${shortMonth(end)} ${end.day}, ${end.year}`;
  }
  return `${grainText} · ${formatBedSpaDate(periodStart)} – ${formatBedSpaDate(periodEnd)}`;
}

/** The token a URL carries. Grain AND date, never a bare date. */
export function periodToken(period: { grain: string; periodEnd: string }): string {
  return `${period.grain}:${period.periodEnd}`;
}

/** Parses a `grain:date` token. A bare date is not accepted — see above. */
export function parsePeriodToken(
  token: string | null | undefined,
): { grain: string; periodEnd: string } | null {
  if (!token) return null;
  const match = /^(mtd|ytd|ltm):(\d{4}-\d{2}-\d{2})$/.exec(token.trim().toLowerCase());
  return match ? { grain: match[1], periodEnd: match[2] } : null;
}

/**
 * Resolves the period a URL asked for against the periods that exist.
 *
 * Falls back to the NEWEST rather than refusing, and reports whether it had to —
 * the page says so, because a stale bookmark silently showing a different month
 * is worse than one that explains itself.
 */
export function resolvePeriod(
  token: string | null | undefined,
  options: readonly BedSpaPeriodOption[],
): { period: BedSpaPeriodOption | null; fellBack: boolean } {
  if (options.length === 0) return { period: null, fellBack: false };
  const requested = parsePeriodToken(token);
  if (!requested) return { period: options[0], fellBack: Boolean(token) };
  const exact = options.find(
    (option) => option.grain === requested.grain && option.periodEnd === requested.periodEnd,
  );
  return exact ? { period: exact, fellBack: false } : { period: options[0], fellBack: true };
}

/**
 * The period in another report that MATCHES this one, or null.
 *
 * Matched on grain AND both dates, because two periods can end on the same day
 * and cover eight times the traffic. Null is the honest answer that makes a
 * dashboard show `N/A` with a reason instead of a plausible number — and it is
 * the LIVE case in the supplied material, where the Bed Usage report covers all
 * of August and the engagement report covers 1 September.
 */
export function matchingPeriod(
  target: BedSpaPeriod,
  candidates: readonly BedSpaPeriodOption[],
): BedSpaPeriodOption | null {
  return (
    candidates.find(
      (candidate) =>
        candidate.grain === target.grain &&
        candidate.periodStart === target.periodStart &&
        candidate.periodEnd === target.periodEnd,
    ) ?? null
  );
}

/**
 * The newest period present in BOTH of two reports, or null.
 *
 * The Spa Conversion Rate needs Bed Usage traffic and SPA Wellness sessions
 * over the SAME window, and the three reports arrive on their own schedules —
 * in the supplied deliveries the engagement report covers a single day in
 * September while the other two cover August. So the combined view resolves its
 * OWN period rather than inheriting whichever tab it happens to sit on: the
 * most recent window both halves of the metric actually cover.
 *
 * Matched on grain and both dates, for the reason `matchingPeriod` gives.
 * Ordering is the caller's — both lists arrive newest first — so the first
 * match is the newest.
 */
export function newestSharedPeriod(
  left: readonly BedSpaPeriodOption[],
  right: readonly BedSpaPeriodOption[],
): { left: BedSpaPeriodOption; right: BedSpaPeriodOption } | null {
  for (const candidate of left) {
    const match = matchingPeriod(candidate, right);
    if (match) return { left: candidate, right: match };
  }
  return null;
}
