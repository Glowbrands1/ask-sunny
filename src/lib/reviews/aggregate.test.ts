import { describe, expect, it } from "vitest";

import {
  districtRollups,
  locationRollups,
  summariseReviews,
  weeklyTrend,
  type LocationDirectoryRow,
  type LocationWeekRow,
} from "./aggregate";

/**
 * THE DASHBOARD'S ARITHMETIC.
 *
 * The rule under test throughout: ONLY 3-, 4- AND 5-STAR REVIEWS COUNT TOWARD
 * THE OFFICIAL WEEKLY TOTAL. 1- and 2-star reviews are stored, shown, and
 * worked in the response queue, and they never raise that number.
 *
 * Every figure here is a count over rows the rollup views already grouped, so
 * these tests need no database — which is what makes it cheap to pin the rule
 * itself rather than only the plumbing around it.
 */

const CURRENT = "2026-09-13";
const PREVIOUS = "2026-09-06";

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
    ...overrides,
  };
}

function week(
  overrides: Partial<LocationWeekRow> & { location_id: string; reporting_week_start: string },
): LocationWeekRow {
  const row: LocationWeekRow = {
    store_code: "306",
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
    last_seen_at: null,
    ...overrides,
  };
  return row;
}

describe("the weekly reporting rule", () => {
  const rows = [
    week({
      location_id: "loc-a",
      reporting_week_start: CURRENT,
      /* Ten reviews: two 1-star, one 2-star, seven qualifying. */
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

  const summary = summariseReviews(rows, {
    currentWeekStart: CURRENT,
    previousWeekStart: PREVIOUS,
    monthToDate: 21,
  });

  it("counts only 3, 4 and 5 stars toward the weekly total", () => {
    expect(summary.qualifyingThisWeek).toBe(7);
  });

  it("still counts every review in All New, including the 1s and 2s", () => {
    expect(summary.allNewThisWeek).toBe(10);
    /* Three reviews are visible and worked, and are absent from the total. */
    expect(summary.allNewThisWeek - summary.qualifyingThisWeek).toBe(3);
  });

  it("keeps the unanswered 1s and 2s in front of somebody", () => {
    expect(summary.criticalNeedingAttention).toBe(3);
    expect(summary.unanswered).toBe(4);
  });

  it("splits the reviews by star for the rating breakdown", () => {
    expect(summary.byRating).toEqual([2, 1, 2, 2, 3]);
    expect(summary.byRating.reduce((a, b) => a + b, 0)).toBe(summary.allNewThisWeek);
  });

  it("averages from the stored sum rather than from an average of averages", () => {
    expect(summary.averageRating).toBeCloseTo(33 / 10, 5);
  });

  it("carries month-to-date through rather than inventing it from whole weeks", () => {
    /*
     * Reporting weeks straddle month boundaries, so no sum of whole weeks is a
     * month-to-date figure. It is counted directly and passed in.
     */
    expect(summary.monthToDate).toBe(21);
  });
});

describe("a week with no reviews", () => {
  it("reports zeroes and a null average rather than a rating of 0", () => {
    const summary = summariseReviews([], {
      currentWeekStart: CURRENT,
      previousWeekStart: PREVIOUS,
      monthToDate: 0,
    });
    expect(summary.qualifyingThisWeek).toBe(0);
    expect(summary.allNewThisWeek).toBe(0);
    /* Null, not 0: "no reviews yet" and "everybody gave us nothing" differ. */
    expect(summary.averageRating).toBeNull();
  });
});

describe("the twelve-week trend", () => {
  it("draws a zero column for a week nothing was ingested in", () => {
    /*
     * A chart that omits empty weeks compresses its own x-axis and makes a
     * quiet fortnight look like steady volume.
     */
    const trend = weeklyTrend(
      [
        week({
          location_id: "loc-a",
          reporting_week_start: CURRENT,
          all_reviews: 5,
          qualifying_reviews: 4,
          critical_reviews: 1,
          unanswered: 2,
        }),
      ],
      [PREVIOUS, CURRENT],
    );

    expect(trend).toHaveLength(2);
    expect(trend[0]).toMatchObject({ weekStart: PREVIOUS, all: 0, qualifying: 0 });
    expect(trend[1]).toMatchObject({
      weekStart: CURRENT,
      all: 5,
      qualifying: 4,
      critical: 1,
      unanswered: 2,
    });
    expect(trend[1].label).toBe("Sep 13 – Sep 19");
  });
});

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
    week({
      location_id: "loc-a",
      store_code: "306",
      reporting_week_start: CURRENT,
      all_reviews: 4,
      qualifying_reviews: 3,
      critical_reviews: 1,
      rating_sum: 3 + 4 + 5 + 2,
      unanswered: 1,
      critical_unanswered: 1,
    }),
    week({
      location_id: "loc-a",
      store_code: "306",
      reporting_week_start: PREVIOUS,
      all_reviews: 2,
      qualifying_reviews: 2,
      rating_sum: 5 + 5,
    }),
    week({
      location_id: "loc-b",
      store_code: "143",
      reporting_week_start: CURRENT,
      all_reviews: 1,
      qualifying_reviews: 0,
      critical_reviews: 1,
      rating_2: 1,
      rating_sum: 2,
      unanswered: 1,
      critical_unanswered: 1,
    }),
  ];

  const locations = locationRollups(listings, rows, {
    currentWeekStart: CURRENT,
    previousWeekStart: PREVIOUS,
  });

  it("lists every listing, including one with no reviews at all", () => {
    /*
     * A leaderboard built by grouping the review table shows fourteen salons in
     * a week where one had none — and the missing salon is exactly the one
     * somebody needs to see.
     */
    expect(locations).toHaveLength(3);
    const quiet = locations.find((row) => row.storeCode === "409");
    expect(quiet).toMatchObject({ reviewsThisWeek: 0, total: 0, averageRating: null });
  });

  it("separates this week's qualifying count from this week's total", () => {
    const manhattan = locations.find((row) => row.storeCode === "306");
    expect(manhattan).toMatchObject({
      reviewsThisWeek: 4,
      qualifyingThisWeek: 3,
      lastWeek: 2,
      total: 6,
    });
  });

  it("carries a 2-star-only salon with a qualifying count of zero", () => {
    const kearney = locations.find((row) => row.storeCode === "143");
    expect(kearney).toMatchObject({
      reviewsThisWeek: 1,
      qualifyingThisWeek: 0,
      criticalOpen: 1,
    });
    expect(kearney?.averageRating).toBe(2);
  });

  it("averages a listing across every week it holds, not just this one", () => {
    const manhattan = locations.find((row) => row.storeCode === "306");
    /* (3+4+5+2) + (5+5) over six reviews. */
    expect(manhattan?.averageRating).toBeCloseTo(24 / 6, 5);
  });
});

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
        week({
          location_id: "loc-a",
          reporting_week_start: CURRENT,
          all_reviews: 9,
          qualifying_reviews: 9,
          rating_sum: 45,
        }),
        week({
          location_id: "loc-b",
          reporting_week_start: CURRENT,
          all_reviews: 1,
          qualifying_reviews: 0,
          critical_reviews: 1,
          rating_sum: 1,
        }),
      ],
      { currentWeekStart: CURRENT, previousWeekStart: PREVIOUS },
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
    /*
     * "Unassigned" would be a category somebody eventually tries to manage —
     * the same judgement the analytics reads already made about this column.
     * The chain totals still include it; only the breakdown omits it.
     */
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
        week({
          location_id: "loc-a",
          reporting_week_start: CURRENT,
          all_reviews: 2,
          qualifying_reviews: 2,
          rating_sum: 9,
        }),
        week({
          location_id: "loc-x",
          reporting_week_start: CURRENT,
          all_reviews: 3,
          qualifying_reviews: 3,
          rating_sum: 15,
        }),
      ],
      { currentWeekStart: CURRENT, previousWeekStart: PREVIOUS },
    );

    expect(districtRollups(locations)).toHaveLength(1);
    /* And the listing still appears on the leaderboard, named by Google. */
    expect(locations.find((row) => row.storeCode === "999")?.locationName).toBe(
      "Sun Tan City - Not In Reporting Yet",
    );
  });
});
