/**
 * ============================================================================
 * EVIDENCE: THE MODEL'S TOOL ARGUMENTS ARE CLAIMS, CHECKED AGAINST REAL TURNS
 * ============================================================================
 *
 * The rebuild plan (owner's audit, 15 Nov 2026): no word or phrase list reads the manager's message or the model's
 * reply. Where a tool needs to know what the manager said (an account, a level, a payroll answer, an exit asked for,
 * forms on file asked about), the model passes evidence: the id of the manager's message and the words it quotes from
 * it. Code checks only that the quote is really in that manager turn, and where the turn sits in the conversation. It
 * never reads what the words mean; the model does, taught by the rules book.
 *
 * Message ids: each manager turn the model is shown ends with `[message_id: <id>]` (`conversationOf` in run.ts). The
 * id is the chat message's own id; a turn with none gets its place in the history (`h<index>`), and the message being
 * answered now is `questionMessageId`, or `CURRENT_MESSAGE_ID`.
 */

import type { ChatMessage } from "@/types";

/** What the model passes: which manager message, and the words it quotes from it. */
export interface Evidence {
  readonly message_id: string;
  readonly quote: string;
}

export type EvidenceReason =
  /** The id names no turn, or a turn that is not the manager's (the app's own reply, a tool note). */
  | "evidence_not_manager_turn"
  /** The quote is not in that turn (compared case- and space-insensitively). */
  | "evidence_quote_not_found"
  /** The check needs this turn's words, and the quote is from an earlier turn. */
  | "evidence_not_this_turn"
  /**
   * The answer must come AFTER the card asked (`afterMessageId`: the reply that showed the card or asked the question),
   * and the quote is from a turn that does not: e.g. the card asked "Verbal or Written?" and the level evidence quotes an
   * earlier "she was written up before" (QA, 15 Nov 2026).
   */
  | "evidence_after_card";

export type EvidenceCheck = { readonly ok: true; readonly turn: IdentifiedTurn } | { readonly ok: false; readonly reason: EvidenceReason };

/** A turn as the model was shown it, with its id. */
export interface IdentifiedTurn {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly content: string;
  /** Its place in the conversation, oldest first. */
  readonly index: number;
}

/** The id of the message being answered now, when the chat gave it none. */
export const CURRENT_MESSAGE_ID = "current";

/** The tag that ends each manager turn the model is shown. */
export function messageIdTag(id: string): string {
  return `[message_id: ${id}]`;
}

/** Text with the tags taken out (for anything that compares or shows the manager's words). */
export function withoutMessageIdTags(text: string): string {
  return text.replace(/\n*\[message_id: [^\]\n]+\]/g, "");
}

/**
 * The conversation's turns with ids, oldest first, the message being answered last: the same turns `conversationOf`
 * shows the model (failed and empty turns left out).
 */
export function identifiedTurns(history: readonly ChatMessage[], question: string, questionMessageId?: string | null): IdentifiedTurn[] {
  const turns: IdentifiedTurn[] = [];
  history.forEach((message, position) => {
    if (message.error || typeof message.content !== "string" || message.content.trim() === "") return;
    turns.push({ id: message.id ?? `h${position}`, role: message.role === "assistant" ? "assistant" : "user", content: message.content, index: turns.length });
  });
  turns.push({ id: questionMessageId || CURRENT_MESSAGE_ID, role: "user", content: question, index: turns.length });
  return turns;
}

/** Case- and space-insensitive, with curly quotes and dashes read as straight ones. */
function normalized(text: string): string {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Evidence as the model passed it: an object with a message_id and a quote, both strings; null otherwise. */
export function readEvidence(value: unknown): Evidence | null {
  if (!value || typeof value !== "object") return null;
  const { message_id: id, quote } = value as { message_id?: unknown; quote?: unknown };
  return typeof id === "string" && typeof quote === "string" ? { message_id: id.trim(), quote } : null;
}

export interface EvidenceOptions {
  /** The quote must be from the message being answered now. */
  readonly thisTurnOnly?: boolean;
  /** The quote must come from a manager turn after this message (the reply that showed the card or asked the question). */
  readonly afterMessageId?: string;
}

/**
 * Whether the evidence is real: the id names a manager turn, the quote is in it, and the turn is where the check needs
 * it. Never reads what the words mean.
 */
export function verifyEvidence(evidence: unknown, turns: readonly IdentifiedTurn[], options: EvidenceOptions = {}): EvidenceCheck {
  const claim = readEvidence(evidence);
  const turn = claim ? turns.find((candidate) => candidate.id === claim.message_id) : undefined;
  if (!claim || !turn || turn.role !== "user") return { ok: false, reason: "evidence_not_manager_turn" };
  const quote = normalized(claim.quote);
  if (quote === "" || !normalized(withoutMessageIdTags(turn.content)).includes(quote)) return { ok: false, reason: "evidence_quote_not_found" };
  if (options.thisTurnOnly && turn.index !== turns.length - 1) return { ok: false, reason: "evidence_not_this_turn" };
  if (options.afterMessageId) {
    const asked = turns.find((candidate) => candidate.id === options.afterMessageId);
    if (asked && turn.index <= asked.index) return { ok: false, reason: "evidence_after_card" };
  }
  return { ok: true, turn };
}
