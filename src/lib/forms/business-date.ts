/**
 * WHICH "TODAY" A FOLLOW-UP IS MEASURED AGAINST.
 *
 * This module exists because two of the app's existing date conventions are
 * both right and neither is usable here:
 *
 *   `src/lib/utils/date.ts` measures everything against DEMO_ANCHOR, a fixed
 *   instant, so the prototype's relative text ("in 3 days") is identical on the
 *   server and in the browser and identical at every presentation. Follow-ups
 *   are real persisted records with real dates, so measuring them against a
 *   frozen August anchor would call a form due next week "overdue" for as long
 *   as the anchor stayed put. Nothing here touches DEMO_ANCHOR.
 *
 *   The reporting layer keeps ISO dates in UTC and infers no zone at all, which
 *   is correct for a workbook: a period is a label, not a moment. A follow-up
 *   IS a moment — "is this late?" is asked at a salon, in the morning, in the
 *   United States — so UTC is the wrong ruler. At 8pm Eastern the UTC date has
 *   already rolled over, and a form due tomorrow would show as overdue that
 *   evening. That is precisely the failure this module prevents.
 *
 * So: one business timezone, one business date, computed from the real clock.
 *
 * THE ZONE IS EXPLICIT AND OVERRIDABLE. It is not read from the host, because
 * the host is a container in some region and has nothing to do with where the
 * salons are. `NEXT_PUBLIC_` so the same value is available on both sides of
 * the render and the server and the browser can never disagree about what day
 * it is.
 *
 * The default is US Eastern. Sun Tan City operates across US zones, so no
 * single choice is exactly local everywhere; what matters is that it is a
 * BUSINESS zone rather than UTC, and that it is one value everything agrees on.
 * A salon an hour west sees a form become overdue an hour before its own
 * midnight, which is an hour of skew instead of four or five.
 */

/** The zone every follow-up date is judged in. Override per deployment. */
export const BUSINESS_TIMEZONE =
  process.env.NEXT_PUBLIC_BUSINESS_TIMEZONE?.trim() || "America/New_York";

/**
 * The business date as ISO `yyyy-mm-dd`.
 *
 * `en-CA` is not decoration: that locale formats as `2026-09-04`, which is the
 * ISO order, so no month/day reassembly is needed and no ambiguity can creep
 * in. `Intl` does the zone conversion, which is the only thing in the platform
 * that knows when daylight saving moved.
 */
export function businessToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Days between two ISO dates. Negative when `date` is before `from`. */
export function daysBetween(from: string, date: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return Number.NaN;
  // Both are UTC midnights of calendar dates, so this is whole days with no
  // daylight-saving arithmetic to get wrong.
  return Math.round((b - a) / 86_400_000);
}

/** Which day of the week an ISO date falls on, 0 = Sunday. */
export function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/** An ISO date shifted by whole days. */
export function shiftDays(date: string, days: number): string {
  const shifted = new Date(`${date}T00:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

/**
 * The last day of the business week containing `date`.
 *
 * SUNDAY TO SATURDAY, the US retail week — the one salon schedules and weekly
 * review numbers are already read in. It matters for exactly one thing: what
 * "due this week" means on the Overview. On a Thursday it reaches to Saturday;
 * on a Saturday "this week" is today, and next Monday's follow-up is next
 * week's problem rather than being quietly folded into today's count.
 */
export function businessWeekEnd(date: string): string {
  return shiftDays(date, 6 - weekdayOf(date));
}
