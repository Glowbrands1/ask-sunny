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
 * is shown. Then a chat is this account's when it carries this key, or carries
 * none and the account already stores it; every other chat — another key, or
 * no key and not on this account — is held back: kept in the browser exactly
 * as it was, never shown, offered for Import or synced. Nothing is deleted
 * (QA decision, option A; wiping on sign-out was rejected).
 */

export function chatLocalOwnerEnabled(): boolean {
  // Only a statically written `process.env.NEXT_PUBLIC_…` is inlined by Next.
  const raw = process.env.NEXT_PUBLIC_CHAT_LOCAL_OWNER_ENABLED;
  return typeof raw === "string" && ["1", "true", "on", "yes"].includes(raw.trim().toLowerCase());
}

export type OwnedConversation = ChatConversation & { ownerKey?: string };

/** Splits this browser's chats into the account's own and everybody else's. */
export function partitionByOwner(
  local: readonly OwnedConversation[],
  ownerKey: string | null,
  storedIds: ReadonlySet<string>,
): { mine: OwnedConversation[]; others: OwnedConversation[] } {
  if (!ownerKey) return { mine: [], others: [...local] };
  const mine: OwnedConversation[] = [];
  const others: OwnedConversation[] = [];
  for (const conversation of local) {
    const key = conversation.ownerKey;
    if (key === ownerKey || (!key && storedIds.has(conversation.id))) mine.push(conversation);
    else others.push(conversation);
  }
  return { mine, others };
}

/** Every chat the account shows carries its key, so the next account can tell it is not theirs. */
export function stampOwner<T extends OwnedConversation>(conversations: readonly T[], ownerKey: string | null): T[] {
  if (!ownerKey) return [...conversations];
  return conversations.map((conversation) =>
    conversation.ownerKey === ownerKey ? conversation : { ...conversation, ownerKey },
  );
}
