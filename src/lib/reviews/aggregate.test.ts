import { describe, expect, it } from "vitest";

import {
  districtRollups,
  locationRollups,
  summariseReviews,
  weeklyTrend,
  type LocationBacklogRow,
  type LocationDirectoryRow,
  type LocationPeriodRow,
} from "./aggregate";

/**
 * THE DASHBOARD'S ARITHMETIC.
 *
 * Two rules under test throughout:
 *
 *   ONLY 3-, 4- AND 5-STAR REVIEWS COUNT toward the official weekly total. The
 *   1s and 2s are stored, shown, and worked in the response queue, and never
 *   raise that number.
 *
 *   ONLY REVIEWS ASSIGNED TO A PERIOD COUNT AT ALL. An imported backlog is
 *   historical: it appears in the feed, in the response queue and in the
 *   average, and in no weekly figure whatsoever.
 *
 * Every figure here is a count over rows the rollup views already grouped, so
 * these tests need no database — which is what makes it cheap to pin the rules
 * themselves rather than only the plumbing around them.
 */

const CURRENT_ID = "period-current";
const PREVIOUS_ID = "period-previous";
const CURRENT_START = "2026-09-13";
const PREVIOUS_START = "2026-09-06";

function directory(
  overrides: Partial<LocationDirectoryRow> & { location_id: string; store_code: string },
): LocationDirectoryRow {
  return {
    salon_number: "0462",
    location_name: "KS Manhattan",
    district: "Patterson, Madeline",
    region: "Patterson, Madeline",
    google_location_label: "Sun Tan City - KS Manhattan",
    website_url: null,
    listing_state: "verified",
    is_active: true,
    counted_through_external_review_id: "QA-ANCHOR",
    counted_through_reviewer: "Anchor Reviewer",
    historical_reviews: 0,
    held_reviews: 0,
    ...overrides,
  };
}

