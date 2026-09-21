import type { RatingDistribution } from "./types";

/**
 * ============================================================================
 * THE OVERVIEW'S GOOGLE REVIEWS BLOCK — THE INVENTORY, NOT THE WEEK
 * ============================================================================
 *
 * WHAT CHANGED AND WHY. This block used to report the open reporting period:
 * qualifying reviews gained, the week-over-week delta, a goal meter and the
 * period's own average. Every one of those figures is correct and every one of
 * them is ZERO until a listing's baseline has been set and a review has arrived
 * ABOVE it — which is right for `/reviews`, where the weekly count is the
 * product, and wrong for a landing page that is being asked the much simpler
 * question "how many Google reviews do we have, and what are they averaging".
 *
 * So the Overview no longer reads a period at all. It reads the REVIEW RECORDS:
 * the deduplicated rows Ask Sunny holds for the fifteen mapped listings.
 *
 *   TOTAL REVIEWS   every canonical review record held
 *   AVERAGE RATING  the mean star across those same records
 *   SALONS          the mapped listings, from the same directory the tab counts
 *
 * ============================================================================
 * NOTHING HERE TOUCHES THE BASELINE SYSTEM, AND NOTHING HERE DEPENDS ON IT
 * ============================================================================
 *
 * No anchor, no `reporting_period_id`, no `eligible_for_weekly_count`, no
 * period row. `/reviews` keeps every one of them and its weekly arithmetic is
 * untouched — this is a different question asked of the same records, in the
 * same way the tab's own rating card and over-time chart already ask one.
 *
 * ============================================================================
 * THE COUNT IS THE RECORDS, NOT WHAT A SYNC FETCHED
 * ============================================================================
 *
 * A sync that fetches 69 rows and creates none changes nothing here, because
 * nothing here reads a sync run: the figures come from the stored rows, which
 * are deduplicated on Google's own review id. Two genuinely new reviews take
 * the total from 88 to 90 on the next page load, with no further work.
 *
 * Client-safe: no database client, no secret, no `server-only` import. The
 * `RatingDistribution` import is a type only and is erased at compile time.
 */

/** The three figures the block draws, and the population they cover. */
export interface ReviewsOverviewFigures {
  readonly status: "ready";
  /** Every canonical review record held across the mapped listings. */
  readonly totalReviews: number;
  /**
   * The mean star across those same records, or null when none are held.
   *
   * NEVER NULL MERELY BECAUSE A REPORTING PERIOD IS EMPTY — that was the old
   * block's em dash and it is the defect this replaces. Null here means one
   * thing only: there is no review to average.
   */
  readonly averageRating: number | null;
  /** Mapped Google listings — the tab's own salon count. */
  readonly salonCount: number;
}

export type ReviewsOverviewBlock =
  | ReviewsOverviewFigures
  /** Nothing held yet, or this runtime cannot read the reviews. */
  | { readonly status: "no_data"; readonly reason: string }
  /** A read failed. The block says so; it never falls back to a figure. */
  | { readonly status: "error"; readonly message: string };

/**
 * The mean star from the five exact per-star counts.
 *
 * WHY FROM THE DISTRIBUTION rather than from an average column: the counts are
 * five exact `HEAD` counts over the review records, so the mean is derived from
 * the same numbers the Google Reviews tab's rating card prints and cannot drift
 * from them. Every stored review carries a rating of 1 to 5 — the database
 * constrains it — so every record is in exactly one bucket and the divisor is
 * the total.
 *
 * Null when there is nothing to average. Never 0: "no reviews" and "everybody
 * gave us nothing" are different answers.
 */
export function averageFromRatingCounts(
  counts: readonly [number, number, number, number, number],
): number | null {
  const total = counts.reduce((running, count) => running + count, 0);
  if (total === 0) return null;
  const stars = counts.reduce((running, count, index) => running + count * (index + 1), 0);
  return stars / total;
}

/**
 * The block, from the records.
 *
 * AN ESTATE HOLDING NO REVIEW IS `no_data`, not a row of zeroes: "0 reviews,
 * — average, 0 salons" reads as a catastrophe rather than as an integration
 * that has never run. That distinction is the same one the Performance
 * Overview card draws, and the same one this block has always drawn.
 */
export function deriveReviewsOverview(input: {
  distribution: RatingDistribution;
  salonCount: number;
}): ReviewsOverviewBlock {
  if (input.distribution.total === 0) {
    return {
      status: "no_data",
      reason: "No Google review has been synced into Ask Sunny yet.",
    };
  }

  return {
    status: "ready",
    /*
     * THE SUM OF THE FIVE BUCKETS, derived by `ratingDistribution` itself, so
     * the total and the average are computed over one population by
     * construction rather than by two reads that have to agree.
     */
    totalReviews: input.distribution.total,
    averageRating: averageFromRatingCounts(input.distribution.counts),
    salonCount: input.salonCount,
  };
}
