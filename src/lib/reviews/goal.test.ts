import { describe, expect, it } from "vitest";

import type { LocationPeriodRow } from "./aggregate";
import {
  DEFAULT_MONTHLY_REVIEW_GOAL,
  daysInMonthOf,
  districtGoalRollups,
  formatGoalMonth,
  formatMonthToDate,
  goalContext,
  goalProgress,
  goalStatus,
  goalSummary,
  monthlyReviewGoal,
  paceTargetFor,
  qualifyingMonthToDate,
  rankLocations,
  straddlingPeriod,
} from "./goal";
import type { LocationRollup } from "./types";

/**
 * THE MONTHLY GOAL'S ARITHMETIC.
 *
 * Three rules under test throughout:
 *
 *   MONTH TO DATE IS CALENDAR DAYS, CENTRAL, from the 1st through today — not
 *   the reporting weeks that began this month — and no review is counted twice.
 *
 *   A SALON WITH NO BASELINE IS NOT COUNTING. It is never ranked and never
 *   summed into a figure compared against the goal.
 *
 *   PACE IS NOT ACHIEVEMENT. "On pace" and "Goal met" are different states.
 */

function location(overrides: Partial<LocationRollup> = {}): LocationRollup {
  return {
    storeCode: "306",
    locationName: "KS Manhattan",
    district: "Patterson, Madeline",
    salonNumber: "0462",
    listingState: "verified",
    anchorReviewId: "anchor-1",
    anchorReviewer: "Tarissa Barry",
    historical: 0,
    reviewsThisWeek: 0,
    qualifyingThisWeek: 0,
    lastWeek: 0,
    qualifyingLastWeek: 0,
    qualifyingMonthToDate: 0,
    unanswered: 0,
    criticalOpen: 0,
    averageRating: null,
    total: 0,
    ...overrides,
  };
}

function period(overrides: Partial<LocationPeriodRow>): LocationPeriodRow {
  return {
    location_id: "loc-a",
    store_code: "306",
    reporting_period_id: "p",
    period_start: "2026-10-04",
    all_reviews: 0,
    qualifying_reviews: 0,
    critical_reviews: 0,
    unanswered: 0,
    critical_unanswered: 0,
    rating_1: 0,
    rating_2: 0,
    rating_3: 0,
    rating_4: 0,
    rating_5: 0,
    rating_sum: 0,
    ...overrides,
  };
}

/* ================================================================ config == */

describe("the configured goal", () => {
  it("is ten by default", () => {
    expect(DEFAULT_MONTHLY_REVIEW_GOAL).toBe(10);
    expect(monthlyReviewGoal(undefined)).toBe(10);
    expect(monthlyReviewGoal("")).toBe(10);
  });

  it("takes a positive whole-number override", () => {
    expect(monthlyReviewGoal("12")).toBe(12);
    expect(monthlyReviewGoal(" 8 ")).toBe(8);
  });

  it("ignores anything that is not a positive whole number", () => {
    for (const raw of ["0", "-3", "7.5", "ten", "1e3", "99999"]) {
      expect(monthlyReviewGoal(raw), raw).toBe(10);
    }
  });
});

/* ================================================================ month === */

describe("where today sits in the month", () => {
  it("knows each month's length, leap years included", () => {
    expect(daysInMonthOf("2026-10-12")).toBe(31);
    expect(daysInMonthOf("2026-09-01")).toBe(30);
    expect(daysInMonthOf("2026-02-10")).toBe(28);
    expect(daysInMonthOf("2028-02-10")).toBe(29);
  });

  it("builds the context from the Central reporting date", () => {
    expect(goalContext("2026-10-12", 10)).toEqual({
      target: 10,
      monthStart: "2026-10-01",
      today: "2026-10-12",
      dayOfMonth: 12,
      daysInMonth: 31,
      daysElapsed: 11,
      /* 10 × 11/31 = 3.55, rounded up. */
      paceTarget: 4,
    });
  });

  it("asks for nothing on the 1st, and for the whole target on the last day", () => {
    expect(goalContext("2026-10-01", 10).paceTarget).toBe(0);
    /* 30 of 31 days finished: 9.68, rounded up to 10. */
    expect(goalContext("2026-10-31", 10).paceTarget).toBe(10);
  });

  it("rolls over cleanly into the next month", () => {
    const lastDay = goalContext("2026-10-31", 10);
    const firstDay = goalContext("2026-11-01", 10);
    expect(lastDay.monthStart).toBe("2026-10-01");
    expect(firstDay.monthStart).toBe("2026-11-01");
    expect(firstDay.daysInMonth).toBe(30);
    expect(firstDay.paceTarget).toBe(0);
  });

  it("never asks for more than the target or less than nothing", () => {
    expect(paceTargetFor(10, 40, 31)).toBe(10);
    expect(paceTargetFor(10, -2, 31)).toBe(0);
  });

  it("labels the month and the month-to-date window for a person", () => {
    expect(formatGoalMonth({ monthStart: "2026-10-01" })).toBe("October");
    expect(formatMonthToDate({ monthStart: "2026-10-01", today: "2026-10-12" })).toBe(
      "Oct 1 – Oct 12",
    );
    expect(formatMonthToDate({ monthStart: "2026-10-01", today: "2026-10-01" })).toBe("Oct 1");
  });
});

