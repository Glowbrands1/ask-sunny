import type { ChatConversation, ChatMessage } from "@/types";

/**
 * ============================================================================
 * PUTTING THIS BROWSER'S HISTORY AND THE ACCOUNT'S HISTORY TOGETHER
 * ============================================================================
 *
 * THE RULE IS: NOTHING IS EVER DROPPED. The merge is a union, and every branch
 * below exists to keep it one.
 *
 * WHY THAT IS THE ONLY SAFE RULE HERE. `AppStoreProvider` persists conversation
 * state to IndexedDB with `storage.replace()`, which DELETES THE WHOLE
 * COLLECTION and writes back what it was given. So any merge that returned
 * fewer conversations than the browser already held would not merely display
 * less — it would erase the local copy on the next render, and the local copy
 * is the rollback protection this whole phase rests on.
 *
 * Which is why a failed server read does not reach this function at all: the
 * caller leaves local state alone rather than merging with an empty list. A
 * momentary outage must never be able to look like "your account has no
 * history".
 *
 * ============================================================================
 * WHAT WINS WHEN BOTH SIDES HAVE THE SAME THING
 * ============================================================================
 *
 * A CONVERSATION in both places keeps the later `updatedAt` and that side's
 * title, the earlier `createdAt`, and the UNION of the turns.
 *
 * A TURN in both places keeps the LOCAL copy. This browser is what the person
 * is looking at, and it may hold an edit that has not synced yet — a rating
 * just left, a form reference just attached. Preferring the server would
 * silently undo it on the next hydration.
 *
 * ORDER IS PRESERVED WITHIN EACH SIDE AND INTERLEAVED BY TIME BETWEEN THEM.
 * Each list is already in its own correct order — the server sorts by the
 * stored `position`, the browser holds an array — so the merge is a stable
 * merge on `createdAt` that never reorders within a side. That matters
 * concretely: an assistant message and the question after it can share a
 * millisecond, and sorting the pooled set by time alone can put an answer
 * before what it answered.
 */

function time(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * A stable merge of two already-ordered threads.
 *
 * Ties resolve to the server side first, which is arbitrary and deliberate:
 * what matters is that it is the SAME every time, so a thread does not shuffle
 * between two renderings of the same data.
 */
function mergeMessages(server: ChatMessage[], local: ChatMessage[]): ChatMessage[] {
  const onServer = new Set(server.map((message) => message.id));
  /* Only the turns this browser has that the account does not yet know about. */
  const unsynced = local.filter((message) => !onServer.has(message.id));

  const byId = new Map<string, ChatMessage>();
  for (const message of server) byId.set(message.id, message);
  /* Local wins for a turn both sides hold — see the header. */
  for (const message of local) {
    if (onServer.has(message.id)) byId.set(message.id, message);
  }

  const merged: ChatMessage[] = [];
  let a = 0;
  let b = 0;
  while (a < server.length || b < unsynced.length) {
    if (a >= server.length) {
      merged.push(unsynced[b]!);
      b += 1;
      continue;
    }
    if (b >= unsynced.length) {
      merged.push(server[a]!);
      a += 1;
      continue;
    }
    if (time(unsynced[b]!.createdAt) < time(server[a]!.createdAt)) {
      merged.push(unsynced[b]!);
      b += 1;
    } else {
      merged.push(server[a]!);
      a += 1;
    }
  }

  return merged.map((message) => byId.get(message.id) ?? message);
}

function mergeOne(server: ChatConversation, local: ChatConversation): ChatConversation {
  const serverIsNewer = time(server.updatedAt) >= time(local.updatedAt);

  return {
    id: local.id,
    title: serverIsNewer ? server.title : local.title,
    createdAt:
      time(local.createdAt) && time(local.createdAt) < time(server.createdAt)
        ? local.createdAt
        : server.createdAt,
    updatedAt: serverIsNewer ? server.updatedAt : local.updatedAt,
    /*
     * The local list is authoritative for attachments because the server stores
     * none: chat has no attachment system, `attachedDocumentIds` is `[]` at
     * both creation sites, and a conversation read back from Postgres reports
     * `[]` honestly rather than inventing one.
     */
    attachedDocumentIds:
      local.attachedDocumentIds.length > 0
        ? local.attachedDocumentIds
        : server.attachedDocumentIds,
    messages: mergeMessages(server.messages, local.messages),
  };
}

/**
 * The account's history and this browser's, as one list.
 *
 * Ordered newest-first by `updatedAt`, which is what the History panel groups
 * by — so the merged list arrives in the order it will be read in rather than
 * relying on the panel to re-sort a list that arrived in two halves.
 */
export function mergeConversations(
  local: ChatConversation[],
  server: ChatConversation[],
): ChatConversation[] {
  const byId = new Map<string, ChatConversation>();

  for (const conversation of local) byId.set(conversation.id, conversation);

  for (const conversation of server) {
    const existing = byId.get(conversation.id);
    byId.set(
      conversation.id,
      existing ? mergeOne(conversation, existing) : conversation,
    );
  }

  return [...byId.values()].sort((a, b) => time(b.updatedAt) - time(a.updatedAt));
}
