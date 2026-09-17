import "server-only";

import { businessToday } from "@/lib/business-date";
import { supabaseReadiness } from "@/lib/config/server-env";
import { parseReviewFilters, type ReviewFilters } from "@/lib/reviews/filters";
import {
  loadReviewDetail,
  loadReviewFeed,
  loadReviewsSnapshot,
  type ReviewFeed,
  type ReviewsSnapshot,
} from "@/lib/reviews/queries";
import type { DashboardReview } from "@/lib/reviews/types";

/**
 * EVERYTHING THE GOOGLE REVIEWS PAGE NEEDS, LOADED ONCE.
 *
 * ============================================================================
 * THIS PAGE DOES NOT CONSULT DEMO MODE, AND THAT IS DELIBERATE
 * ============================================================================
 *
 * Salon Performance already reads real reporting data whatever the mode flag
 * says, and `runtime.ts` records why: the flag is baked into the bundle at
 * build time and can go stale, so a screen whose value depends on showing REAL
 * figures must not be gated on it. Google Reviews is now in that category —
 * the whole point of Phase 1 is that the dashboard shows the actual reviews.
 *
 * So the fallback here is keyed on the only thing that genuinely decides
 * whether real data is reachable: WHETHER SUPABASE IS CONFIGURED. A deployment
 * with credentials reads Supabase and shows what is there, including nothing.
 * A deployment without them cannot, and gets the clearly-labelled seeded screen
 * instead of an error.
 *
 * "NOTHING INGESTED YET" IS A REAL ANSWER AND IS SHOWN AS ONE. It is not a
 * reason to fall back to seeded content — that is exactly how a demo figure
 * ends up being read as a real one.
 */

export type ReviewsPageProps =
  | {
      mode: "live";
      filters: ReviewFilters;
      snapshot: ReviewsSnapshot;
      feed: ReviewFeed;
      /** The review whose detail panel is open, when the URL names one. */
      openReview: DashboardReview | null;
      today: string;
    }
  | {
      mode: "unconfigured";
      /** Variable NAMES only. Never a value. */
      missing: string[];
    };

export async function loadReviewsPage(
  searchParams: Record<string, string | string[] | undefined>,
): Promise<ReviewsPageProps> {
  const readiness = supabaseReadiness();
  if (!readiness.ready) {
    return { mode: "unconfigured", missing: readiness.missing };
  }

  const filters = parseReviewFilters(searchParams);
  const today = businessToday();

  /*
   * THE SNAPSHOT AND THE FEED GO TOGETHER. They share the filters, neither
   * depends on the other's result, and running them in sequence would be a
   * second full round trip on every render for nothing. The same shape
   * `loadAnalyticsPage` uses.
   */
  const [snapshot, feed, openReview] = await Promise.all([
    loadReviewsSnapshot(filters, today),
    loadReviewFeed(filters, today),
    filters.openReviewId ? loadReviewDetail(filters.openReviewId) : Promise.resolve(null),
  ]);

  return { mode: "live", filters, snapshot, feed, openReview, today };
}