/* ======================================================= month to date === */

describe("which reporting week straddles the 1st", () => {
  const periods = [
    { id: "sep-20", period_start: "2026-09-20", period_end: "2026-09-26" },
    { id: "sep-27", period_start: "2026-09-27", period_end: "2026-10-03" },
    { id: "oct-04", period_start: "2026-10-04", period_end: "2026-10-10" },
  ];

  it("is the one that began last month and ends this month", () => {
    expect(straddlingPeriod(periods, "2026-10-01")?.id).toBe("sep-27");
  });

  it("is none when the month opens on a Sunday", () => {
    /* November 2026 begins on a Sunday, so no week is split by the 1st. */
    expect(
      straddlingPeriod(
        [{ id: "nov-01", period_start: "2026-11-01", period_end: "2026-11-07" }],
        "2026-11-01",
      ),
    ).toBeNull();
  });

  it("is none when nothing was counted that week (no period row exists)", () => {
    expect(straddlingPeriod([periods[2]], "2026-10-01")).toBeNull();
  });
});

describe("qualifying reviews month to date", () => {
  it("takes whole weeks that began this month, and only their QUALIFYING reviews", () => {
    const byStore = qualifyingMonthToDate(
      [
        period({ period_start: "2026-10-04", all_reviews: 6, qualifying_reviews: 4 }),
        period({ period_start: "2026-10-11", all_reviews: 2, qualifying_reviews: 2 }),
      ],
      "2026-10-01",
      new Map(),
    );
    /* The two 1- or 2-star reviews raise nothing. */
    expect(byStore.get("306")).toBe(6);
  });

  it("does NOT take the straddling week whole — its reviews before the 1st are last month's", () => {
    const byStore = qualifyingMonthToDate(
      [period({ period_start: "2026-09-27", qualifying_reviews: 5 })],
      "2026-10-01",
      new Map(),
    );
    expect(byStore.get("306")).toBeUndefined();
  });

  it("adds the straddling week's reviews dated on or after the 1st, once", () => {
    const byStore = qualifyingMonthToDate(
      [
        period({ period_start: "2026-09-27", qualifying_reviews: 5 }),
        period({ period_start: "2026-10-04", qualifying_reviews: 3 }),
      ],
      "2026-10-01",
      new Map([["306", 2]]),
    );
    /* 2 from Oct 1–3, 3 from the week of Oct 4. The other 3 of that 5 were September's. */
    expect(byStore.get("306")).toBe(5);
  });

  it("does not reach back into weeks wholly before the month", () => {
    const byStore = qualifyingMonthToDate(
      [period({ period_start: "2026-09-20", qualifying_reviews: 9 })],
      "2026-10-01",
      new Map(),
    );
    expect(byStore.size).toBe(0);
  });

  it("keeps listings apart", () => {
    const byStore = qualifyingMonthToDate(
      [
        period({ store_code: "306", qualifying_reviews: 3 }),
        period({ store_code: "143", location_id: "loc-b", qualifying_reviews: 11 }),
      ],
      "2026-10-01",
      new Map([["143", 1]]),
    );
    expect(byStore.get("306")).toBe(3);
    expect(byStore.get("143")).toBe(12);
  });

  it("starts the next month from zero", () => {
    const rows = [
      period({ period_start: "2026-10-25", qualifying_reviews: 8 }),
      period({ period_start: "2026-11-01", qualifying_reviews: 1 }),
    ];
    expect(qualifyingMonthToDate(rows, "2026-10-01", new Map()).get("306")).toBe(9);
    expect(qualifyingMonthToDate(rows, "2026-11-01", new Map()).get("306")).toBe(1);
  });
});

