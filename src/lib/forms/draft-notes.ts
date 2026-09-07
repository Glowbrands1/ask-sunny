import { MANAGER_CONTEXT_CHARS } from "./context-limits";
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

/** Separator between turns. Matches `managerContext`, so both read alike. */
const JOIN = "\n\n";

export interface DraftNotes {
  /** The joined manager turns. Empty when nothing qualified. */
  text: string;
  /** Ids actually used, in conversation order. */
  usedMessageIds: string[];
}

export function draftNotesFromConversation(
  messages: Pick<ChatMessage, "id" | "role" | "content" | "error">[],
  sourceMessageIds: readonly string[],
): DraftNotes {
  const wanted = new Set(sourceMessageIds);

  const used = messages.filter(
    (message) =>
      wanted.has(message.id) &&
      message.role === "user" &&
      !message.error &&
      typeof message.content === "string" &&
      message.content.trim() !== "",
  );

  // Conversation order, because "then... then... then" is how an account of
  // what happened reads, and reordering it would misstate the sequence.
  let text = "";
  const usedMessageIds: string[] = [];
  for (const message of used) {
    const content = message.content.trim();
    const next = text ? `${text}${JOIN}${content}` : content;
    if (next.length > MANAGER_CONTEXT_CHARS) break;
    text = next;
    usedMessageIds.push(message.id);
  }

  return { text, usedMessageIds };
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
