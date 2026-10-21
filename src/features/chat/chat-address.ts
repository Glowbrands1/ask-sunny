/**
 * ============================================================================
 * THE OPEN CONVERSATION IS PART OF THE ADDRESS
 * ============================================================================
 *
 * `/chat?c=<id>` already opened a conversation — the Overview band's "Continue
 * in Ask Sunny" link uses it. What was missing was the other direction: picking
 * a thread from History, or asking the first question of a new one, never wrote
 * the id back, so a reload landed on an empty chat and the manager had to go
 * looking for the draft they were in the middle of.
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
 * Next's App Router keeps `useSearchParams` in step with `replaceState`.
 */
export function writeChatAddress(activeId: string | null): void {
  if (typeof window === "undefined") return;
  const next = chatAddressFor(window.location.search, activeId);
  if (next === null) return;
  const { pathname } = window.location;
  window.history.replaceState(null, "", next ? `${pathname}?${next}` : pathname);
}
