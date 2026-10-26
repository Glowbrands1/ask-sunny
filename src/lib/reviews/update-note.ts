import { envFlag } from "@/lib/config/chat-quality-flags";

/**
 * A FIXED NOTE AT THE TOP OF THE GOOGLE REVIEWS PAGE, while the review import
 * runs in batches.
 *
 * Pau, 26 Oct 2026, asked for this note on /reviews in both apps and for it to
 * be switched off again when the sync is done. Behind
 * GOOGLE_REVIEWS_UPDATE_NOTE_ENABLED (default off, the same name in the
 * sibling app). Off, the page renders exactly as before.
 *
 * The page is a server component, so the flag is read on the server; there is
 * no browser twin.
 */

export const REVIEWS_UPDATE_NOTE =
  "API update in progress — syncing about 2,000 reviews in batches so the database isn't overloaded. Figures may be incomplete until it finishes.";

export function reviewsUpdateNoteEnabled(): boolean {
  return envFlag("GOOGLE_REVIEWS_UPDATE_NOTE_ENABLED");
}