function period(
  overrides: Partial<LocationPeriodRow> & {
    location_id: string;
    reporting_period_id: string;
  },
): LocationPeriodRow {
  return {
    store_code: "306",
    period_start: overrides.reporting_period_id === PREVIOUS_ID ? PREVIOUS_START : CURRENT_START,
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

function backlog(
  overrides: Partial<LocationBacklogRow> & { location_id: string },
): LocationBacklogRow {
  return {
    store_code: "306",
    historical_reviews: 0,
    historical_qualifying: 0,
    historical_unanswered: 0,
    historical_critical_unanswered: 0,
    rating_sum: 0,
    ...overrides,
  };
}

const OPTIONS = {
  currentPeriodId: CURRENT_ID,
  currentPeriodStart: CURRENT_START,
  previousPeriodId: PREVIOUS_ID,
  monthToDate: 0,
};

/* ------------------------------------------------- the two rules together -- */

describe("the weekly reporting rule", () => {
  const rows = [
    period({
      location_id: "loc-a",
      reporting_period_id: CURRENT_ID,
      /* Ten counted reviews: two 1-star, one 2-star, seven qualifying. */
      all_reviews: 10,
      qualifying_reviews: 7,
      critical_reviews: 3,
      rating_1: 2,
      rating_2: 1,
      rating_3: 2,
      rating_4: 2,
      rating_5: 3,
      rating_sum: 2 * 1 + 1 * 2 + 2 * 3 + 2 * 4 + 3 * 5,
      unanswered: 4,
      critical_unanswered: 3,
    }),
  ];

  const summary = summariseReviews(rows, [], [directory({ location_id: "loc-a", store_code: "306" })], {
    ...OPTIONS,
    monthToDate: 21,
  });

  it("counts only 3, 4 and 5 stars toward the weekly total", () => {
    expect(summary.qualifyingThisWeek).toBe(7);
  });

  it("still counts every review in All New, including the 1s and 2s", () => {
    expect(summary.allNewThisWeek).toBe(10);
    expect(summary.allNewThisWeek - summary.qualifyingThisWeek).toBe(3);
  });

  it("keeps the unanswered 1s and 2s in front of somebody", () => {
    expect(summary.criticalNeedingAttention).toBe(3);
    expect(summary.unanswered).toBe(4);
  });

  it("splits the reviews by star for the rating breakdown", () => {
    expect(summary.byRating).toEqual([2, 1, 2, 2, 3]);
  });

  it("averages from the stored sum rather than from an average of averages", () => {
    expect(summary.averageRating).toBeCloseTo(33 / 10, 5);
  });

  it("names the period every weekly figure belongs to", () => {
    expect(summary.periodId).toBe(CURRENT_ID);
    expect(summary.weekStart).toBe(CURRENT_START);
    expect(summary.weekEnd).toBe("2026-09-19");
  });
});

/* ------------------------------------------------------------ the backlog -- */

describe("an imported backlog raises no weekly figure", () => {
  /*
   * THE DEFECT THIS EXISTS TO PREVENT. Forty reviews going back a year,
   * imported this morning. Under the first implementation every one of them was
   * "first seen this week" and every one of them counted. Here they arrive as
   * backlog rows, which the period rollup cannot contain at all.
   */
  const rows = [
    period({
      location_id: "loc-a",
      reporting_period_id: CURRENT_ID,
      all_reviews: 2,
      qualifying_reviews: 2,
      rating_3: 1,
      rating_5: 1,
      rating_sum: 8,
    }),
  ];
  const held = [
    backlog({
      location_id: "loc-a",
      historical_reviews: 40,
      historical_qualifying: 33,
      historical_unanswered: 12,
      historical_critical_unanswered: 5,
      rating_sum: 160,
    }),
  ];

  const summary = summariseReviews(rows, held, [
    directory({ location_id: "loc-a", store_code: "306", historical_reviews: 40 }),
  ], OPTIONS);

  it("counts two, not forty-two, toward the week", () => {
    expect(summary.qualifyingThisWeek).toBe(2);
    expect(summary.allNewThisWeek).toBe(2);
  });

  it("reports the backlog separately and says how big it is", () => {
    expect(summary.historicalReviews).toBe(40);
    expect(summary.totalReviews).toBe(42);
  });

  it("does not let a backlogged 5-star into the rating breakdown for the week", () => {
    /* The breakdown describes the period, and the backlog is in no period. */
    expect(summary.byRating).toEqual([0, 0, 1, 0, 1]);
  });

  it("still surfaces the backlog's unanswered reviews, because people are waiting", () => {
    /*
     * A 2-star sitting in the imported history is a real customer with no
     * reply. Hiding it to keep the weekly arithmetic tidy would be the wrong
     * trade: the response queue is about work, not about reporting.
     */
    expect(summary.unanswered).toBe(12);
    expect(summary.criticalNeedingAttention).toBe(5);
  });

  it("includes the backlog in the reputation average, which is about all reviews", () => {
    expect(summary.averageRating).toBeCloseTo((8 + 160) / 42, 5);
  });
});

describe("a listing with no anchor is counted as unmeasured, not as quiet", () => {
  it("names how many listings are counting nothing", () => {
    const summary = summariseReviews(
      [],
      [backlog({ location_id: "loc-a", historical_reviews: 12 })],
      [
        directory({
          location_id: "loc-a",
          store_code: "306",
          counted_through_external_review_id: null,
          counted_through_reviewer: null,
          historical_reviews: 12,
        }),
        directory({ location_id: "loc-b", store_code: "143" }),
      ],
      OPTIONS,
    );

    expect(summary.listingsWithoutAnchor).toBe(1);
    expect(summary.qualifyingThisWeek).toBe(0);
    expect(summary.historicalReviews).toBe(12);
  });
});

describe("a week with nothing counted", () => {
  it("reports zeroes and a null average rather than a rating of 0", () => {
    const summary = summariseReviews([], [], [], {
      ...OPTIONS,
      currentPeriodId: null,
    });
    expect(summary.qualifyingThisWeek).toBe(0);
    expect(summary.allNewThisWeek).toBe(0);
    /* Null, not 0: "no reviews yet" and "everybody gave us nothing" differ. */
    expect(summary.averageRating).toBeNull();
    expect(summary.periodId).toBeNull();
  });
});

/* ----------------------------------------------------------- the trend ---- */

describe("the twelve-period trend", () => {
  it("draws a zero column for a week that has no period row at all", () => {
    /*
     * A period row exists only once something has been counted into that week.
     * A chart that omitted those weeks would compress its own x-axis and make a
     * quiet fortnight look like steady volume.
     */
    const trend = weeklyTrend(
      [
        period({
          location_id: "loc-a",
          reporting_period_id: CURRENT_ID,
          all_reviews: 5,
          qualifying_reviews: 4,
          critical_reviews: 1,
          unanswered: 2,
        }),
      ],
      [
        { id: "absent:2026-09-06", periodStart: PREVIOUS_START },
        { id: CURRENT_ID, periodStart: CURRENT_START },
      ],
    );

    expect(trend[0]).toMatchObject({ weekStart: PREVIOUS_START, all: 0, qualifying: 0 });
    expect(trend[1]).toMatchObject({
      weekStart: CURRENT_START,
      all: 5,
      qualifying: 4,
      critical: 1,
      unanswered: 2,
    });
    expect(trend[1].label).toBe("Sep 13 – Sep 19");
  });
});

/* ----------------------------------------------------- the leaderboard ---- */

describe("the salon leaderboard", () => {
  const listings = [
    directory({ location_id: "loc-a", store_code: "306" }),
    directory({
      location_id: "loc-b",
      store_code: "143",
      salon_number: "0309",
      location_name: "NE Kearney",
      district: "Dugan, Rachael",
      google_location_label: "Sun Tan City - NE Kearney",
      /* Never anchored: everything it holds is history. */
      counted_through_external_review_id: null,
      counted_through_reviewer: null,
      historical_reviews: 6,
    }),
    /* A listing with nothing ingested at all. */
    directory({
      location_id: "loc-c",
      store_code: "409",
      salon_number: "0495",
      location_name: "MO St Joseph",
      district: "Cotton, Sarah",
      google_location_label: "Sun Tan City - MO St Joseph",
    }),
  ];

  const rows = [
    period({
      location_id: "loc-a",
      store_code: "306",
      reporting_period_id: CURRENT_ID,
      all_reviews: 4,
      qualifying_reviews: 3,
      critical_reviews: 1,
      rating_sum: 3 + 4 + 5 + 2,
      unanswered: 1,
      critical_unanswered: 1,
    }),
    period({
      location_id: "loc-a",
      store_code: "306",
      reporting_period_id: PREVIOUS_ID,
      all_reviews: 2,
      qualifying_reviews: 2,
      rating_sum: 5 + 5,
    }),
  ];

  const held = [
    backlog({
      location_id: "loc-b",
      store_code: "143",
      historical_reviews: 6,
      historical_unanswered: 2,
      historical_critical_unanswered: 1,
      rating_sum: 18,
    }),
  ];

  const locations = locationRollups(listings, rows, held, {
    currentPeriodId: CURRENT_ID,
    previousPeriodId: PREVIOUS_ID,
  });

  it("lists every listing, including one with no reviews at all", () => {
    expect(locations).toHaveLength(3);
    expect(locations.find((row) => row.storeCode === "409")).toMatchObject({
      reviewsThisWeek: 0,
      total: 0,
      averageRating: null,
    });
  });

  it("separates this period's qualifying count from this period's total", () => {
    expect(locations.find((row) => row.storeCode === "306")).toMatchObject({
      reviewsThisWeek: 4,
      qualifyingThisWeek: 3,
      lastWeek: 2,
      total: 6,
      historical: 0,
    });
  });

  it("shows an unanchored listing's backlog and counts none of it for the week", () => {
    expect(locations.find((row) => row.storeCode === "143")).toMatchObject({
      anchorReviewId: null,
      historical: 6,
      reviewsThisWeek: 0,
      qualifyingThisWeek: 0,
      /* Still in the response queue — those customers are waiting. */
      unanswered: 2,
      criticalOpen: 1,
      total: 6,
    });
  });

  it("carries the anchor so the page can name who it is", () => {
    expect(locations.find((row) => row.storeCode === "306")).toMatchObject({
      anchorReviewId: "QA-ANCHOR",
      anchorReviewer: "Anchor Reviewer",
    });
  });

  it("averages a listing across everything it holds, counted or not", () => {
    /* Manhattan: (3+4+5+2) + (5+5) over six counted reviews, no backlog. */
    expect(locations.find((row) => row.storeCode === "306")?.averageRating).toBeCloseTo(
      24 / 6,
      5,
    );
    /* Kearney: 18 over six, all of it historical. */
    expect(locations.find((row) => row.storeCode === "143")?.averageRating).toBeCloseTo(
      3,
      5,
    );
  });
});

/* ------------------------------------------------------------ districts --- */

describe("district totals", () => {
  it("rolls up from the listings and weights the average by volume", () => {
    const locations = locationRollups(
      [
        directory({ location_id: "loc-a", store_code: "306" }),
        directory({
          location_id: "loc-b",
          store_code: "307",
          salon_number: "0463",
          location_name: "KS Shawnee Mission Pkwy",
          google_location_label: "Sun Tan City - KS Shawnee Mission Pkwy",
        }),
      ],
      [
        period({
          location_id: "loc-a",
          reporting_period_id: CURRENT_ID,
          all_reviews: 9,
          qualifying_reviews: 9,
          rating_sum: 45,
        }),
        period({
          location_id: "loc-b",
          store_code: "307",
          reporting_period_id: CURRENT_ID,
          all_reviews: 1,
          qualifying_reviews: 0,
          critical_reviews: 1,
          rating_sum: 1,
        }),
      ],
      [],
      { currentPeriodId: CURRENT_ID, previousPeriodId: PREVIOUS_ID },
    );

    const districts = districtRollups(locations);
    expect(districts).toHaveLength(1);
    expect(districts[0]).toMatchObject({
      district: "Patterson, Madeline",
      locations: 2,
      reviewsThisWeek: 10,
      qualifyingThisWeek: 9,
      total: 10,
    });
    /*
     * WEIGHTED, NOT AVERAGED. Nine fives and one one is 4.6, and the average of
     * the two salons' averages would be 3.0 — a figure that is wrong in a way
     * nobody can spot from the page.
     */
    expect(districts[0].averageRating).toBeCloseTo(4.6, 5);
  });

  it("leaves a listing with no district out of the breakdown rather than bucketing it", () => {
    const locations = locationRollups(
      [
        directory({ location_id: "loc-a", store_code: "306" }),
        directory({
          location_id: "loc-x",
          store_code: "999",
          district: null,
          location_name: null,
          google_location_label: "Sun Tan City - Not In Reporting Yet",
        }),
      ],
      [
        period({
          location_id: "loc-a",
          reporting_period_id: CURRENT_ID,
          all_reviews: 2,
          qualifying_reviews: 2,
          rating_sum: 9,
        }),
        period({
          location_id: "loc-x",
          store_code: "999",
          reporting_period_id: CURRENT_ID,
          all_reviews: 3,
          qualifying_reviews: 3,
          rating_sum: 15,
        }),
      ],
      [],
      { currentPeriodId: CURRENT_ID, previousPeriodId: PREVIOUS_ID },
    );

    expect(districtRollups(locations)).toHaveLength(1);
    /* And the listing still appears on the leaderboard, named by Google. */
    expect(locations.find((row) => row.storeCode === "999")?.locationName).toBe(
      "Sun Tan City - Not In Reporting Yet",
    );
  });
});
