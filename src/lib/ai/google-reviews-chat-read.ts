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
 * View Google reviews is checked first: without it nothing is read. The
 * listings are the caller's salons (the same scope the report reads use),
 * narrowed to any salon the question names. The figures come from
 * `loadReviewsSnapshot`, the read /reviews renders.
 */
export async function loadGoogleReviewsChatBlock(input: {
  readonly question: string;
  readonly role: Role | null;
  readonly scope: AccessScope | null;
}): Promise<GoogleReviewsChatBlock | null> {
  if (!isGoogleReviewQuestion(input.question)) return null;

  if (input.role === null || !hasPermission(DEFAULT_PERMISSION_MATRIX, input.role, "view_google_reviews")) {
    return { text: reviewsNotPermittedBlock(), figures: false };
  }

  const scope = reportingScopeOf(input.scope);
  const allowed = new Set(scope.unrestricted ? [] : storeCodesForSalonNumbers(scope.salonNumbers));
  const mayRead = (storeCode: string) => scope.unrestricted || allowed.has(storeCode);
  const named = storeCodesNamedIn(input.question);
  const outOfScope = named.filter((storeCode) => !mayRead(storeCode));
  const wanted = named.length > 0 ? named.filter(mayRead) : null;

  if (wanted !== null && wanted.length === 0) {
    return { text: formatGoogleReviewsBlock({ goal: null, locations: [], outOfScopeStoreCodes: outOfScope }), figures: false };
  }

  if (!supabaseReadiness().ready) {
    return { text: reviewsUnavailableBlock("This deployment cannot read the Google review records."), figures: false };
  }

  try {
    const snapshot = await loadReviewsSnapshot({ district: null, storeCode: null });
    if (snapshot.empty) {
      return { text: reviewsUnavailableBlock("No Google review has been synced into Ask Sunny yet."), figures: false };
    }
    const locations = snapshot.locations.filter(
      (location) => mayRead(location.storeCode) && (wanted === null || wanted.includes(location.storeCode)),
    );
    return {
      text: formatGoogleReviewsBlock({ goal: snapshot.goal, locations, outOfScopeStoreCodes: outOfScope }),
      figures: locations.length > 0,
    };
  } catch {
    return { text: reviewsUnavailableBlock("The Google review figures could not be read just now."), figures: false };
  }
}
