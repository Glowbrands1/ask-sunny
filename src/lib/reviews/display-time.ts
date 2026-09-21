import { GOOGLE_REVIEWS_TIMEZONE } from "./timezone";

/**
 * EVERY GOOGLE REVIEWS TIMESTAMP, RENDERED IN CENTRAL TIME.
 *
 * ============================================================================
 * THE DEFECT THIS EXISTS TO END
 * ============================================================================
 *
 * The provenance chip read "Last sync 9/21/2026, 12:25:37 PM" at 9:10 in the
 * morning Central — a sync that had not happened yet. Nothing was wrong with
 * the stored value. `google_review_sync_runs.started_at` is `timestamptz`, so
 * Postgres holds it in UTC and PostgREST hands it back with its offset intact
 * (`2026-09-21T12:25:37+00:00`). The chip then called
 *
 *     new Date(value).toLocaleString()
 *
 * with NO LOCALE AND NO ZONE. `Date` parsed the offset correctly; the FORMATTER
 * is what went wrong, because with no `timeZone` it renders in whatever zone
 * the host process is in — and the host is a serverless container in UTC. The
 * screen is a React Server Component, so the UTC string was baked into the HTML
 * and the browser never got a chance to disagree. 12:25 UTC is 7:25 a.m.
 * Central; the page was five hours ahead of the people reading it, which on a
 * morning sync reads as a timestamp from the future.
 *
 * ============================================================================
 * THE ZONE IS `America/Chicago`, NOT AN OFFSET, AND NOT A SECOND CONSTANT
 * ============================================================================
 *
 * Central is UTC-6 in winter and UTC-5 in summer, so subtracting a fixed five
 * hours is right for half the year and an hour wrong for the other half. The
 * IANA zone knows when the transition is and `timeZoneName: "short"` labels the
 * result CDT or CST accordingly, so the chip never has to be told which.
 *
 * THE ZONE IS IMPORTED, NEVER REDECLARED. `GOOGLE_REVIEWS_TIMEZONE` is the one
 * this feature owns, and it is the SAME value the reporting week is assigned in
 * — so the chip, the audit trail and the week a review counts toward cannot
 * disagree about where Central is. `display-time.test.ts` also pins it against
 * `REPORTING_TIME_ZONE`, the zone the rest of the product already renders
 * timestamps in, because two Central-time constants drifting apart is how two
 * screens in one product start disagreeing about what time it is, each of them
 * internally consistent.
 *
 * ============================================================================
 * WHAT THIS MODULE DOES NOT DO
 * ============================================================================
 *
 * It does not clamp, floor or otherwise correct the instant it is given, and it
 * never substitutes `Date.now()`. A displayed time in the future after this
 * change means the STORED timestamp is wrong, and that is a fact about the sync
 * worth seeing rather than hiding behind a clock.
 *
 * It is also display only. The reporting week a review is counted into is
 * frozen at insert by `public.google_review_week_start()` and is not touched
 * here — formatting must never be able to move a review between weeks.
 *
 * Client-safe: pure `Intl`, no database client, no secret, no server-only
 * import, so the same string renders on the server and in the browser.
 */

/**
 * The zone every Google Reviews timestamp is rendered in — the same one its
 * reporting week is assigned in, re-exported so a screen needs to reach for
 * only one name.
 */
export const REVIEWS_DISPLAY_TIME_ZONE = GOOGLE_REVIEWS_TIMEZONE;

/** `9/21/2026, 7:25:37 AM CDT` — an instant, to the second, zone named. */
const INSTANT = new Intl.DateTimeFormat("en-US", {
  timeZone: REVIEWS_DISPLAY_TIME_ZONE,
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
  hour12: true,
  timeZoneName: "short",
});

/** `9/21/2026` — the calendar day the instant fell on, in Central. */
const INSTANT_DAY = new Intl.DateTimeFormat("en-US", {
  timeZone: REVIEWS_DISPLAY_TIME_ZONE,
  year: "numeric",
  month: "numeric",
  day: "numeric",
});

/**
 * An ISO instant rendered in Central, or `null` when there is nothing to show.
 *
 * NULL RATHER THAN A PLACEHOLDER, because only the caller knows whether the
 * absence means "never synced", "Google gave no date" or "—". A formatter that
 * invents "Unknown" takes that sentence away from the screen that owns it.
 * An unparseable value returns null for the same reason it must not return
 * "Invalid Date": a broken string is not a time and must not be drawn as one.
 */
export function formatReviewsInstant(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return INSTANT.format(parsed);
}

/**
 * The same instant reduced to the Central calendar day it fell on.
 *
 * FOR APPROXIMATIONS ONLY — Google's estimated date, which is derived from
 * wording like "7 months ago" and carries no meaningful hour. Converting the
 * instant before dropping the time is the point: a 1 a.m. UTC estimate is the
 * PREVIOUS day in Central, and printing the UTC day would put it a day ahead of
 * every other date on the same panel.
 */
export function formatReviewsDay(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return INSTANT_DAY.format(parsed);
}
