import type { ChatConversation } from "@/types";

/**
 * ============================================================================
 * WHEN A LOCAL CONVERSATION IS DEAD, AND WHO SAYS SO
 * ============================================================================
 *
 * THE DEFECT THIS EXISTS TO CLOSE. The browser keeps its own copy of history —
 * deliberately, as rollback protection — and hydration merges the account's
 * copy into it as a UNION, so a momentary outage can never look like "your
 * account has no history". Those two good decisions together resurrect the
 * dead:
 *
 *   Laptop A imports conversation X. Laptop B still holds X locally. The person
 *   deletes X on Laptop A. If the server simply forgot X, then when Laptop B
 *   next opens Ask Sunny the union adds X back — and offers to import it again.
 *
 * A delete that undoes itself on another device is not a delete, and the
 * History panel now promises it removes conversations "from your Ask Sunny
 * account and from this browser".
 *
 * ============================================================================
 * THE STATE MACHINE
 * ============================================================================
 *
 * A conversation this browser holds is in exactly one of five states. The
 * SERVER is authoritative for every transition into a suppressed state; the
 * browser never decides on its own that something is deleted, and never writes
 * that decision anywhere only it can see.
 *
 *   LOCAL-ONLY      In IndexedDB, not on the account, not deleted, not behind a
 *                   clear boundary. Shown. Offered for import. Never synced.
 *
 *   SYNCED          On the account. Shown. Not offered for import. Synced on
 *                   every change.
 *
 *   TOMBSTONED      The person deleted it, here or on another device. The
 *                   account holds a row with `deleted_at` set, no turns and no
 *                   title, and the sync endpoint reports its `conv_*` id.
 *                   Hidden, never importable, never synced, removed from this
 *                   browser's own copy on the next hydration.
 *
 *   CLEARED         Created at or before `history_cleared_at`. Same treatment
 *                   as TOMBSTONED, decided by one row instead of one per
 *                   conversation — which is what answers for a browser holding
 *                   fifty stale threads, including ones the account never saw.
 *
 *   UNKNOWN         The account could not be reached. NOTHING is suppressed:
 *                   local history is shown exactly as it was, no import is
 *                   offered, and no local record is removed. An outage must
 *                   never be able to imitate a delete.
 *
 * THE ONE-WAY DOOR. TOMBSTONED and CLEARED are terminal for that local record.
 * Re-importing it is refused (its id resolves to the tombstone, or its creation
 * time sits behind the boundary), so there is no path back into the visible
 * history except the person having the conversation again.
 *
 * ============================================================================
 * "KEEP INDEXEDDB FOR ROLLBACK" AND "RESPECT A DELETE" ARE DIFFERENT THINGS
 * ============================================================================
 *
 * The local copy is retained after a successful import so that turning
 * server-backed history off costs nobody anything. That is about a decision
 * WE might reverse.
 *
 * A delete is a decision THE PERSON made about their own content, and it is not
 * ours to hold a copy of against them. So once the server says a conversation
 * is tombstoned or behind a clear boundary, this browser drops it too — from
 * state, and therefore from IndexedDB on the next persist. The rollback
 * protection covers the migration; it does not cover ignoring somebody's
 * delete.
 */

/**
 * What the account says about this person's history, ids and counts only.
 *
 * NO CONTENT TRAVELS IN THIS SHAPE. It answers three questions — what is
 * already stored and how much of it, what was deleted, and when history was
 * last cleared — and none of them needs a title, a turn or a timestamp of
 * anything somebody wrote.
 */
export interface HistoryState {
  /**
   * Conversations the account holds, with how many turns each.
   *
   * THE COUNT IS WHAT MAKES A CHUNKED IMPORT RESUMABLE. A large conversation is
   * sent across several requests, so "is it stored" is the wrong question — an
   * interrupted run leaves a conversation that exists and is incomplete, and
   * offering it again is the only way the rest of it ever arrives.
   */
  stored: { id: string; messages: number }[];
  /** `conv_*` ids the person deleted. Tombstones, by their browser-local name. */
  deleted: string[];
  /** When they last cleared everything, or null if they never have. */
  clearedAt: string | null;
}

/** What a browser knows before it has managed to ask. Suppresses nothing. */
export const UNKNOWN_HISTORY_STATE: HistoryState | null = null;

function time(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Whether the person has deleted this conversation, by either route.
 *
 * THE CLEAR BOUNDARY IS COMPARED AGAINST `createdAt`, NOT `updatedAt`, and the
 * difference is the whole point: a stale browser that continues an old thread
 * after a clear moves its `updatedAt` past the line, and comparing on that
 * would let it rescue a conversation the person had already deleted. When a
 * conversation STARTED is a fact no later local edit can move.
 *
 * A conversation with an unreadable `createdAt` is treated as behind the
 * boundary. It cannot be placed in time, and the safe reading of "clear
 * everything from before now" is to include what cannot prove it came after.
 */
export function isSuppressed(
  conversation: Pick<ChatConversation, "id" | "createdAt">,
  state: HistoryState | null,
): boolean {
  if (!state) return false;

  if (state.deleted.includes(conversation.id)) return true;

  const boundary = time(state.clearedAt);
  if (boundary === null) return false;

  const created = time(conversation.createdAt);
  if (created === null) return true;

  return created <= boundary;
}

/**
 * The conversations this browser may still show.
 *
 * Called only with a state the account actually returned — a failed read leaves
 * `state` null and this returns the list untouched, which is what keeps an
 * outage from imitating a delete.
 */
export function suppressDeleted(
  conversations: ChatConversation[],
  state: HistoryState | null,
): ChatConversation[] {
  if (!state) return conversations;
  return conversations.filter((conversation) => !isSuppressed(conversation, state));
}

/**
 * Whether the account already holds this whole conversation.
 *
 * `false` for one that is stored but SHORTER than the local copy, which is what
 * a chunked import interrupted halfway leaves behind — and the only way the
 * remaining turns are ever offered again.
 */
export function isFullyStored(
  conversation: ChatConversation,
  state: HistoryState | null,
): boolean {
  if (!state) return false;
  const entry = state.stored.find((stored) => stored.id === conversation.id);
  if (!entry) return false;
  return entry.messages >= conversation.messages.length;
}
