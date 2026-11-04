import { formNameFromRosterEnabled } from "@/lib/config/chat-quality-flags";

import { isSalesPolicyReading, readCaPolicy } from "./ca-policy";
import { editDistance, normalizeTypedName } from "./employee-match";
import { detectTemplateIntent } from "./template-intent";

/**
 * ============================================================================
 * STEP 5, PART 2: THE REQUEST SLOT, AND A LIST IS NOT A PERSON
 * ============================================================================
 *
 * QA for Pau, 5 Nov 2026. The live re-flip of FORM_NAME_FROM_ROSTER_ENABLED
 * failed on Pau's message 1 for somebody not on the roster:
 *
 *   "I need a corrective action verbal for Remy Fenn. This is for Under
 *    Performance on PPTA, LPSVA, Club Average, Club Close %, and Spa %."
 *
 * gave "Which of them is this Corrective Action Form for — Remy Fenn, Club
 * Close or Under?". Nothing named a roster person, so part 1's middle ground
 * never fired. Two rules, from the message's shape alone (no word list, no
 * roster):
 *
 *   THE REQUEST SLOT. When the message's first sentence asks for a form
 *   "… for <Name>" (or "<Name> and <Name>"), those names are the message's
 *   only employee candidates: a capitalised phrase anywhere else — "Under"
 *   from "This is for Under Performance" — is not a candidate.
 *
 *   AN OFFENSE IS NOT A PERSON. A "for <Phrase>" that reads as an offense or
 *   a policy ("for Under Performance") is no slot, and none of its words is a
 *   candidate (QA review, 5 Nov 2026).
 *
 *   A LIST IS NOT A PERSON. A capitalised phrase that is an item of a comma
 *   or "and" list of three or more items ("PPTA, LPSVA, Club Average, Club
 *   Close %, and Spa %") is never a candidate, anywhere in the message.
 *
 * The chat route hands the manager's message in for the turn
 * (`request-message-store.ts`); every name reader asks `outsideRequestSlot`
 * through `namesSomebody` and the person guard. Off, nothing changes.
 */

const WORD = String.raw`[\p{Lu}][\p{L}'’-]*`;
const RUN = String.raw`${WORD}(?:\s+${WORD})*`;
const SLOT = new RegExp(String.raw`\bfor\s+(${RUN}(?:\s*(?:,|\band\b|\bor\b|&)\s*${RUN})*)`, "u");

let readMessage: () => string | undefined = () => undefined;

/** The server installs the turn's message reader (`request-message-store.ts`). Unset — a test, the browser — no message. */
export function installRequestMessage(read: () => string | undefined): void {
  readMessage = read;
}

function wordsOf(text: string): string[] {
  return normalizeTypedName(text).split(/[\s-]+/).filter(Boolean);
}

/** The message's first sentence: up to the first ".", "!", "?" or line break. */
function firstSentence(text: string): string {
  const match = /^[\s\S]*?(?:[.!?](?=\s|$)|\n|$)/.exec(text.trim());
  return (match?.[0] ?? text).trim();
}

/**
 * QA review (5 Nov 2026): "I need a CA for Under Performance on …" made
 * "Under Performance" the slot, and "This is for Under Performance" left
 * "Under" a candidate. A "for <Phrase>" whose words read as an offense or a
 * policy (`readCaPolicy`, the same reading the card's Policy line uses) names
 * no person. No phrase list: the policy reader decides.
 */
function readsAsOffense(phrase: string): boolean {
  const reading = readCaPolicy(phrase);
  // CA_SALES_POLICY_ENABLED reads "Under Performance" as the Standards of Conduct, with no stated offense.
  return reading.stated !== null || isSalesPolicyReading(reading);
}

/** Every "for <Capitalised phrase>" in the text that reads as an offense or a policy. */
export function offensePhrases(text: string): string[] {
  const all = new RegExp(String.raw`\bfor\s+(${RUN})`, "gu");
  return [...text.matchAll(all)].map((match) => match[1]!.trim()).filter(readsAsOffense);
}

