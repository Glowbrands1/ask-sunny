import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { ratingDistribution } from "./rating-distribution";
import {
  averageFromRatingCounts,
  deriveReviewsOverview,
} from "./overview-block";

/**
 * ============================================================================
 * THE OVERVIEW'S GOOGLE REVIEWS BLOCK — THE INVENTORY, NOT THE WEEK
 * ============================================================================
 *
 * WHAT THESE CASES ARE REALLY ASSERTING. The block reported the open reporting
 * period, and every figure in it was a true zero until a baseline had been set
 * and a review had arrived above it — correct for `/reviews`, unreadable on a
 * landing page. It now reports the review RECORDS.
 *
 * So the distributions below are built by `ratingDistribution` — the same
 * function `loadRatingDistribution` hands the tab's rating card — rather than
 * stated as totals. A case that passes here is a case where the Overview's
 * total and the tab's rating heading came out of one set of counts.
 *
 * AND NOTHING HERE MENTIONS A PERIOD, AN ANCHOR OR A BASELINE, which is the
 * property the whole change exists to establish: those still decide `/reviews`
 * and they no longer decide anything on the home page.
 */

/** The estate as production holds it today: 1×1★, 2×2★, 1×3★, 1×4★, 83×5★. */
const PRODUCTION_SHAPE = [1, 2, 1, 1, 83] as const;

describe("the figures on the Overview block", () => {
  it("totals every review record held, whatever period it counts in", () => {
    const block = deriveReviewsOverview({
      distribution: ratingDistribution([...PRODUCTION_SHAPE]),
      salonCount: 15,
    });

    expect(block.status).toBe("ready");
    if (block.status !== "ready") return;

    /*
     * 88 — and not because 88 is written anywhere. It is the sum of the five
     * per-star counts, derived by `ratingDistribution`, which is what the tab's
     * rating card prints in its own heading.
     */
    expect(block.totalReviews).toBe(88);
    expect(block.totalReviews).toBe(
      PRODUCTION_SHAPE.reduce((running, count) => running + count, 0),
    );
  });

  it("averages every one of those records, not the ones a period counted", () => {
    const block = deriveReviewsOverview({
      distribution: ratingDistribution([...PRODUCTION_SHAPE]),
      salonCount: 15,
    });
    if (block.status !== "ready") throw new Error("expected figures");

    /* 1 + 4 + 3 + 4 + 415 = 427 stars over 88 reviews. */
    expect(block.averageRating).toBeCloseTo(427 / 88, 10);
    expect(block.averageRating).toBeCloseTo(4.8523, 4);
    /* Specifically not the figure the seeded block used to print. */
    expect(block.averageRating).not.toBe(4.63);
  });

  it("reports the salons it was given, from the listing directory", () => {
    const block = deriveReviewsOverview({
      distribution: ratingDistribution([0, 0, 0, 0, 3]),
      salonCount: 15,
    });
    if (block.status !== "ready") throw new Error("expected figures");
    expect(block.salonCount).toBe(15);
  });

  it("moves with the records: two genuinely new reviews take 88 to 90", () => {
    /*
     * THE BEHAVIOUR THE BRIEF NAMES. A sync that fetches 69 rows and creates
     * none changes nothing, because nothing here reads a sync run — the figures
     * are the stored rows. Two new 5-star records are two more in the bucket.
     */
    const before = deriveReviewsOverview({
      distribution: ratingDistribution([...PRODUCTION_SHAPE]),
      salonCount: 15,
    });
    const after = deriveReviewsOverview({
      distribution: ratingDistribution([1, 2, 1, 1, 85]),
      salonCount: 15,
    });

    if (before.status !== "ready" || after.status !== "ready") {
      throw new Error("expected figures");
    }
    expect(before.totalReviews).toBe(88);
    expect(after.totalReviews).toBe(90);
    /* And the average moves with them rather than being recomputed elsewhere. */
    expect(after.averageRating).toBeCloseTo((427 + 10) / 90, 10);
  });

  it("does not dash the average because a reporting period is empty", () => {
    /*
     * THE DEFECT THIS REPLACES, stated as a test. The block drew an em dash
     * whenever the OPEN PERIOD held nothing — which, on an estate whose
     * baselines were set this morning, is every figure on the card. An
     * inventory of 88 reviews has an average whatever the period did.
     */
    const block = deriveReviewsOverview({
      distribution: ratingDistribution([...PRODUCTION_SHAPE]),
      salonCount: 15,
    });
    if (block.status !== "ready") throw new Error("expected figures");
    expect(block.averageRating).not.toBeNull();
  });
});

