import { announceFormUpdate } from "@/features/chat/form-update-events";
import { FormsFetchError } from "@/features/forms/forms-fetch";
import { FORM_ALREADY_REVISED } from "@/lib/forms/revision-history";

/**
 * REVISED_FORM_POINTS_TO_NEWER_ENABLED: the server refused an edit because a newer version already replaced the form
 * (a card loaded before that revision was finalized elsewhere). Every view of the form re-reads it, so the card shows
 * "Revised" and its link to the newer version. Nothing is revised. The server sends this code only with the flag on;
 * for any other error this does nothing and returns false.
 */
export function reloadIfAlreadyRevised(error: unknown, instanceId: string): boolean {
  if (!(error instanceof FormsFetchError) || error.code !== FORM_ALREADY_REVISED) return false;
  announceFormUpdate(instanceId);
  return true;
}
