import { formNameFromRosterEnabled } from "@/lib/config/chat-quality-flags";

import { isSalesPolicyReading, readCaPolicy } from "./ca-policy";
import { editDistance, normalizeTypedName } from "./employee-match";
import { detectTemplateIntent, namesAForm } from "./template-intent";

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
  /*
   * EVERY FORM ASKED FOR HAS ITS SLOT (the flip check, 5 Nov 2026): "coaching
   * form for Avery Testperson and a CA for Jordan Testperson", "Coaching form
   * for Avery Testperson. Also a CA for Jordan Testperson." — only the first
   * "for <Name>" was the slot, so Jordan Testperson was ruled out and the CA
   * card had no employee. Each "for <Name>" whose own clause (the words since
   * the previous "for <Name>") asks for a form is a slot. Off the first
   * sentence, a clause that asks for no form ("This is for Under
   * Performance …") is no slot.
   */
  const all: string[] = [];
  const every = new RegExp(SLOT.source, "gu");
  let from = 0;
  for (const match of text.matchAll(every)) {
    const at = match.index ?? 0;
    const clause = text.slice(from, at);
    from = at + match[0].length;
    if (at >= first.length && detectTemplateIntent(clause).kind === "none") continue;
    // "… Avery Testperson, CA for Jordan Testperson": an item straight before another "for <Name>" is what is asked for, not a person.
    const followedByFor = /^\s*for\s+\p{Lu}/u.test(text.slice(at + match[0].length));
    const items = match[1]!
      .split(/\s*(?:,|\band\b|\bor\b|&)\s*/u)
      .map((name) => name.trim())
      .filter((name) => name && !readsAsOffense(name));
    if (followedByFor) items.pop();
    all.push(...items);
  }
  /*
   * A form's name where the person goes ("a corrective action for Coaching
   * Form", Pau, 4 Nov 2026) is no person — and the slot is still the request's
   * slot: it names nobody, so no other phrase in the message is a candidate
   * ("Club Close" from "… on Club Close % and Spa %"). The reply asks who.
   */
  const names = [...new Set(all.filter((name) => !namesAForm(name)))];
  if (names.length === 0) return all.length > 0 ? [] : null;
  return names;
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

/** Every word of the candidate is a word of the text, in any case. */
function containsWords(text: string, candidate: string): boolean {
  const words = new Set(wordsOf(text.replace(/[^\p{L}'’\s-]+/gu, " ")));
  const typed = wordsOf(candidate);
  return typed.length > 0 && typed.every((word) => words.has(word));
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
/**
 * FORM_NAME_FROM_ROSTER_ENABLED (the flip's eval check, 5 Nov 2026): the words
 * typed straight after "for", in a sentence that asks for a form, are the
 * person asked for — in any case. "create a CA form for ima employee, …"
 * lost "Ima" to the lowercase rule (`roster-shape.ts` lowercaseNobody), and
 * "make me a CA for Odalys merriwether for being late" kept only "Odalys"
 * (the slot reads capitalised words). Only the sentence's first "for": a
 * later one gives the reason. Words that read as an offense or a policy
 * ("for under performance") are not a person.
 */
export function typedAfterFor(candidate: string, text: string | undefined = readMessage()): boolean {
  if (!formNameFromRosterEnabled() || !text || !candidate.trim()) return false;
  const want = wordsOf(candidate);
  if (want.length === 0 || readsAsOffense(candidate)) return false;
  for (const sentence of text.split(/(?<=[.!?])\s+|\n+/)) {
    if (detectTemplateIntent(sentence).kind === "none") continue;
    const tokens = sentence.split(/[^\p{L}'’-]+/u).filter(Boolean).map((token) => normalizeTypedName(token));
    // The sentence's first "for" names who it is for; a later one gives the reason ("… for Odalys merriwether for being late").
    const at = tokens.indexOf("for");
    if (at < 0 || !want.every((word, index) => tokens[at + 1 + index] === word)) continue;
    if (readsAsOffense(tokens.slice(at + 1, at + 4 + want.length).join(" "))) continue;
    return true;
  }
  return false;
}

export function outsideRequestSlot(candidate: string, text: string | undefined = readMessage()): boolean {
  if (!formNameFromRosterEnabled() || !text || !candidate.trim()) return false;
  /*
   * The message rules out only candidates it contains (the flip check, 5 Nov
   * 2026, in the sibling app): a name read from another turn of the
   * conversation — "remy calder" from "Do the same coaching form for remy
   * calder", checked while the stored message was an earlier request for
   * another person — is not this message's to judge. It made the card's
   * employee "out of date" for the earlier person.
   */
  if (!containsWords(text, candidate)) return false;
  // A form's name is never a person (Pau, 4 Nov 2026: "a corrective action for Coaching Form").
  if (namesAForm(candidate)) return true;
  // Typed straight after "for" in a request: the person asked for, whatever the case ("for Odalys merriwether").
  if (typedAfterFor(candidate, text)) return false;
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
    /*
     * QA, 4 Nov 2026 (live, "Club Close" as the card's employee): a last
     * initial is the surname, shortened ("Perpetua T" for Perpetua
     * Thornquist): the person is offered, not ruled out.
     */
    if (surname.length === 1 && actual.startsWith(surname)) return false;
    const shorter = Math.min(surname.length, actual.length);
    if (shorter <= 2) return true;
    return editDistance(surname, actual) > (shorter <= 4 ? 1 : 2);
  });
}
