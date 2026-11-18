import "server-only";

import { supabaseReadiness } from "@/lib/config/server-env";
import { hasPermission, DEFAULT_PERMISSION_MATRIX } from "@/lib/permissions";
import { reportingScopeOf } from "@/lib/reporting/scope/authorized-salons";
import { EMPTY_REVIEW_FILTERS } from "@/lib/reviews/filters";
import { loadReviewFeed, loadReviewsSnapshot } from "@/lib/reviews/queries";
import type { AccessScope, Role } from "@/types";

import { storeCodesForSalonNumbers } from "./chat-data-plan";
import {
  formatGoogleReviewsBlock,
  formatReviewWeeksSection,
  isGoogleReviewQuestion,
  RECENT_REVIEWS_SHOWN,
  type RecentReview,
  reviewsNotPermittedBlock,
  reviewsUnavailableBlock,
  storeCodesNamedIn,
} from "./google-reviews-chat";

export interface GoogleReviewsChatBlock {
  readonly text: string;
  /** True when the block carries review figures, not only a decline. */
  readonly figures: boolean;
}

/**
 * The newest reviews of these salons counted this reporting week or last (the
 * page's feed, one read per week), newest first by first seen; null when a read
 * failed. Port from Ask Bubbles (QA, 18 Nov 2026).
 */
async function readRecentReviews(storeCodes: readonly string[], weeks: readonly string[]): Promise<RecentReview[] | null> {
  try {
    const storeCode = storeCodes.length === 1 ? storeCodes[0]! : null;
    const feeds = await Promise.all(weeks.map((week) => loadReviewFeed({ ...EMPTY_REVIEW_FILTERS, week, storeCode })));
    return feeds
      .flatMap((feed) => feed.reviews)
      .filter((review) => storeCodes.includes(review.storeCode))
      .sort((a, b) => b.firstSeenAt.localeCompare(a.firstSeenAt))
      .slice(0, RECENT_REVIEWS_SHOWN)
      .map((review) => ({
        storeCode: review.storeCode,
        firstSeenAt: review.firstSeenAt,
        rating: review.rating,
        reviewText: review.reviewText,
        hasOwnerResponse: review.hasOwnerResponse,
      }));
  } catch {
    return null;
  }
}

/**
 * The Google review block for one chat turn, or null when the question is not
 * about Google reviews.
 *
 * View Google reviews is checked first: without it nothing is read. The rows
 * are the ones /reviews shows this caller (every salon; the page does not
 * narrow by assignment), narrowed to any salon the question names, with the
 * caller's own salons marked. The figures and the last sync come from
 * `loadReviewsSnapshot`, the read the page renders. Below them, this reporting
 * week and last with each salon's average rating (the same snapshot rows), and
 * the newest reviews from the page's feed; a failed feed read says so in the
 * block and never fails the figures.
 */
export async function loadGoogleReviewsChatBlock(input: {
  readonly question: string;
  readonly role: Role | null;
  readonly scope: AccessScope | null;
  readonly now?: Date;
}): Promise<GoogleReviewsChatBlock | null> {
  if (!isGoogleReviewQuestion(input.question)) return null;

  if (input.role === null || !hasPermission(DEFAULT_PERMISSION_MATRIX, input.role, "view_google_reviews")) {
    return { text: reviewsNotPermittedBlock(), figures: false };
  }

  if (!supabaseReadiness().ready) {
    return { text: reviewsUnavailableBlock("This deployment cannot read the Google review records."), figures: false };
  }

  const scope = reportingScopeOf(input.scope);
  const own = new Set(scope.unrestricted ? [] : storeCodesForSalonNumbers(scope.salonNumbers));
  const named = storeCodesNamedIn(input.question);

  try {
    const snapshot = await loadReviewsSnapshot({ district: null, storeCode: null });
    if (snapshot.empty) {
      return { text: reviewsUnavailableBlock("No Google review has been synced into Ask Sunny yet."), figures: false };
    }
    const locations = snapshot.locations.filter(
      (location) => named.length === 0 || named.includes(location.storeCode),
    );
    const month = formatGoogleReviewsBlock({
      goal: snapshot.goal,
      locations,
      ownStoreCodes: own,
      lastSyncAt: snapshot.lastSyncAt,
      now: input.now ?? new Date(),
    });
    /* This reporting week and last, and the newest reviews (port from Ask Bubbles, QA 18 Nov 2026). */
    const weeks =
      locations.length > 0 && snapshot.currentWeek && snapshot.previousWeek
        ? formatReviewWeeksSection({
            currentWeek: snapshot.currentWeek,
            previousWeek: snapshot.previousWeek,
            today: snapshot.goal.today,
            locations,
            ownStoreCodes: own,
            recent: await readRecentReviews(
              locations.map((location) => location.storeCode),
              [snapshot.currentWeek, snapshot.previousWeek],
            ),
          })
        : null;
    return {
      text: weeks ? `${month}\n\n${weeks}` : month,
      figures: locations.length > 0,
    };
  } catch {
    return { text: reviewsUnavailableBlock("The Google review figures could not be read just now."), figures: false };
  }
}