/* =================================================== status and rank ==== */

describe("a salon's status against the goal", () => {
  const context = { target: 10, paceTarget: 4 };

  it("is Goal met at exactly the target", () => {
    expect(goalStatus(location({ qualifyingMonthToDate: 10 }), context)).toBe("met");
  });

  it("is Goal met above the target", () => {
    expect(goalStatus(location({ qualifyingMonthToDate: 12 }), context)).toBe("met");
  });

  it("is On pace at the pace mark, and NOT Goal met", () => {
    expect(goalStatus(location({ qualifyingMonthToDate: 4 }), context)).toBe("on_pace");
    expect(goalStatus(location({ qualifyingMonthToDate: 9 }), context)).toBe("on_pace");
  });

  it("is Behind pace below the pace mark, including at zero", () => {
    expect(goalStatus(location({ qualifyingMonthToDate: 3 }), context)).toBe("behind_pace");
    expect(goalStatus(location({ qualifyingMonthToDate: 0 }), context)).toBe("behind_pace");
  });

  it("is never behind on the 1st, when nothing is due yet", () => {
    expect(
      goalStatus(location({ qualifyingMonthToDate: 0 }), { target: 10, paceTarget: 0 }),
    ).toBe("on_pace");
  });

  it("is Not counting without a baseline, whatever the count says", () => {
    expect(
      goalStatus(location({ anchorReviewId: null, qualifyingMonthToDate: 14 }), context),
    ).toBe("not_counting");
  });
});

describe("progress toward the target", () => {
  it("reports past 100% and caps only the bar", () => {
    expect(goalProgress(12, 10)).toEqual({ percent: 120, barPercent: 100, remaining: 0, over: 2 });
  });

  it("reports exactly 100% at the target", () => {
    expect(goalProgress(10, 10)).toEqual({ percent: 100, barPercent: 100, remaining: 0, over: 0 });
  });

  it("reports what is left below it", () => {
    expect(goalProgress(0, 10)).toEqual({ percent: 0, barPercent: 0, remaining: 10, over: 0 });
    expect(goalProgress(8, 10)).toEqual({ percent: 80, barPercent: 80, remaining: 2, over: 0 });
  });
});

describe("the leaderboard ranking", () => {
  const board = [
    location({ storeCode: "a", locationName: "NE Kearney", qualifyingMonthToDate: 8, qualifyingThisWeek: 2 }),
    location({ storeCode: "b", locationName: "NE Grand Island", qualifyingMonthToDate: 12, qualifyingThisWeek: 3 }),
    location({ storeCode: "c", locationName: "NE Omaha 132nd and Maple", qualifyingMonthToDate: 8, qualifyingThisWeek: 3 }),
    location({ storeCode: "d", locationName: "MO St Joseph", anchorReviewId: null, qualifyingMonthToDate: 20 }),
    location({ storeCode: "e", locationName: "NE Lincoln 27th Street", qualifyingMonthToDate: 5, qualifyingThisWeek: 5 }),
    location({ storeCode: "f", locationName: "NE Omaha Pacific", qualifyingMonthToDate: 0 }),
  ];

  it("ranks by month to date, highest first", () => {
    const ranked = rankLocations(board, "month");
    expect(ranked.map((entry) => entry.location.storeCode)).toEqual(["b", "c", "a", "e", "f", "d"]);
  });

  it("gives tied salons the same rank and skips the next (1, 2, 2, 4)", () => {
    const ranked = rankLocations(board, "month");
    expect(ranked.map((entry) => entry.rank)).toEqual([1, 2, 2, 4, 5, null]);
    expect(ranked.filter((entry) => entry.tied).map((entry) => entry.location.storeCode)).toEqual([
      "c",
      "a",
    ]);
  });

  it("orders a tie by the week, without giving the week a rank of its own", () => {
    const ranked = rankLocations(board, "month");
    /* Omaha (3 this week) is drawn above Kearney (2), and both are 2nd. */
    expect(ranked[1].location.storeCode).toBe("c");
    expect(ranked[2].location.storeCode).toBe("a");
    expect(ranked[1].rank).toBe(ranked[2].rank);
  });

  it("never ranks a salon with no baseline, however high its count", () => {
    const stJoseph = rankLocations(board, "month").find((entry) => entry.location.storeCode === "d");
    expect(stJoseph).toMatchObject({ rank: null, tied: false });
  });

  it("keeps a salon with nothing this month on the board, last among the counting", () => {
    const pacific = rankLocations(board, "month").find((entry) => entry.location.storeCode === "f");
    expect(pacific?.rank).toBe(5);
  });

  it("ranks by this week on request", () => {
    const ranked = rankLocations(board, "week");
    expect(ranked[0].location.storeCode).toBe("e");
    expect(ranked.map((entry) => entry.rank)).toEqual([1, 2, 2, 4, 5, null]);
  });

  it("does not move a figure on the way", () => {
    const ranked = rankLocations(board, "month");
    expect(ranked.find((entry) => entry.location.storeCode === "b")?.location).toBe(board[1]);
  });
});

