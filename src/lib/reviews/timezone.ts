/**
 * THE GOOGLE REVIEWS BUSINESS TIMEZONE.
 *
 * ============================================================================
 * WHY THIS FEATURE HAS ITS OWN, WHEN `business-date.ts` SAYS NOT TO
 * ============================================================================
 *
 * `src/lib/business-date.ts` argues — correctly — that a SECOND business
 * timezone is the worst possible outcome for a shared concern: two parts of one
 * product disagreeing about what day it is, each internally consistent. That
 * argument is about a concern SHARED by several features, and it still stands
 * for `BUSINESS_TIMEZONE`, which remains US Eastern and is not touched here.
 *
 * Google Reviews is not that case. The weekly review count is reconciled by
 * hand against Google's own console by people working Central, and a week that
 * opens an hour before their Saturday ends is a week they cannot re-count and
 * get the same answer. So the zone is a PROPERTY OF THIS REPORT, declared once,
 * here — not a second opinion about what day it is for the business at large.
 *
 * Everything else keeps `BUSINESS_TIMEZONE`: follow-up due dates, the Overview
 * greeting, the analytics screens. Changing those was explicitly out of scope
 * and nothing in this module reaches them.
 *
 * ============================================================================
 * IT IS DECLARED TWICE AND THE TWO ARE PINNED TOGETHER
 * ============================================================================
 *
 * The other half is `public.google_review_week_start()`'s `p_zone` default. A
 * mismatch would put a Saturday-evening review in a different week on the
 * dashboard than in the database — an off-by-one nobody finds for a month, and
 * one that would surface as somebody re-counting a week by hand and getting a
 * different number. `reporting-week.test.ts` reads the migration AS TEXT and
 * asserts the two agree, so the pair cannot drift silently.
 *
 * ============================================================================
 * `America/Chicago`, NOT AN OFFSET
 * ============================================================================
 *
 * Central is UTC-6 in winter and UTC-5 in summer. Subtracting a constant five
 * or six hours is right for half the year and an hour wrong for the other half
 * — and an hour is exactly the size of the error that moves a late Saturday
 * review into the wrong week. The IANA database knows when the transition is.
 *
 * Client-safe: pure `Intl`, no database client, no secret, no server-only
 * import, so the server and the browser cannot disagree about the week.
 */

/**
 * The zone the Google Reviews reporting week and every Google Reviews
 * timestamp are judged in.
 *
 * NOT READ FROM THE ENVIRONMENT, unlike `BUSINESS_TIMEZONE`. That one is a
 * per-deployment setting because the app is deployed for different operators;
 * this is a property of one report whose numbers are reconciled against Google
 * by people in Central, and a deployment that quietly changed it would move
 * reviews between weeks with nothing in the code to say so.
 */
export const GOOGLE_REVIEWS_TIMEZONE = "America/Chicago";

/**
 * Today's date in the Google Reviews zone, as ISO `yyyy-mm-dd`.
 *
 * `en-CA` is not decoration: that locale formats as `2026-09-21`, which is ISO
 * order, so there is no month/day reassembly to get wrong. `Intl` does the zone
 * conversion, which is the only thing in the platform that knows when daylight
 * saving moved.
 *
 * DELIBERATELY NOT `businessToday(now, zone)`. Giving the shared helper a zone
 * parameter would make every caller's zone a question, and the shared module's
 * whole point is that it is not one. Six lines of `Intl` here keeps this
 * feature's decision inside this feature.
 */
export function googleReviewsToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: GOOGLE_REVIEWS_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
