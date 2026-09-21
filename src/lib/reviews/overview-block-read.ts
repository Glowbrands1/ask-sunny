import "server-only";

import { cache } from "react";

import { supabaseReadiness } from "@/lib/config/server-env";
import { countReviewLocations, loadRatingDistribution } from "./queries";
import { deriveReviewsOverview, type ReviewsOverviewBlock } from "./overview-block";

/**
 * THE OVERVIEW'S READ OF THE GOOGLE REVIEW INVENTORY — two counts, no period.
 *
 * ============================================================================
 * IT CALLS THE FUNCTIONS THE GOOGLE REVIEWS TAB CALLS
 * ============================================================================
 *
 * `loadRatingDistribution` is the tab's own read for its rating card: five
 * exact `HEAD` counts over `google_reviews_enriched`, which is the canonical
 * review table with its listing and salon joined on. `countReviewLocations`
 * counts the same listing directory the tab's salons chip counts. This module
 * adds no query of its own and no arithmetic of its own — it hands both to a
 * pure projection and returns what comes back.
 *
 * SO THE TOTAL IS THE TAB'S TOTAL. The heading over the tab's rating card
 * prints the same figure from the same five counts; if the two ever disagreed
 * it would be because the database disagreed with itself.
 *
 * NO BASELINE, NO ANCHOR, NO REPORTING PERIOD reaches this read. The weekly
 * machinery still exists, still runs, and still produces `/reviews` — it simply
 * has nothing to do with the question this block asks.
 *
 * UNFILTERED, because the block is the whole estate and its Open button lands
 * on the tab with no filters applied, so the two describe one population.
 *
 * `cache` IS PER REQUEST, the same shape `loadReportingOverview` uses.
 *
 * A FAILED READ NEVER BECOMES A FIGURE — the home page survives it as a
 * sentence inside the block.
 */
export const loadReviewsOverviewBlock = cache(
  async function loadReviewsOverviewBlock(): Promise<ReviewsOverviewBlock> {
    const readiness = supabaseReadiness();
    if (!readiness.ready) {
      /* Variable NAMES are safe to print and are what an operator needs. */
      return {
        status: "no_data",
        reason: `This runtime is not configured to read Google review data (${readiness.missing.join(
          ", ",
        )}).`,
      };
    }

    try {
      const [distribution, salonCount] = await Promise.all([
        loadRatingDistribution({ district: null, storeCode: null }),
        countReviewLocations(),
      ]);
      return deriveReviewsOverview({ distribution, salonCount });
    } catch {
      /*
       * THE MESSAGE IS OURS, NOT THE DRIVER'S. A PostgREST error carries table
       * and column names onto the landing page of an app most of the org chart
       * reads, and none of it helps the person standing in front of it.
       */
      return {
        status: "error",
        message: "Google review figures could not be read just now.",
      };
    }
  },
);
