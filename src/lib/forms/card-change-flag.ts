/**
 * NEXT_PUBLIC_CARD_CHANGE_ENABLED (owner and QA, 27 Oct 2026; same flag in
 * both apps): the form card offers "Change something", which sends the
 * manager's choices as one chat turn (`card-change-sentence.ts`). Read at
 * build time, so turning it on needs a redeploy that rebuilds; default off.
 */
export function cardChangeEnabled(): boolean {
  const raw = process.env.NEXT_PUBLIC_CARD_CHANGE_ENABLED;
  return typeof raw === "string" && ["1", "true", "yes", "on"].includes(raw.trim().toLowerCase());
}
