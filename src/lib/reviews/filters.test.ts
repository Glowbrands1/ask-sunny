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
    expect(parseReviewFilters({ week: "2026-10" }).week).toBe(WEEK_ALL);
  });

  it("round-trips the month drill-down through a link", () => {
    const href = reviewsHref({ tab: "reviews", week: WEEK_MONTH, qualifying: "yes", storeCode: "306" });
    const params = Object.fromEntries(new URL(href, "https://ask.sunny").searchParams);
    expect(params.week).toBe("month");
    expect(parseReviewFilters(params).week).toBe(WEEK_MONTH);
  });
});
