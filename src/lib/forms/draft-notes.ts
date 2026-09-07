import { boundManagerTurns } from "./bounded-context";
import type { ChatMessage } from "@/types";

/**
 * ============================================================================
 * WHAT THE MANAGER SAID, AND ONLY WHAT THE MANAGER SAID
 * ============================================================================
 *
 * When a proposal becomes a real form, the drafting endpoint is given `notes` —
 * the account the model writes the form's AI fields from. This assembles those
 * notes in the browser, from the conversation the browser already holds.
 *
 * FROM IDS, NOT FROM A COPY. `ChatFormProposal.sourceMessageIds` names the turns
 * the server RETAINED inside its bounded window. Resolving those ids against the
 * live conversation means the notes are the manager's own text, not a
 * server-side paraphrase of it and not a snapshot that could have drifted.
 *
 * It also makes the bound real on this side: a turn the server dropped for
 * budget has no id here, so it cannot come back in through the client.
 *
 * ============================================================================
 * THREE FILTERS, EACH FOR A DIFFERENT FAILURE
 * ============================================================================
 *
 *   role === "user"    An assistant turn is Sunny's INTERPRETATION of what the
 *                      manager said. Promoting an interpretation to a factual
 *                      HR record is the worst failure available here, and the
 *                      one nobody would catch, because the wording reads fine.
 *
 *   !message.error     A failed turn is not something anybody said.
 *
 *   id ∈ retained      A turn outside the server's bounded window was never
 *                      part of the proposal and must not be part of the draft.
 *
 * There is no fallback. If nothing survives, the caller creates the form and
 * tells the manager it could not prefill it — see `chat/create-inline-form.ts`.
 */

export interface DraftNotes {
  /** The joined manager turns. Empty when nothing qualified. */
  text: string;
  /** Ids actually used, in conversation order. */
  usedMessageIds: string[];
  /** True when the current turn alone exceeded the window and was cut. */
  truncated: boolean;
}

export function draftNotesFromConversation(
  messages: Pick<ChatMessage, "id" | "role" | "content" | "error">[],
  sourceMessageIds: readonly string[],
): DraftNotes {
  const wanted = new Set(sourceMessageIds);

  const eligible = messages.filter(
    (message) =>
      wanted.has(message.id) &&
      message.role === "user" &&
      !message.error &&
      typeof message.content === "string" &&
      message.content.trim() !== "",
  );

  if (eligible.length === 0) return { text: "", usedMessageIds: [], truncated: false };

  /*
   * ==========================================================================
   * THE SAME WINDOW THE SERVER APPLIED, NOT A SECOND ONE
   * ==========================================================================
   *
   * This walked oldest-first and stopped at the first turn that would overflow
   * the character budget — a different rule from the server's. The two agreed
   * on ordinary conversations and disagreed on exactly the case that matters:
   * a manager who typed more than 4,000 characters got a proposal built from
   * their truncated account and then a form drafted from an EMPTY string,
   * because the first message was already over budget and nothing was retained.
   *
   * `boundManagerTurns` is now the only implementation. The last eligible turn
   * is the current one — the retained set the server produced ends with the
   * message being answered — so the same turns go in and the same words come
   * out, truncation marker and all.
   */
  const current = eligible[eligible.length - 1]!;
  const prior = eligible.slice(0, -1);

  const bounded = boundManagerTurns(
    prior.map((message) => ({ id: message.id, content: message.content })),
    { id: current.id, content: current.content },
  );

  return { text: bounded.text, usedMessageIds: bounded.ids, truncated: bounded.truncated };
}

/**
 * The drafting endpoint refuses anything shorter than this, and it is right to:
 * "ok" is not an account of what happened, and a model given "ok" writes a
 * coaching form out of nothing.
 */
export const DRAFT_NOTES_MINIMUM = 10;

export function draftNotesAreUsable(notes: DraftNotes): boolean {
  return notes.text.trim().length >= DRAFT_NOTES_MINIMUM;
}
