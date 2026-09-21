import "server-only";

import { cache } from "react";

import { supabaseReadiness } from "@/lib/config/server-env";
import { loadReviewsSnapshot } from "./queries";
import { deriveReviewsWeekBlock, type ReviewsWeekBlock } from "./weekly-block";

/**
 * THE OVERVIEW'S READ OF THE GOOGLE REVIEWS WEEK — one call, one snapshot.
 *
 * ============================================================================
 * IT CALLS THE FUNCTION THE GOOGLE REVIEWS TAB CALLS
 * ============================================================================
 *
 * `loadReviewsSnapshot` is the Google Reviews page's own read: the reporting
 * periods, the rollup views, the listing directory and the Sunday-to-Saturday
 * week boundary, all decided in one place. This module adds no query, no view,
 * no table and no arithmetic of its own — it hands the snapshot to a pure
 * projection and returns what comes back. That is what makes "the tab says 174
 * and the Overview says 189" structurally impossible rather than something a
 * reviewer has to check.
 *
 * UNFILTERED, BECAUSE THE TAB LANDS UNFILTERED. The bar is the whole estate's
 * week and the Open button opens the tab with no filters applied, so the two
 * describe the same population. District and store filters live in the tab's
 * URL and belong to it.
 *
 * `cache` IS PER REQUEST, so the block and any future second presentation of it
 * cost one read between them — the same shape `loadReportingOverview` uses for
 * the Performance card and its collapsed strip.
 *
 * A FAILED READ NEVER BECOMES A FIGURE. The home page survives it as a sentence
 * inside the block; what it must never do is fall back to a placeholder, which
 * is the defect this whole change exists to remove.
 */
export const loadReviewsWeekBlock = cache(async function loadReviewsWeekBlock(): Promise<ReviewsWeekBlock> {
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
    const snapshot = await loadReviewsSnapshot({ district: null, storeCode: null });
    return deriveReviewsWeekBlock(snapshot);
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
});