describe("an estate holding no review at all", () => {
  it("says so rather than drawing a row of zeroes", () => {
    const block = deriveReviewsOverview({
      distribution: ratingDistribution([0, 0, 0, 0, 0]),
      salonCount: 15,
    });
    expect(block.status).toBe("no_data");
    if (block.status !== "no_data") return;
    expect(block.reason).toMatch(/no google review has been synced/i);
  });
});

describe("the average", () => {
  it("is null with nothing to average, never zero", () => {
    /* "Nobody reviewed us" and "everybody gave us nothing" are different. */
    expect(averageFromRatingCounts([0, 0, 0, 0, 0])).toBeNull();
  });

  it("weights each bucket by its star, not by its position", () => {
    expect(averageFromRatingCounts([1, 0, 0, 0, 1])).toBeCloseTo(3, 10);
    expect(averageFromRatingCounts([0, 0, 0, 0, 4])).toBeCloseTo(5, 10);
    expect(averageFromRatingCounts([4, 0, 0, 0, 0])).toBeCloseTo(1, 10);
    expect(averageFromRatingCounts([0, 1, 1, 1, 1])).toBeCloseTo(3.5, 10);
  });
});

/* ---------------------------------------------------------- the source ---- */

describe("the block's source", () => {
  const strip = (path: string) =>
    readFileSync(path, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");

  it("holds no seeded figure, no period and no second query", () => {
    const source = strip("src/lib/reviews/overview-block.ts");
    /* The four figures this block carried before any of it was real. */
    expect(source).not.toMatch(/\b189\b|\b4\.63\b|\b230\b/);
    expect(source).not.toMatch(/DEMO_REVIEW_METRICS|data\/demo/);
    /* No client, no table name — this file derives and nothing else. */
    expect(source).not.toMatch(/getSupabaseAdmin|google_review_/);
    /*
     * AND NOTHING ABOUT THE WEEK. A reporting period, an anchor or a
     * qualification rule reappearing here is the regression this guards: the
     * baseline system still runs, and the home page no longer depends on it.
     */
    expect(source).not.toMatch(
      /reportingPeriod|periodStart|qualifying|anchor|weeklyGoal|vsLastWeek/i,
    );
  });

  it("reads the records through the tab's own two functions", () => {
    const source = strip("src/lib/reviews/overview-block-read.ts");
    /*
     * THE LOAD-BEARING LINE OF THE CHANGE. A hand-rolled count here would look
     * entirely reasonable in a diff and would reintroduce the two-sources
     * defect on the first mapping or dedupe rule that differed.
     */
    expect(source).toMatch(/loadRatingDistribution/);
    expect(source).toMatch(/countReviewLocations/);
    expect(source).toMatch(/deriveReviewsOverview/);
    expect(source).not.toMatch(/\.from\(/);
    /* And it reads no period: `loadReviewsSnapshot` is the weekly read. */
    expect(source).not.toMatch(/loadReviewsSnapshot|summariseReviews/);
  });

  it("keeps the weekly machinery intact for the Google Reviews page", () => {
    /*
     * THE OTHER HALF OF THE BRIEF. Simplifying the Overview must not simplify
     * `/reviews`: its snapshot, its weekly summary and its period rollups are
     * still exactly where they were.
     */
    const queries = strip("src/lib/reviews/queries.ts");
    expect(queries).toMatch(/export async function loadReviewsSnapshot/);
    expect(queries).toMatch(/google_review_location_periods/);
    const aggregate = strip("src/lib/reviews/aggregate.ts");
    expect(aggregate).toMatch(/export function summariseReviews/);
    expect(aggregate).toMatch(/qualifyingThisWeek/);
  });
});
