import type { ChatMessage } from "@/types";
import type { SavedFeedback } from "./types";

/**
 * =============================================================================
 * WHICH TURN A CONVERSATION'S RATING IS ATTACHED TO
 * =============================================================================
 *
 * THIS FILE REPLACES `gate.ts`, AND THE REPLACEMENT IS THE POINT. That module
 * answered "is feedback due?" and every send path consulted it before letting a
 * question through — so an unrated answer stopped the conversation dead. In the
 * Forms flow it did worse than annoy: "Which form do you need?" is an ANSWER,
 * so the cards under it and the composer beside it were both held until
 * somebody rated the question they had just been asked. A manager clicking
 * "Coaching Form" watched nothing happen and reasonably concluded the chat had
 * ended.
 *
 * Rating is now something a person chooses to do. Nothing consults this module
 * before sending, opening a form, choosing a form or navigating; the only
 * caller is the passive "Rate this conversation" control, which uses it to work
 * out WHICH turn a conversation-level rating belongs to.
 *
 * =============================================================================
 * THE STORED GRAIN IS STILL ONE TURN, AND THAT IS DELIBERATE
 * =============================================================================
 *
 * `ask_sunny_feedback` is keyed to `activity_events.id` — the server's name for
 * one answered turn — and every analytics read joins through it for the role,
 * the salon, the surface and the topic. A conversation-level rating that needed
 * a conversation-level row would be a second review system beside the one the
 * dashboard already reads, so this attaches the rating to a turn IN that
 * conversation and lets the existing model carry it. The browser's own
 * conversation id travels alongside as `client_conversation_id`, which is what
 * makes "which thread was this about" answerable.
 *
 * =============================================================================
 * ONE RATING PER CONVERSATION, NEVER TWO ROWS
 * =============================================================================
 *
 * An already-rated turn WINS over a newer unrated one, and that ordering is the
 * whole defence against duplicate analytics records. Rate a conversation, ask
 * two more questions, then change your mind: without this rule the edit would
 * land on a different turn and the dashboard would show two opinions where one
 * person had one. With it, the edit upserts onto the row that already exists —
 * `onConflict (activity_event_id, user_id)` — and the count stays honest.
 */

export interface ConversationRatingTarget {
  /** The server-minted turn the rating attaches to. */
  turnId: string;
  /** The browser's own id for that answer, stored as opaque correlation text. */
  messageId: string;
  /** What this person already said about this conversation, if anything. */
  saved?: SavedFeedback;
}

/**
 * The turn a conversation-level rating belongs to, or null when there is
 * nothing rateable in the thread yet.
 *
 * NOTHING RATEABLE IS A REAL STATE, not an edge case: a thread whose only
 * answer failed, or whose activity insert did not land, has no server-recorded
 * turn to hang a rating on. The control renders nothing rather than offering a
 * form that would fail on save with nothing the person could do about it.
 */
export function conversationRatingTarget(
  messages: readonly ChatMessage[],
): ConversationRatingTarget | null {
  let newest: ConversationRatingTarget | null = null;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "assistant") continue;
    if (message.error) continue;
    if (!message.turnId) continue;

    /* Already rated: this is the row an edit must land on. Nothing newer wins. */
    if (message.feedback) {
      return {
        turnId: message.turnId,
        messageId: message.id,
        saved: message.feedback,
      };
    }

    /* Otherwise the newest completed answer, kept in case nothing is rated. */
    newest ??= { turnId: message.turnId, messageId: message.id };
  }

  return newest;
}

/** Whether this conversation already carries a rating from this person. */
export function conversationIsRated(messages: readonly ChatMessage[]): boolean {
  return Boolean(conversationRatingTarget(messages)?.saved);
}
