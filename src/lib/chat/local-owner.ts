import type { ChatConversation } from "@/types";

/**
 * ============================================================================
 * A CHAT IN THIS BROWSER IS SHOWN ONLY TO THE ACCOUNT THAT WROTE IT
 * ============================================================================
 *
 * NEXT_PUBLIC_CHAT_LOCAL_OWNER_ENABLED (ported from Ask Bubbles, QA 30 Oct
 * 2026; same flag in both apps). The local chat store is one per browser, not
 * one per person. In the sibling app a manager chatted, another account signed
 * in on the same browser, saw the manager's chats in the sidebar and pressed
 * Import, and the manager's chats were copied into the other account; here
 * QA counted 70 chats held by the wrong account the same way. CHAT_IMPORT_OWN_ONLY_ENABLED stops the server accepting them;
 * this stops the browser showing them.
 *
 * Each local chat is stamped with an opaque key for the account that wrote it
 * (`ownerKey`, from the history state the server returns to that account; a
 * hash, never the account id). Until the key is known nothing already stored
 * is shown. Then:
 *
 *   stamped with this account's key          shown
 *   stamped with another account's key       held back: kept in the browser
 *                                            as it was, never shown, offered
 *                                            for Import or synced
 *   unstamped, and this account stores it    shown, and stamped as this one's
 *   unstamped, and this account does not     HELD BACK, like another account's
 *
 * THE LAST ROW CHANGED (owner, 23 Nov 2026: "that chats from other account
 * leak to other poeples log in, i dont want that"). It used to be "shown as
 * before, not stamped" (Pau, 31 Oct 2026: "Keep them visible"), which left a
 * legacy unstamped chat visible to whoever signed in next on a shared
 * browser. A chat is now shown only when it is provably this account's: its
 * key, or the account's own server copy. An unstamped chat nobody can be
 * shown to own stays in the browser untouched, never shown, imported or
 * synced. Its writer still sees it if the server holds it for them (it is
 * then "stored"); one that never reached the server stays only in that
 * browser's storage. Nothing is deleted.
 */

export function chatLocalOwnerEnabled(): boolean {
  // Only a statically written `process.env.NEXT_PUBLIC_…` is inlined by Next.
  const raw = process.env.NEXT_PUBLIC_CHAT_LOCAL_OWNER_ENABLED;
  return typeof raw === "string" && ["1", "true", "on", "yes"].includes(raw.trim().toLowerCase());
}

export type OwnedConversation = ChatConversation & { ownerKey?: string };

/**
 * Splits this browser's chats: the account's own (`mine`, to stamp), and
 * everything else (`others`, held back): another account's, and legacy chats
 * nobody can be shown to own (owner, 23 Nov 2026). `unclaimed` is always
 * empty now; it stays in the shape so callers need no change. No key known:
 * everything is held.
 */
export function partitionByOwner(
  local: readonly OwnedConversation[],
  ownerKey: string | null,
  storedIds: ReadonlySet<string>,
): { mine: OwnedConversation[]; unclaimed: OwnedConversation[]; others: OwnedConversation[] } {
  if (!ownerKey) return { mine: [], unclaimed: [], others: [...local] };
  const mine: OwnedConversation[] = [];
  const unclaimed: OwnedConversation[] = [];
  const others: OwnedConversation[] = [];
  for (const conversation of local) {
    const key = conversation.ownerKey;
    if (key === ownerKey || (!key && storedIds.has(conversation.id))) mine.push(conversation);
    // An unstamped chat this account does not hold is held back too: whose it is cannot be told.
    else others.push(conversation);
  }
  return { mine, unclaimed, others };
}

/** Every chat the account shows carries its key, so the next account can tell it is not theirs. */
export function stampOwner<T extends OwnedConversation>(
  conversations: readonly T[],
  ownerKey: string | null,
  /** Legacy chats this account does not hold: shown, never stamped as its own. */
  unclaimed: ReadonlySet<string> = new Set(),
): T[] {
  if (!ownerKey) return [...conversations];
  return conversations.map((conversation) =>
    conversation.ownerKey || unclaimed.has(conversation.id) ? conversation : { ...conversation, ownerKey },
  );
}
