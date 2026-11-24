import { describe, expect, it } from "vitest";

import {
  lastFullMonthsOf,
  parseReviewFilters,
  reviewsHref,
  serializeReviewFilters,
  WEEK_LAST_SIX_MONTHS,
  WEEK_LAST_THREE_MONTHS,
  WEEK_YEAR_TO_DATE,
} from "./filters";
import { formatMonthsWindow, lastFullMonthsWindow, yearStart } from "./reporting-week";

/**
 * MANAGER REQUEST, Nov 19 2026, in their words:
 *
 *   "Are we only able to see the Google reviews in a one week period of time or
 *    month to date? I might've missed it, but that's all i see. I'd like to see
 *    an option to pull the last three full months so we can get a broader
 *    overall understanding and see progress."
 *
 * And the reply that set the scope: "we can certainly add L3, L6, or even YTD
 * reviews." (L3 / L6 = last 3 / last 6 months.)
 *
 * Before this change the period filter offered all time, this week, this month
 * to date or one reporting week, and `week=3months` parsed back to "all time".
 */
describe("an option to pull the last three full months (L3), L6 and YTD", () => {
  it("are periods the reviews URL keeps", () => {
    expect(parseReviewFilters({ week: "3months" }).week).toBe(WEEK_LAST_THREE_MONTHS);
    expect(parseReviewFilters({ week: "6months" }).week).toBe(WEEK_LAST_SIX_MONTHS);
    expect(parseReviewFilters({ week: "ytd" }).week).toBe(WEEK_YEAR_TO_DATE);
    expect(serializeReviewFilters({ week: WEEK_LAST_THREE_MONTHS })).toBe("week=3months");
    expect(reviewsHref({ week: WEEK_YEAR_TO_DATE })).toBe("/reviews?week=ytd#review-feed");
    /* A hand-edited period nobody published is still "all time". */
    expect(parseReviewFilters({ week: "9months" }).week).toBe("all");
  });

  it("L3 and L6 are FULL months: the current, partial month is left out", () => {
    expect(lastFullMonthsOf(WEEK_LAST_THREE_MONTHS)).toBe(3);
    expect(lastFullMonthsOf(WEEK_LAST_SIX_MONTHS)).toBe(6);
    expect(lastFullMonthsOf("month")).toBeNull();
    expect(lastFullMonthsOf("constructor")).toBeNull();

    expect(lastFullMonthsWindow(3, "2026-11-19")).toEqual({
      start: "2026-08-01",
      endExclusive: "2026-11-01",
    });
    expect(formatMonthsWindow(lastFullMonthsWindow(3, "2026-11-19"))).toBe("Aug – Oct 2026");
    expect(lastFullMonthsWindow(6, "2026-11-19").start).toBe("2026-05-01");
    expect(formatMonthsWindow(lastFullMonthsWindow(6, "2026-11-19"))).toBe("May – Oct 2026");
  });

  it("crosses a year boundary", () => {
    expect(lastFullMonthsWindow(3, "2027-02-03")).toEqual({
      start: "2026-11-01",
      endExclusive: "2027-02-01",
    });
    expect(formatMonthsWindow(lastFullMonthsWindow(3, "2027-02-03"))).toBe("Nov 2026 – Jan 2027");
    expect(lastFullMonthsWindow(6, "2027-01-01").start).toBe("2026-07-01");
  });

  it("YTD starts on Jan 1 of the current Central year", () => {
    expect(yearStart("2026-11-19")).toBe("2026-01-01");
  });
});