/** The names the first sentence asks a form for ("… for Remy Fenn"), or null. */
export function requestSlotNames(text: string): string[] | null {
  const first = firstSentence(text);
  if (!first || detectTemplateIntent(first).kind === "none") return null;
  const match = SLOT.exec(first);
  if (!match) return null;
  const names = match[1]!
    .split(/\s*(?:,|\band\b|\bor\b|&)\s*/u)
    .map((name) => name.trim())
    .filter((name) => name && !readsAsOffense(name));
  return names.length > 0 ? names : null;
}

/** The capitalised items of every comma or "and" list of three or more items in the text. */
export function capitalisedListItems(text: string): string[] {
  const items: string[] = [];
  for (const sentence of text.split(/(?<=[.!?])\s+|\n+/)) {
    const parts = sentence.split(/\s*,\s*(?:and\s+|or\s+)?|\s+(?:and|or)\s+/i);
    // A run of three or more consecutive short parts (each four words at most) is a list.
    let run: string[] = [];
    const flush = () => {
      if (run.length >= 3) items.push(...run);
      run = [];
    };
    parts.forEach((part, index) => {
      const words = part.trim().split(/\s+/).filter(Boolean);
      // The first part may carry its lead-in ("… on PPTA"): its last word starts the list.
      const item = index === 0 || run.length === 0 ? words.slice(-2).join(" ") : part.trim();
      const short = item.split(/\s+/).length <= 4 && item.length > 0;
      if (short) run.push(item);
      else flush();
      if (index > 0 && !short) run = [];
    });
    flush();
  }
  return items
    .map((item) => (new RegExp(String.raw`(${RUN})\W*$`, "u").exec(item)?.[1] ?? "").trim())
    .filter((item) => item.length > 0);
}

/** The candidate is somebody the slot names, by every word ("Remy" or "Remy Fenn" for "Remy Fenn"). */
function inSlot(candidate: string, slot: readonly string[]): boolean {
  const typed = wordsOf(candidate);
  if (typed.length === 0) return false;
  return slot.some((name) => {
    const named = new Set(wordsOf(name));
    return typed.every((word) => named.has(word));
  });
}

/**
 * FORM_NAME_FROM_ROSTER_ENABLED: true when the turn's message rules the
 * candidate out — outside its request slot, or an item of a list of three or
 * more. No message read this turn, or the flag off: false.
 */
export function outsideRequestSlot(candidate: string, text: string | undefined = readMessage()): boolean {
  if (!formNameFromRosterEnabled() || !text || !candidate.trim()) return false;
  const typed = wordsOf(candidate).join(" ");
  if (capitalisedListItems(text).some((item) => wordsOf(item).join(" ") === typed)) return true;
  // An offense or a policy after "for" ("for Under Performance"): none of its words is a person.
  const words = wordsOf(candidate);
  if (offensePhrases(text).some((phrase) => {
    const named = new Set(wordsOf(phrase));
    return words.every((word) => named.has(word));
  })) return true;
  const slot = requestSlotNames(text);
  return slot !== null && !inSlot(candidate, slot);
}

/**
 * FORM_NAME_FROM_ROSTER_ENABLED: the manager typed this first name with a
 * different surname ("Remy Fenn" for Remy Calder) — never offer that person,
 * unless the surname typed is close to theirs.
 */
export function typedWithOtherSurname(first: string, lastName: string, turns: readonly string[]): boolean {
  if (!formNameFromRosterEnabled()) return false;
  const want = normalizeTypedName(first);
  const actual = wordsOf(lastName).join(" ");
  const typed: string[] = [];
  // Within a phrase only: "perpetua. This is …" does not make "This" her surname.
  for (const turn of turns.flatMap((text) => text.split(/[.!?,;:()\n]+/))) {
    const tokens = turn.split(/[^\p{L}'’-]+/u).filter(Boolean);
    tokens.forEach((token, index) => {
      const next = tokens[index + 1];
      // As typed: the first name, then a capitalised word straight after it.
      if (normalizeTypedName(token) === want && next && /^\p{Lu}/u.test(next)) typed.push(normalizeTypedName(next));
    });
  }
  if (typed.length === 0) return false;
  return typed.every((surname) => {
    if (surname === actual) return false;
    const shorter = Math.min(surname.length, actual.length);
    if (shorter <= 2) return true;
    return editDistance(surname, actual) > (shorter <= 4 ? 1 : 2);
  });
}
