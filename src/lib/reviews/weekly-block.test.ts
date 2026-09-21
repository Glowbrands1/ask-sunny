import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  locationRollups,
  summariseReviews,
  type LocationBacklogRow,
  type LocationDirectoryRow,
  type LocationPeriodRow,
} from "./aggregate";
import {
  deriveReviewsWeekBlock,
  weeklyGoalFor,
  weeklyGoalPerSalon,
  WEEKLY_GOAL_PER_SALON_ENV,
  type ReviewsWeekSnapshot,
} from "./weekly-block";

/**
 * ============================================================================
 * THE OVERVIEW'S GOOGLE REVIEWS BLOCK, OVER THE TAB'S OWN ARITHMETIC
 * ============================================================================
 *
 * WHAT THESE CASES ARE REALLY ASSERTING. The defect was not a wrong sum — it
 * was a SECOND SOURCE: the home page summed `DEMO_REVIEW_METRICS` (189 gained,
 * 4.63 average, a 230 goal, 15 salons) while the Google Reviews tab read
 * Supabase, so the two could state different weeks and did.
 *
 * So the snapshots below are not hand-written figures handed to the projection.
 * They are built by `summariseReviews` and `locationRollups` — the same two
 * functions `loadReviewsSnapshot` calls to produce what the TAB renders — from
 * rollup rows. A case that passes here is a case where the Overview's figure
 * and the tab's figure came out of one calculation over one set of rows, which
 * is the property the whole change exists to establish.
 */

const CURRENT_ID = "period-current";
const PREVIOUS_ID = "period-previous";
const CURRENT_START = "2026-09-20";
const PREVIOUS_START = "2026-09-13";

