import "server-only";

import { supabaseReadiness } from "@/lib/config/server-env";
import { hasPermission, DEFAULT_PERMISSION_MATRIX } from "@/lib/permissions";
import { reportingScopeOf } from "@/lib/reporting/scope/authorized-salons";
import { loadReviewsSnapshot } from "@/lib/reviews/queries";
import type { AccessScope, Role } from "@/types";

import { storeCodesForSalonNumbers } from "./chat-data-plan";
import {
  formatGoogleReviewsBlock,
  isGoogleReviewQuestion,
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
 * The Google review block for one chat turn, or null when the question is not
 * about Google reviews.
 *
 * View Google reviews is checked first: without it nothing is read. The rows
 * are the ones /reviews shows this caller (every salon; the page does not
 * narrow by assignment), narrowed to any salon the question names, with the
 * caller's own salons marked. The figures and the last sync come from
 * `loadReviewsSnapshot`, the read the page renders.
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
    return {
      text: formatGoogleReviewsBlock({
        goal: snapshot.goal,
        locations,
        ownStoreCodes: own,
        lastSyncAt: snapshot.lastSyncAt,
        now: input.now ?? new Date(),
      }),
      figures: locations.length > 0,
    };
  } catch {
    return { text: reviewsUnavailableBlock("The Google review figures could not be read just now."), figures: false };
  }
}
