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