function directory(
  overrides: Partial<LocationDirectoryRow> & { location_id: string; store_code: string },
): LocationDirectoryRow {
  return {
    salon_number: "0462",
    location_name: "KS Manhattan",
    district: "District 3 — Kansas & Kansas City",
    region: "District 3 — Kansas & Kansas City",
    google_location_label: "Sun Tan City - KS Manhattan",
    website_url: null,
    listing_state: "verified",
    is_active: true,
    counted_through_external_review_id: "ANCHOR",
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

/**
 * A snapshot the way `loadReviewsSnapshot` assembles one: the summary and the
 * per-listing rollups are COMPUTED from the rows, never stated.
 */
function snapshotOf(
  periodRows: LocationPeriodRow[],
  directoryRows: LocationDirectoryRow[],
  backlog: LocationBacklogRow[] = [],
): ReviewsWeekSnapshot {
  return {
    empty: periodRows.length === 0 && backlog.length === 0,
    summary: summariseReviews(periodRows, backlog, directoryRows, {
      currentPeriodId: CURRENT_ID,
      currentPeriodStart: CURRENT_START,
      previousPeriodId: PREVIOUS_ID,
      monthToDate: 0,
    }),
    locations: locationRollups(directoryRows, periodRows, backlog, {
      currentPeriodId: CURRENT_ID,
      previousPeriodId: PREVIOUS_ID,
    }),
    currentWeek: CURRENT_START,
    previousWeek: PREVIOUS_START,
  };
}

/** Two salons, a counted week, and a previous week to compare against. */
function estate(): ReviewsWeekSnapshot {
  return snapshotOf(
    [
      period({
        location_id: "loc-a",
        reporting_period_id: CURRENT_ID,
        /* Ten counted: one 1-star, two 2-star, seven qualifying. */
        all_reviews: 10,
        qualifying_reviews: 7,
        critical_reviews: 3,
        rating_1: 1,
        rating_2: 2,
        rating_3: 2,
        rating_4: 2,
        rating_5: 3,
        rating_sum: 1 + 2 * 2 + 2 * 3 + 2 * 4 + 3 * 5,
      }),
      period({
        location_id: "loc-b",
        store_code: "462",
        reporting_period_id: CURRENT_ID,
        all_reviews: 4,
        qualifying_reviews: 4,
        rating_4: 1,
        rating_5: 3,
        rating_sum: 4 + 3 * 5,
      }),
      period({
        location_id: "loc-a",
        reporting_period_id: PREVIOUS_ID,
        all_reviews: 9,
        qualifying_reviews: 8,
        rating_5: 8,
        rating_2: 1,
        rating_sum: 8 * 5 + 2,
      }),
    ],
    [
      directory({ location_id: "loc-a", store_code: "306" }),
      directory({ location_id: "loc-b", store_code: "462" }),
    ],
  );
}

/* ------------------------------------------------ the five live figures --- */

describe("the figures on the Overview block", () => {
  it("counts this week's reviews as the tab's official weekly number", () => {
    const snapshot = estate();
    const block = deriveReviewsWeekBlock(snapshot, { goalPerSalon: null });

    expect(block.status).toBe("ready");
    if (block.status !== "ready") return;

    /*
     * 7 + 4 QUALIFYING, not 10 + 4. The tab's headline tile is "Qualifying
     * reviews gained" and 1- and 2-star reviews never raise it, so a home page
     * showing 14 beside a tab showing 11 would be the original defect wearing a
     * different number.
     */
    expect(block.gained).toBe(11);
    expect(block.gained).toBe(snapshot.summary.qualifyingThisWeek);
    /* Everything the period counted travels too, for the caption. */
    expect(block.allNew).toBe(14);
    /* Specifically not the figure that used to be printed here. */
    expect(block.gained).not.toBe(189);
  });

  it("averages the stars the week's reviewers actually gave", () => {
    const snapshot = estate();
    const block = deriveReviewsWeekBlock(snapshot, { goalPerSalon: null });
    if (block.status !== "ready") throw new Error("expected figures");

    /*
     * OVER ALL FOURTEEN COUNTED REVIEWS, 1- and 2-star included: the question
     * is what customers gave this week, and dropping the complaints from the
     * divisor would report a rating nobody produced.
     */
    const ratingSum = 1 + 2 * 2 + 2 * 3 + 2 * 4 + 3 * 5 + (4 + 3 * 5);
    expect(block.averageRating).toBeCloseTo(ratingSum / 14, 5);
    expect(block.averageRating).not.toBe(4.63);
  });

  it("compares the open reporting period against the one before it", () => {
    const block = deriveReviewsWeekBlock(estate(), { goalPerSalon: null });
    if (block.status !== "ready") throw new Error("expected figures");

    /*
     * 11 qualifying this week against 8 last week. The same comparison the
     * tab's tile makes — `qualifyingThisWeek` against `qualifyingLastWeek` —
     * and both week ranges are named on the block so it can be checked.
     */
    expect(block.vsLastWeek).toBe(3);
    expect(block.weekLabel).toBe("Sep 20 – Sep 26");
    expect(block.previousWeekLabel).toBe("Sep 13 – Sep 19");
    /* Specifically not the delta that used to be printed here. */
    expect(block.vsLastWeek).not.toBe(-2);
  });

  it("counts salons from the listing directory, not from the review rows", () => {
    /*
     * A salon with no review counted this week is still a salon. Counting
     * distinct store codes on the period rows would have dropped it, and a
     * quiet week would shrink the estate.
     */
    const snapshot = snapshotOf(
      [period({ location_id: "loc-a", reporting_period_id: CURRENT_ID, all_reviews: 2, qualifying_reviews: 2, rating_sum: 9 })],
      [
        directory({ location_id: "loc-a", store_code: "306" }),
        directory({ location_id: "loc-b", store_code: "462" }),
        directory({ location_id: "loc-c", store_code: "468" }),
      ],
    );
    const block = deriveReviewsWeekBlock(snapshot, { goalPerSalon: null });
    if (block.status !== "ready") throw new Error("expected figures");

    expect(block.salonCount).toBe(3);
    expect(block.salonCount).toBe(snapshot.locations.length);
    /* Specifically not the length of the seeded array. */
    expect(block.salonCount).not.toBe(15);
  });
});

/* --------------------------------------------------------- a quiet week --- */

describe("a week that counted nothing", () => {
  const quiet = () =>
    snapshotOf(
      [
        period({
          location_id: "loc-a",
          reporting_period_id: PREVIOUS_ID,
          all_reviews: 6,
          qualifying_reviews: 5,
          rating_sum: 26,
        }),
      ],
      [directory({ location_id: "loc-a", store_code: "306" })],
    );

  it("reports zero and a null rating rather than borrowing a figure", () => {
    const block = deriveReviewsWeekBlock(quiet(), { goalPerSalon: 15 });
    if (block.status !== "ready") throw new Error("expected figures");

    expect(block.gained).toBe(0);
    expect(block.allNew).toBe(0);
    /* Null, not 0: "nobody reviewed us" and "everybody gave us nothing" differ. */
    expect(block.averageRating).toBeNull();
    /* The comparison is still real, and it is negative. */
    expect(block.vsLastWeek).toBe(-5);
  });

  it("is a ready week, not a missing one — the reviews are there", () => {
    expect(deriveReviewsWeekBlock(quiet()).status).toBe("ready");
  });
});

describe("an estate holding no review at all", () => {
  it("says so rather than drawing a row of zeroes", () => {
    /*
     * ZERO GAINED, ZERO SALONS AND A DASHED RATING read as a catastrophic week
     * rather than as an integration that has never run. The Performance card
     * draws the same distinction, and for the same reason.
     */
    const block = deriveReviewsWeekBlock(
      snapshotOf([], [directory({ location_id: "loc-a", store_code: "306" })]),
    );
    expect(block.status).toBe("no_data");
    if (block.status !== "no_data") return;
    expect(block.reason).toMatch(/no google review has been synced/i);
  });
});

/* ------------------------------------------------------------ the goal ---- */

describe("the weekly goal", () => {
  it("is the configured per-salon target across the salons in view", () => {
    const block = deriveReviewsWeekBlock(estate(), { goalPerSalon: 15 });
    if (block.status !== "ready") throw new Error("expected figures");

    /* Two salons on this estate, so the target moves with the estate. */
    expect(block.goal).toBe(30);
    expect(block.goalPerSalon).toBe(15);
  });

  it("is null when nothing has been configured, never an invented total", () => {
    /*
     * THE 230 THIS REPLACES was `14 × 15 + 20`, summed from per-salon goals in
     * `data/demo/reviews.ts`. Nothing in Supabase holds a review goal, so an
     * unconfigured deployment gets no meter and no percentage — and still gets
     * a real count, a real rating and a real comparison.
     */
    const block = deriveReviewsWeekBlock(estate(), { goalPerSalon: null });
    if (block.status !== "ready") throw new Error("expected figures");
    expect(block.goal).toBeNull();
    expect(block.goalPerSalon).toBeNull();
  });

  it("reads one number from configuration, and refuses anything else", () => {
    expect(weeklyGoalPerSalon({})).toBeNull();
    expect(weeklyGoalPerSalon({ [WEEKLY_GOAL_PER_SALON_ENV]: "" })).toBeNull();
    expect(weeklyGoalPerSalon({ [WEEKLY_GOAL_PER_SALON_ENV]: " 15 " })).toBe(15);
    /* Zero is a legitimate instruction: no target this week. */
    expect(weeklyGoalPerSalon({ [WEEKLY_GOAL_PER_SALON_ENV]: "0" })).toBe(0);
    /*
     * A TYPO IS UNSET, NOT A DEFAULT. Both alternatives — falling back to a
     * number or coercing to zero — would put a target on the screen that the
     * deployment did not choose, which is the whole failure being corrected.
     */
    expect(weeklyGoalPerSalon({ [WEEKLY_GOAL_PER_SALON_ENV]: "fifteen" })).toBeNull();
    expect(weeklyGoalPerSalon({ [WEEKLY_GOAL_PER_SALON_ENV]: "-5" })).toBeNull();
    expect(weeklyGoalPerSalon({ [WEEKLY_GOAL_PER_SALON_ENV]: "12.5" })).toBeNull();
  });

  it("multiplies out, and stays null when there is nothing to multiply", () => {
    expect(weeklyGoalFor(15, 15)).toBe(225);
    expect(weeklyGoalFor(15, 0)).toBe(0);
    expect(weeklyGoalFor(0, 15)).toBe(0);
    expect(weeklyGoalFor(15, null)).toBeNull();
  });
});

/* ---------------------------------------------------------- the source ---- */

describe("the block's source", () => {
  const strip = (path: string) =>
    readFileSync(path, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");

  it("holds no seeded figure and no second query", () => {
    const source = strip("src/lib/reviews/weekly-block.ts");
    /* The four figures the block used to print. */
    expect(source).not.toMatch(/\b189\b|\b4\.63\b|\b230\b/);
    expect(source).not.toMatch(/DEMO_REVIEW_METRICS|data\/demo/);
    /* No client, no table name, no `from(` — this file derives and nothing else. */
    expect(source).not.toMatch(/getSupabaseAdmin|google_review_/);
  });

  it("keeps the Overview reading the reviews rather than the demo module", () => {
    const source = strip("src/features/dashboard/overview.tsx");
    expect(source).not.toMatch(/DEMO_REVIEW_METRICS/);
    expect(source).not.toMatch(/Google Business Profile is not connected yet/);
  });

  it("reads the week through the Google Reviews page's own loader", () => {
    const source = strip("src/lib/reviews/weekly-block-read.ts");
    /*
     * THE LOAD-BEARING LINE OF THE WHOLE CHANGE. A hand-rolled query here would
     * look entirely reasonable in a diff and would reintroduce the two-sources
     * defect on the first date boundary or salon mapping that differed.
     */
    expect(source).toMatch(/loadReviewsSnapshot/);
    expect(source).toMatch(/deriveReviewsWeekBlock/);
    expect(source).not.toMatch(/\.from\(/);
  });
});
