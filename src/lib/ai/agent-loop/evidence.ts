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
 * id is the chat message's own id; a turn with none gets its place in the history (`gen-h<index>`, a prefix no browser
 * id uses), and the message being answered now is `questionMessageId`, or `CURRENT_MESSAGE_ID`.
 */

import { foldName } from "@/lib/forms/fold-name";
import type { ChatMessage } from "@/types";

/** What the model passes: which manager message, and the words it quotes from it. */
export interface Evidence {
  readonly message_id: string;
  readonly quote: string;
}

export type EvidenceReason =
  /** The id names no turn, or a turn that is not the manager's (the app's own reply, a tool note). */
  | "evidence_not_manager_turn"
  /** The quote is not in that turn (compared case- and space-insensitively), as whole words, of 3 characters or more. */
  | "evidence_quote_not_found"
  /** The id names more than one turn (never first-match). */
  | "evidence_ambiguous_id"
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

/** A tag, with or without the space after the colon (QA's review). */
export const MESSAGE_ID_TAG = /\s*\[message_id:\s*[^\]\n]+\]/g;

/** The id a turn with no id of its own is given: its place in the history, prefixed so no browser id can collide. */
export function generatedId(position: number): string {
  return `gen-h${position}`;
}

/** Text with the tags taken out (for anything that compares or shows the manager's words). */
export function withoutMessageIdTags(text: string): string {
  return text.replace(MESSAGE_ID_TAG, "");
}

/**
 * The conversation's turns with ids, oldest first, the message being answered last: the same turns `conversationOf`
 * shows the model (failed and empty turns left out).
 */
export function identifiedTurns(history: readonly ChatMessage[], question: string, questionMessageId?: string | null): IdentifiedTurn[] {
  const turns: IdentifiedTurn[] = [];
  history.forEach((message, position) => {
    if (message.error || typeof message.content !== "string" || message.content.trim() === "") return;
    turns.push({ id: message.id ?? generatedId(position), role: message.role === "assistant" ? "assistant" : "user", content: message.content, index: turns.length });
  });
  turns.push({ id: questionMessageId || CURRENT_MESSAGE_ID, role: "user", content: question, index: turns.length });
  return turns;
}

/** Case- and space-insensitive, with curly quotes, every hyphen and dash, and the ellipsis read as plain ones. */
function normalized(text: string): string {
  return foldName(text)
    .replace(/[“”]/g, '"')
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/\u2026/g, "...")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** The shortest quote that counts (QA's review: "a", "up" and "," are not evidence). */
const MIN_QUOTE = 3;
const WORD_CHAR = /[\p{L}\p{N}]/u;

/**
 * Whether `quote` is in `text` as whole words: at least 3 characters, holding a letter or digit, and never the inside of
 * a longer word ("ate" is not in "late").
 */
function holdsWholeWords(text: string, quote: string): boolean {
  if (quote.length < MIN_QUOTE || !WORD_CHAR.test(quote)) return false;
  for (let at = text.indexOf(quote); at >= 0; at = text.indexOf(quote, at + 1)) {
    const before = text[at - 1] ?? "";
    const after = text[at + quote.length] ?? "";
    const startsInWord = WORD_CHAR.test(quote[0]!) && WORD_CHAR.test(before);
    const endsInWord = WORD_CHAR.test(quote[quote.length - 1]!) && WORD_CHAR.test(after);
    if (!startsInWord && !endsInWord) return true;
  }
  return false;
}

/** Whether `phrase` is in `text` as whole words, read as verifyEvidence reads quotes (case, space, dashes). */
export function holdsPhrase(text: string, phrase: string): boolean {
  return holdsWholeWords(normalized(withoutMessageIdTags(text)), normalized(phrase));
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
  const named = claim ? turns.filter((candidate) => candidate.id === claim.message_id) : [];
  if (named.length > 1) return { ok: false, reason: "evidence_ambiguous_id" };
  const turn = named[0];
  if (!claim || !turn || turn.role !== "user") return { ok: false, reason: "evidence_not_manager_turn" };
  if (!holdsWholeWords(normalized(withoutMessageIdTags(turn.content)), normalized(claim.quote))) return { ok: false, reason: "evidence_quote_not_found" };
  if (options.thisTurnOnly && turn.index !== turns.length - 1) return { ok: false, reason: "evidence_not_this_turn" };
  if (options.afterMessageId !== undefined) {
    // An id that names no turn, or more than one, refuses (QA's review: it must never fail open).
    const asked = turns.filter((candidate) => candidate.id === options.afterMessageId);
    if (asked.length !== 1 || turn.index <= asked[0]!.index) return { ok: false, reason: "evidence_after_card" };
  }
  return { ok: true, turn };
}
