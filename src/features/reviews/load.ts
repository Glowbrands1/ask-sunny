import "server-only";

import { pageCan } from "@/lib/auth/page";
import { googleReviewsToday } from "@/lib/reviews/timezone";
import { supabaseReadiness } from "@/lib/config/server-env";
import {
  parseReviewFilters,
  WEEK_ALL,
  type ReviewFilters,
} from "@/lib/reviews/filters";
import {
  loadRatingDistribution,
  loadReviewDetail,
  loadReviewFeed,
  loadReviewTimeline,
  loadReviewsSnapshot,
  type ReviewFeed,
  type ReviewsSnapshot,
} from "@/lib/reviews/queries";
import type { ReviewTimeline } from "@/lib/reviews/timeline";
import type { DashboardReview, RatingDistribution } from "@/lib/reviews/types";

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
      /**
       * The over-time chart's series, built from the review RECORDS.
       *
       * Separate from `snapshot.trend`, which is the reporting figure and reads
       * the periods. The two answer different questions and are captioned as
       * two; see `lib/reviews/timeline.ts` for why neither can stand in for the
       * other.
       */
      timeline: ReviewTimeline & { truncated: boolean };
      /**
       * The star breakdown of the synced review RECORDS.
       *
       * Read alongside the timeline and for the same reason: both describe the
       * reviews themselves rather than the reporting periods, so neither can be
       * taken from `snapshot.summary`, which is summed from the period rollup
       * and is empty until baselines are set. See `loadRatingDistribution`.
       */
      ratingDistribution: RatingDistribution;
      /** The review whose detail panel is open, when the URL names one. */
      openReview: DashboardReview | null;
      today: string;
      /**
       * Whether to OFFER the baseline setup screen from the anchor markers.
       *
       * The dashboard is read by most of the org chart; setting a baseline is
       * Administration-only. Anybody may see that a listing is counting
       * nothing — that fact explains the zero beside it and is not privileged —
       * but only somebody who can act on it is given the link, because a link
       * that bounces the person who follows it reads as a broken screen.
       */
      canManageAnchors: boolean;
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
  const today = googleReviewsToday();

  /*
   * ==========================================================================
   * THE NEEDS-RESPONSE TAB IS A SCOPE ON THE FEED, NOT A SECOND IDEA OF "OPEN"
   * ==========================================================================
   *
   * The tab shows the reviews still waiting for a reply, and it decides that by
   * the same `response_status` every other part of this page reads — it simply
   * asks the feed for those rows rather than filtering a page of mixed ones in
   * the browser, which would have the tab's count disagree with its list.
   *
   * IT IS OVER EVERYTHING HELD, NOT OVER THE OPEN WEEK, for the reason the
   * alarm tile's link already records: an unanswered review does not stop
   * needing an answer because a reporting period closed. The week and the
   * assignment are therefore widened here, exactly as that link widens them.
   *
   * NOTHING ABOUT RESPONSE DETECTION CHANGES. This narrows a query; it does not
   * decide what "responded" means, which the database does.
   */
  const feedFilters: ReviewFilters =
    filters.tab === "needs"
      ? {
          ...filters,
          status: "needs_response",
          week: WEEK_ALL,
          assignment: "all",
          qualifying: "all",
        }
      : filters;

  /*
   * THE SNAPSHOT, THE FEED AND THE TIMELINE GO TOGETHER. They share the
   * filters, none depends on another's result, and running them in sequence
   * would be three full round trips on every render for nothing. The same shape
   * `loadAnalyticsPage` uses.
   *
   * ALL FOUR TABS ARE LOADED ON EVERY REQUEST, deliberately. The reads are the
   * same three whichever view is open, so switching tabs costs a render rather
   * than a round trip — and the leaderboard, the chart and the feed cannot end
   * up describing different moments in time.
   */
  const [snapshot, feed, timeline, distribution, openReview, canManageAnchors] =
    await Promise.all([
      loadReviewsSnapshot(filters, today),
      loadReviewFeed(feedFilters, today),
      loadReviewTimeline(filters),
      /*
       * THE SAME PAIR OF FILTERS THE SNAPSHOT TAKES, and no more. The rating
       * distribution narrows by location and district exactly as every other
       * Overview figure does; it deliberately ignores the rating filter, which
       * would collapse a distribution to a single bar, and the weekly ones,
       * which have no business deciding what a customer gave.
       */
      loadRatingDistribution(filters),
      filters.openReviewId ? loadReviewDetail(filters.openReviewId) : Promise.resolve(null),
      pageCan("manage_integrations"),
    ]);

  return {
    mode: "live",
    filters,
    snapshot,
    feed,
    timeline,
    ratingDistribution: distribution,
    openReview,
    today,
    canManageAnchors,
  };
}
