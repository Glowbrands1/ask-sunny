/**
 * ============================================================================
 * THE OPEN CONVERSATION IS PART OF THE ADDRESS
 * ============================================================================
 *
 * The chat screen already reopened a conversation named by `/chat?c=<id>`, but
 * nothing ever wrote the id: picking a thread from the rail, or asking the
 * first question of a new one, left the address at `/chat`. A refresh then
 * landed on an empty "How can Sunny help today?" screen, and a manager midway
 * through a Corrective Action had to find the thread again in History (QA, 22
 * Oct 2026).
 *
 * `?q=` LEAVES THE ADDRESS AS SOON AS A CONVERSATION IS OPEN. It is a question
 * to ask once, on arrival. Left in place it would be asked again on the next
 * reload, into whatever thread `?c=` reopened.
 *
 * Every other parameter — the report context "Ask Sunny about this report"
 * carries — is kept as it is.
 *
 * Returns the new query string, or null when nothing would change, so the
 * caller never rewrites the history entry for no reason.
 */
export function chatAddressFor(search: string, activeId: string | null): string | null {
  const before = new URLSearchParams(search);
  const after = new URLSearchParams(search);
  if (activeId) after.set("c", activeId);
  else after.delete("c");
  after.delete("q");
  return after.toString() === before.toString() ? null : after.toString();
}

/**
 * Rewrites the CURRENT history entry rather than adding one, so Back still
 * leaves the chat instead of stepping through every thread that was opened.
 * Next's App Router keeps `useSearchParams` in step with `replaceState` — but
 * only for state it did not write itself, which is why `null` is passed and
 * not `history.state` (that carries the router's own marker, and the router
 * would then ignore the new address).
 */
export function writeChatAddress(activeId: string | null): void {
  if (typeof window === "undefined") return;
  const next = chatAddressFor(window.location.search, activeId);
  if (next === null) return;
  const { pathname, hash } = window.location;
  window.history.replaceState(null, "", `${pathname}${next ? `?${next}` : ""}${hash}`);
}
