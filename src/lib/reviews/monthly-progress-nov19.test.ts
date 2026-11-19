import { describe, expect, it } from "vitest";

import {
  centralMonthOf,
  firstFullCountedMonth,
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

/**
 * Nov 19 2026, on the month-by-month table: "its 0 … also backfill". Every
 * month before a salon started counting (1 Oct 2026) read 0, although the
 * earlier reviews are held. Those months now show the 3–5★ reviews Google
 * dates to them.
 */
describe("months before a salon started counting", () => {
  const TODAY = "2026-11-19";
  const counted = [
    { id: "c1", store_code: "A", counted_at: "2026-09-25T17:00:00Z" }, // anchor-counted, part of September
    { id: "c2", store_code: "A", counted_at: "2026-10-05T17:00:00Z" },
    { id: "c3", store_code: "A", counted_at: "2026-11-05T17:00:00Z" },
  ];
  const posted = [
    { id: "p1", store_code: "A", google_absolute_date: "2026-03-10T17:00:00Z", google_estimated_at: null },
    { id: "p2", store_code: "A", google_absolute_date: null, google_estimated_at: "2026-08-02T17:00:00Z" },
    { id: "p3", store_code: "A", google_absolute_date: "2026-09-03T17:00:00Z", google_estimated_at: null },
    { id: "p4", store_code: "A", google_absolute_date: "2026-09-26T17:00:00Z", google_estimated_at: null },
    // Google gave no date: never placed by when ASK Sunny saw it.
    { id: "p5", store_code: "A", google_absolute_date: null, google_estimated_at: null },
    // October on is the goal count; a posted October review is not added twice.
    { id: "p6", store_code: "A", google_absolute_date: "2026-10-05T17:00:00Z", google_estimated_at: null },
  ];

  it("knows the first month counted in full", () => {
    expect(firstFullCountedMonth("2026-10-01T05:00:00Z")).toBe("2026-10");
    expect(firstFullCountedMonth("2026-10-15T05:00:00Z")).toBe("2026-11");
    expect(firstFullCountedMonth("2026-12-15T06:00:00Z")).toBe("2027-01");
    expect(firstFullCountedMonth(null)).toBeNull();
  });

  it("shows reviews Google dates to each earlier month, and the goal count from October", () => {
    const progress = monthlyProgress(counted, ["A"], TODAY, {
      posted,
      countingFrom: new Map([["A", "2026-10-01T05:00:00Z"]]),
    });
    const a = progress.rows[0];
    expect(a.months).toEqual([0, 0, 1, 0, 0, 0, 0, 1, 2, 1, 1]);
    expect(a.beforeCounting.filter(Boolean)).toHaveLength(9);
    expect(a.beforeCounting.slice(-2)).toEqual([false, false]);
    expect([a.l3, a.l6, a.ytd]).toEqual([4, 4, 6]);
  });

  it("without counting start dates, the counted figures stand as before", () => {
    const a = monthlyProgress(counted, ["A"], TODAY).rows[0];
    expect(a.months.slice(-3)).toEqual([1, 1, 1]);
    expect(a.beforeCounting.some(Boolean)).toBe(false);
  });
});
