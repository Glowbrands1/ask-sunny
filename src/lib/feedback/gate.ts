import type { ChatMessage } from "@/types";

/**
 * THE RULE: ANSWER THE LAST ONE BEFORE ASKING THE NEXT.
 *
 * A pure function over a thread, shared by every send path — the chat screen,
 * `useInlineAsk` and the Sales Totals panel — so the gate cannot be stricter on
 * one surface than another. Three implementations of "is feedback due?" would
 * be three chances for a manager to find the rule applies on the Overview and
 * not on Bed Usage, and conclude the whole thing is broken.
 *
 * =============================================================================
 * WHAT IT DELIBERATELY DOES NOT BLOCK
 * =============================================================================
 *
 * This gates ONE action: sending a further question into the same conversation.
 * It does not and must not block navigating away, closing the page, opening
 * another surface, starting a new conversation, or reaching anything
 * administrative. The brief asks for exactly that boundary and it is the right
 * one — a modal a manager cannot escape while a salon is waiting on them is a
 * product that gets closed rather than rated.
 *
 * Because nothing here runs on unload, on a route change, or as a dialog, that
 * boundary is structural rather than a promise: the only caller is a send
 * handler.
 *
 * =============================================================================
 * FOUR CONDITIONS, AND EACH ONE RELEASES THE GATE FOR A REASON
 * =============================================================================
 *
 *   IT MUST BE AN ASSISTANT TURN.        Nobody rates their own question.
 *
 *   IT MUST HAVE COMPLETED.              A turn that errored is not an answer.
 *                                        Asking somebody to rate a failure they
 *                                        can already see is a failure is asking
 *                                        them to do the product's work, and it
 *                                        would trap a manager behind a broken
 *                                        request — the moment they most need to
 *                                        be able to try again.
 *
 *   IT MUST HAVE A `turnId`.             No server-recorded turn, nothing to
 *                                        attach a rating to. Analytics is
 *                                        best-effort by design, so this really
 *                                        happens, and the answer must not
 *                                        become un-followable because a
 *                                        dashboard row was lost.
 *
 *   IT MUST NOT ALREADY HAVE FEEDBACK.   The obvious one.
 *
 * ONLY THE NEWEST ANSWER IS CHECKED. A thread carrying older unrated answers —
 * from before this shipped, or from a turn whose event was lost — is not held
 * hostage to its own history. The rule is "rate the answer you just got", not
 * "clear the backlog", and the second would make an existing conversation
 * unusable the day this deployed.
 */
export function feedbackDueOn(messages: readonly ChatMessage[]): ChatMessage | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "assistant") continue;

    /* The newest assistant turn decides, whatever its state. */
    if (message.error) return null;
    if (!message.turnId) return null;
    if (message.feedback) return null;
    return message;
  }
  return null;
}

/** What the composer says when it is holding a question back. */
export const FEEDBACK_DUE_MESSAGE =
  "Please rate the answer above before asking your next question.";