/* ========================================================== roll-ups ==== */

describe("the goal summary", () => {
  const context = { target: 10, paceTarget: 4 };
  const salons = [
    location({ storeCode: "a", qualifyingThisWeek: 3, qualifyingLastWeek: 1, qualifyingMonthToDate: 12 }),
    location({ storeCode: "b", qualifyingThisWeek: 2, qualifyingLastWeek: 2, qualifyingMonthToDate: 10 }),
    location({ storeCode: "c", qualifyingThisWeek: 1, qualifyingLastWeek: 0, qualifyingMonthToDate: 5 }),
    location({ storeCode: "d", qualifyingThisWeek: 0, qualifyingLastWeek: 0, qualifyingMonthToDate: 0 }),
    location({
      storeCode: "e",
      anchorReviewId: null,
      qualifyingThisWeek: 4,
      qualifyingLastWeek: 4,
      qualifyingMonthToDate: 9,
    }),
  ];

  it("covers only the salons with a baseline", () => {
    expect(goalSummary(salons, context)).toEqual({
      counting: 4,
      notCounting: 1,
      qualifyingThisWeek: 6,
      qualifyingLastWeek: 3,
      qualifyingMonthToDate: 27,
      combinedTarget: 40,
      atGoal: 2,
      onPace: 1,
      behindPace: 1,
      /* 0 + 0 + 5 + 10: Grand Island's two over does not cover anybody else. */
      stillNeeded: 15,
    });
  });

  it("is all zeroes, not an error, when nothing is in view", () => {
    expect(goalSummary([], context)).toMatchObject({
      counting: 0,
      combinedTarget: 0,
      atGoal: 0,
      stillNeeded: 0,
    });
  });
});

describe("the district goal table", () => {
  it("rolls each district up from its counting salons, and leaves out a salon with no district", () => {
    const rows = districtGoalRollups(
      [
        location({ storeCode: "a", district: "Dugan, Rachael", qualifyingMonthToDate: 12, qualifyingThisWeek: 3 }),
        location({ storeCode: "b", district: "Dugan, Rachael", qualifyingMonthToDate: 4, qualifyingThisWeek: 1 }),
        location({ storeCode: "c", district: "Dugan, Rachael", anchorReviewId: null, qualifyingMonthToDate: 6 }),
        location({ storeCode: "d", district: "Cotton, Sarah", qualifyingMonthToDate: 2 }),
        location({ storeCode: "e", district: null, qualifyingMonthToDate: 30 }),
      ],
      { target: 10, paceTarget: 4 },
    );
    expect(rows).toEqual([
      {
        district: "Cotton, Sarah",
        locations: 1,
        counting: 1,
        qualifyingThisWeek: 0,
        qualifyingMonthToDate: 2,
        combinedTarget: 10,
        atGoal: 0,
      },
      {
        district: "Dugan, Rachael",
        locations: 3,
        counting: 2,
        qualifyingThisWeek: 4,
        qualifyingMonthToDate: 16,
        combinedTarget: 20,
        atGoal: 1,
      },
    ]);
  });
});
