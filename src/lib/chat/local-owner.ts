import type { ChatConversation } from "@/types";

/**
 * ============================================================================
 * A SHARED BROWSER SHOWS EACH ACCOUNT ONLY ITS OWN CHATS
 * ============================================================================
 *
 * NEXT_PUBLIC_CHAT_LOCAL_OWNER_ENABLED (port from the sibling app; QA, 30 Oct
 * 2026, same flag in both apps). The browser keeps chats in one store that is
 * not keyed by account, so someone who signs in on another person's browser
 * sees that person's chats in the sidebar, and Import offers them (70 such
 * chats were stored in other accounts here). The server now
 * refuses to store them (CHAT_IMPORT_OWN_ONLY_ENABLED); this keeps them off
 * the screen.
 *
 * Each local chat is stamped with an opaque key for the account that wrote it
 * (a hash the server returns with the history state — never the account id).
 * A chat stamped by another account is hidden from the sidebar, from Import
 * and from sync; nothing is deleted, and it is there again when that account
 * signs back in. A chat from before the stamp is shown as today: which account
 * wrote it cannot be told here, and the server refuses it if it was not this
 * one. Off, nothing is stamped or hidden.
 */
export function localOwnerEnabled(): boolean {
  const inlined = process.env.NEXT_PUBLIC_CHAT_LOCAL_OWNER_ENABLED;
  return typeof inlined === "string" && ["1", "true", "yes", "on"].includes(inlined.trim().toLowerCase());
}

/** Stamped by an account other than the one signed in. */
export function belongsToAnotherAccount(conversation: Pick<ChatConversation, "ownerKey">, account: string | null | undefined): boolean {
  return Boolean(account && conversation.ownerKey && conversation.ownerKey !== account);
}

/** Only the signed-in account's chats, and unstamped ones; everything when there is no key yet. */
export function ownConversations<T extends Pick<ChatConversation, "ownerKey">>(conversations: T[], account: string | null | undefined): T[] {
  if (!account) return conversations;
  const own = conversations.filter((conversation) => !belongsToAnotherAccount(conversation, account));
  return own.length === conversations.length ? conversations : own;
}

/**
 * Stamps the chats this account is known to have written — the ones the
 * account holds, and the ones started since this page loaded — leaving any
 * other untouched. The same array when nothing changes, so a state update can
 * be skipped.
 */
export function stampOwnConversations(
  conversations: ChatConversation[],
  account: string,
  known: { stored: ReadonlySet<string>; preExisting: ReadonlySet<string> },
): ChatConversation[] {
  let changed = false;
  const stamped = conversations.map((conversation) => {
    if (conversation.ownerKey) return conversation;
    if (!known.stored.has(conversation.id) && known.preExisting.has(conversation.id)) return conversation;
    changed = true;
    return { ...conversation, ownerKey: account };
  });
  return changed ? stamped : conversations;
}
