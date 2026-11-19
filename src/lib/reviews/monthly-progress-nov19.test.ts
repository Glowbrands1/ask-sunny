import { describe, expect, it } from "vitest";

import {
  centralMonthOf,
  monthlyProgress,
  monthlyProgressStart,
  monthsBetween,
} from "./monthly-progress";

/**
 * MANAGER REQUEST, Nov 19 2026: "I'd like to see an option to pull the last
 * three full months so we can get a broader overall understanding and see
 * progress." Then, for the figures: "yeah per month pls last 3 mos last 6 mos
 * and YTD".
 */
describe("per month, last 3 mos, last 6 mos and YTD", () => {
  const TODAY = "2026-11-19";

  it("shows every month from January (or six back, if earlier) through this one", () => {
    expect(monthlyProgressStart(TODAY)).toBe("2026-01-01");
    expect(monthlyProgressStart("2027-02-03")).toBe("2026-08-01");
    expect(monthsBetween("2026-01-01", TODAY)).toEqual([
      "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06",
      "2026-07", "2026-08", "2026-09", "2026-10", "2026-11",
    ]);
  });

  it("places a review in its CENTRAL month: 10pm Central on Oct 31 is October", () => {
    expect(centralMonthOf("2026-11-01T03:00:00Z")).toBe("2026-10");
    expect(centralMonthOf("2026-11-01T06:00:00Z")).toBe("2026-11");
  });

  it("counts per month and totals L3, L6 and YTD, leaving the partial month out of L3/L6", () => {
    const at = (month: string, n: number, store = "A") =>
      Array.from({ length: n }, (_, i) => ({
        id: `${store}-${month}-${i}`,
        store_code: store,
        counted_at: `${month}-15T17:00:00Z`,
      }));
    const rows = [
      ...at("2026-01", 1),
      ...at("2026-05", 2),
      ...at("2026-07", 4),
      ...at("2026-08", 5),
      ...at("2026-09", 6),
      ...at("2026-10", 7),
      ...at("2026-11", 9),
      ...at("2026-10", 3, "B"),
      ...at("2026-10", 1, "NOT-ASKED"),
    ];
    // A repeated row is one review.
    rows.push(rows[0]);

    const progress = monthlyProgress(rows, ["A", "B"], TODAY);
    expect(progress.l3Months).toEqual(["2026-08", "2026-09", "2026-10"]);
    expect(progress.l6Months).toEqual(["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"]);
    expect(progress.ytdMonths).toHaveLength(11);
    expect(progress.currentMonth).toBe("2026-11");

    const a = progress.rows[0];
    expect(a.months).toEqual([1, 0, 0, 0, 2, 0, 4, 5, 6, 7, 9]);
    expect([a.l3, a.l6, a.ytd]).toEqual([18, 24, 34]);

    const b = progress.rows[1];
    expect([b.l3, b.l6, b.ytd]).toEqual([3, 3, 3]);

    expect([progress.total.l3, progress.total.l6, progress.total.ytd]).toEqual([21, 27, 37]);
  });

  it("in February, L6 reaches back into last year and YTD is only this year", () => {
    const progress = monthlyProgress(
      [
        { id: "1", store_code: "A", counted_at: "2026-09-10T17:00:00Z" },
        { id: "2", store_code: "A", counted_at: "2027-01-10T17:00:00Z" },
        { id: "3", store_code: "A", counted_at: "2027-02-02T17:00:00Z" },
      ],
      ["A"],
      "2027-02-03",
    );
    expect(progress.months[0]).toBe("2026-08");
    expect(progress.l3Months).toEqual(["2026-11", "2026-12", "2027-01"]);
    expect([progress.rows[0].l3, progress.rows[0].l6, progress.rows[0].ytd]).toEqual([1, 2, 2]);
  });
});
