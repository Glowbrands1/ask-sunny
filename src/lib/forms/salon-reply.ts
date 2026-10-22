import { readSalonMentions } from "./salon-mention";
import { rosterSalonFor, salonsForTypedNumber } from "./salon-text";

/**
 * ============================================================================
 * ANSWERING "WHICH SALON IS THIS ABOUT?", AND CHANGING THE SALON, IN A LATER TURN
 * ============================================================================
 *
 * QA F-12, 22 Oct 2026: a salon director covering two salons opened a form,
 * was asked which salon it is about, and answered "410". Nothing in "410"
 * named an employee, an incident or a salon in a sentence, so the turn left
 * the open form for free-form chat and the card was gone. "Omaha Pacific" and
 * "sorry, it's omaha pacific" did the same.
 *
 * Ask Bubbles answers this with `store-confirmation.ts`; this is the same
 * mechanism over Ask Sunny's own roster:
 *
 *   - while the salon question is open, a short reply that IS a salon — its
 *     number, its Google store code, its name, a shared city — is the answer;
 *   - a correction ("sorry, it's …", "no wait, it's …", "actually …") names
 *     the salon that replaces the one on the card, open question or not;
 *   - a bare number counts ONLY as the answer to the open question. In a
 *     correction, or anywhere else, a number needs a salon word, a "#" or its
 *     leading zero — "actually 410" is not a salon.
 *
 * WHAT IS RETURNED IS EVERY SALON THE REPLY CAN MEAN, never a choice between
 * them and never an authorization: `proposeLocation` keeps only the actor's own
 * salons and asks whenever more than one remains or the reply named several.
 * Times, prices, dates and quantities ("4:10", "$254", "4/10", "410 bottles")
 * are not replies of this shape and read as nothing.
 */

type Turn = { readonly role: string; readonly content: string; readonly formProposal?: { readonly status?: string } | null };

/** Every wording `locationQuestion` (form-proposal.ts) ends a salon question with. */
const SALON_QUESTION = /which (?:of your )?salons? is this about\?/i;

/** The opening words of a change of mind, up to the salon they name. */
const CORRECTION_LEAD =
  /^\s*(?:(?:no|nope|oh|oops|sorry|wait|actually|correction|my\s+(?:mistake|bad)|i\s+meant|rather|instead)\b[\s,.!:;-]*)+(?:(?:it'?s|it\s+is|that'?s|that\s+is|make\s+it|should\s+be|use|at|in)\b\s*)?/i;

const MAX_REPLY_WORDS = 5;

function lastAssistant(history: readonly Turn[]): Turn | null {
  return [...history].reverse().find((turn) => turn.role === "assistant") ?? null;
}

/** Whether the last thing Sunny said asked which salon the open form is about. */
export function salonQuestionOpen(history: readonly Turn[]): boolean {
  const asked = lastAssistant(history);
  if (!asked) return false;
  return asked.formProposal?.status === "needs_location" || SALON_QUESTION.test(String(asked.content ?? ""));
}

/**
 * The salons a short reply names, or null when it is not a salon reply at all.
 * An empty list is a number that names no salon (asked again, never guessed).
 * `bareNumbers`: whether "410" alone may be read — only for the open question.
 */
export function salonReply(turn: string, bareNumbers: boolean): string[] | null {
  const text = turn.trim().replace(/[.!]+$/, "").trim();
  if (!text || /[?]/.test(text) || text.split(/\s+/).length > MAX_REPLY_WORDS) return null;
  const core = text
    .replace(/^(?:it'?s|it\s+is|at|in)\s+/i, "")
    .replace(/^(?:the|our)\s+/i, "")
    .trim();

  const number = /^(?:(salon|store|location|loc)\s*)?(#)?\s*(\d{3,4})(?:\s+(?:salon|store|location))?$/i.exec(core);
  if (number) {
    const digits = number[3]!;
    const cued = Boolean(number[1] || number[2]) || digits.length === 4 || digits.startsWith("0");
    if (!cued && !bareNumbers) return null;
    return salonsForTypedNumber(digits).map((salon) => salon.id);
  }
  if (/\d/.test(core) && !/^\d{2,3}(?:st|nd|rd|th)\b/i.test(core) && !/\b\d{2,3}(?:st|nd|rd|th)\b/i.test(core)) return null;

  const name = core.replace(/\s+(?:salon|store|location|one)$/i, "");
  const named = [...new Set(readSalonMentions(`at ${name}`).flatMap((mention) => mention.salonIds))];
  if (named.length > 0) return named;
  const salon = rosterSalonFor(name);
  return salon ? [salon.id] : null;
}

/** A change of mind that names a salon: the salons it names, or null. Numbers need a cue here. */
export function salonCorrection(turn: string): string[] | null {
  const lead = CORRECTION_LEAD.exec(turn);
  if (!lead || lead[0].trim() === "") return null;
  return salonReply(turn.slice(lead[0].length), false);
}

/** Whether this turn answers or corrects the open form's salon. */
export function answersSalon(history: readonly Turn[], question: string): boolean {
  if (salonCorrection(question) !== null) return true;
  return salonQuestionOpen(history) && salonReply(question, true) !== null;
}

/**
 * The salons the conversation's latest salon ANSWER names, or null when the
 * ordinary reading of the manager's words should decide.
 *
 * Read newest first: the newest turn that answers the salon question or
 * corrects the salon decides; a turn that names a salon in an ordinary
 * sentence hands back to the ordinary reading (null). So "410" stays the
 * answer on later turns, and a later "sorry, it's omaha pacific" replaces
 * a salon named in the first message.
 */
export function latestSalonAnswer(history: readonly Turn[], question: string): string[] | null {
  const turns: { content: string; asked: boolean }[] = [];
  history.forEach((turn, index) => {
    if (turn.role === "user") turns.push({ content: String(turn.content ?? ""), asked: salonQuestionOpen(history.slice(0, index)) });
  });
  turns.push({ content: question, asked: salonQuestionOpen(history) });

  for (let at = turns.length - 1; at >= 0; at -= 1) {
    const { content, asked } = turns[at]!;
    const answer = salonCorrection(content) ?? (asked ? salonReply(content, true) : null);
    if (answer !== null) return answer;
    if (readSalonMentions(content).length > 0) return null;
  }
  return null;
}
