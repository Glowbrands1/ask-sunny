import { describe, expect, it } from "vitest";

import {
  parseReviewFilters,
  reviewsHref,
  WEEK_ALL,
  WEEK_CURRENT,
  WEEK_MONTH,
} from "./filters";

/**
 * THE WEEK FILTER'S VOCABULARY, including `month` — the drill-down behind
 * every month-to-date figure on the goal views.
 */
describe("the week filter", () => {
  it("accepts this week, this month, all time and one reporting week", () => {
    expect(parseReviewFilters({ week: "current" }).week).toBe(WEEK_CURRENT);
    expect(parseReviewFilters({ week: "month" }).week).toBe(WEEK_MONTH);
    expect(parseReviewFilters({}).week).toBe(WEEK_ALL);
    expect(parseReviewFilters({ week: "2026-10-04" }).week).toBe("2026-10-04");
  });

  it("drops a value nobody published rather than passing it to a query", () => {
    expect(parseReviewFilters({ week: "months" }).week).toBe(WEEK_ALL);
    /*
     * Was "2026-10". Changed on purpose: a `yyyy-mm` month is now a published
     * period (the leaderboard's single months, Pau 23 Nov 2026); an impossible
     * month still is not.
     */
    expect(parseReviewFilters({ week: "2026-00" }).week).toBe(WEEK_ALL);
    expect(parseReviewFilters({ week: "2026-10-4" }).week).toBe(WEEK_ALL);
  });

  it("round-trips the month drill-down through a link", () => {
    const href = reviewsHref({ tab: "reviews", week: WEEK_MONTH, qualifying: "yes", storeCode: "306" });
    const params = Object.fromEntries(new URL(href, "https://ask.sunny").searchParams);
    expect(params.week).toBe("month");
    expect(parseReviewFilters(params).week).toBe(WEEK_MONTH);
  });
});

/* Pau, 23 Nov 2026: "pls add the per month for both like September october november". */
describe("one calendar month in the week filter", () => {
  it("keeps a yyyy-mm month through the URL, and drops one that is not a month", () => {
    expect(parseReviewFilters({ week: "2026-09" }).week).toBe("2026-09");
    expect(parseReviewFilters({ week: "2026-10" }).week).toBe("2026-10");
    expect(parseReviewFilters({ week: "2026-13" }).week).toBe(WEEK_ALL);
    expect(parseReviewFilters({ week: "2026-9" }).week).toBe(WEEK_ALL);
  });
});
