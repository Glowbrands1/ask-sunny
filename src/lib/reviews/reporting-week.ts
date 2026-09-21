import { shiftDays, weekdayOf } from "@/lib/business-date";
import { GOOGLE_REVIEWS_TIMEZONE, googleReviewsToday } from "./timezone";

/**
 * THE WEEKLY REPORTING PERIOD FOR GOOGLE REVIEWS.
 *
 * Sunday to Saturday, in CENTRAL — `GOOGLE_REVIEWS_TIMEZONE`, which this
 * feature owns and `src/lib/reviews/timezone.ts` explains. The shape is the US
 * retail week `businessWeekEnd()` already uses for follow-ups; the ZONE is this
 * report's own, because the weekly count is reconciled against Google by hand
 * by people working Central. This module is the TypeScript half;
 * `public.google_review_week_start()` is the SQL half, and the two MUST agree
 * about the zone or a Saturday-evening review lands in a different week on the
 * dashboard than in the database. `reporting-week.test.ts` reads the migration
 * as text and asserts they do.
 *
 * WHY THE WEEK IS KEYED ON WHEN A REVIEW WAS FIRST SEEN. The legacy process
 * opens each Google listing, finds the reviewer who was last counted, and
 * counts everything above them — which measures reviews that APPEARED since the
 * last count, not reviews posted in a calendar window. Google's interface gives
 * "7 hours ago" rather than a timestamp, so a posting time is not reliably
 * available anyway. First-seen is the same measure the manual count makes, and
 * it is knowable exactly.
 *
 * Client-safe: no database client, no secret, no server-only import.
 */

/** `yyyy-mm-dd` of the Sunday that opens the week containing an ISO date. */
export function weekStartOf(isoDate: string): string {
  return shiftDays(isoDate, -weekdayOf(isoDate));
}

/** `yyyy-mm-dd` of the Saturday that closes the week a Sunday opens. */
export function weekEndOf(weekStart: string): string {
  return shiftDays(weekStart, 6);
}

/** The Sunday that opens the current business week. */
export function currentWeekStart(today: string = googleReviewsToday()): string {
  return weekStartOf(today);
}

/**
 * The `count` most recent week-start dates, oldest first, ending with the
 * current week. Twelve of these is the trend chart's x-axis.
 */
export function recentWeekStarts(count: number, today: string = googleReviewsToday()): string[] {
  const current = currentWeekStart(today);
  const weeks: string[] = [];
  for (let index = count - 1; index >= 0; index -= 1) {
    weeks.push(shiftDays(current, -7 * index));
  }
  return weeks;
}

/** The first day of the current month, in the business zone. `yyyy-mm-01`. */
export function monthStart(today: string = googleReviewsToday()): string {
  return `${today.slice(0, 7)}-01`;
}

/**
 * A week rendered for a person: "Sep 13 – Sep 19".
 *
 * `timeZone: "UTC"` is not a mistake and not a contradiction of
 * GOOGLE_REVIEWS_TIMEZONE. The input is a CALENDAR DATE that has already been
 * decided in Central; parsing `2026-09-13` gives UTC midnight, and formatting
 * that instant in any westward zone would print the 12th. The date is a label
 * by this point, so it is formatted as one.
 */
export function formatWeekRange(weekStart: string): string {
  const start = new Date(`${weekStart}T00:00:00Z`);
  const end = new Date(`${weekEndOf(weekStart)}T00:00:00Z`);
  const format = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  return `${format.format(start)} – ${format.format(end)}`;
}

/** `yyyy-mm-dd` is the only shape a week key may take. */
export const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Re-exported so callers do not have to know which module owns the zone. */
export { GOOGLE_REVIEWS_TIMEZONE };
