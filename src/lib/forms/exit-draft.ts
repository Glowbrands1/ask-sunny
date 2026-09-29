import { shiftDays } from "@/lib/business-date";

import { EXIT_DERIVED_KEYS, exitFactValues, readExitFacts, type ExitFacts } from "./exit-facts";
import { datesInText } from "./form-date-answer";

/**
 * ============================================================================
 * DRAFTING THE RESIGNATION/EXIT FORM
 * ============================================================================
 *
 * The drafting route is shared by every template, and its prompt is written
 * for coaching: FACTS from the manager, COACHING GUIDANCE from Ask Sunny. An
 * exit form has no coaching in it — the employee is leaving — so these rules
 * are appended for a version that carries the exit form's derived keys, and
 * they say so in terms that override the coaching lines above them.
 *
 * TWO GUARDS RUN ON WHAT COMES BACK, because a prompt instruction is a request:
 *
 *   THE FACTS ARE REPLACED, NOT CHECKED. Whatever the model wrote for the
 *   dates and the Resignation Details ticks is discarded, and `exit-facts.ts`'s
 *   reading of the manager's own notes is put in its place. The model is never
 *   shown those keys in the first place. That includes "Immediate involuntary
 *   separation": the model can never tick it, and the notes tick it only when
 *   the manager stated the separation as already done.
 *
 *   DETAILS LOSES ANY SENTENCE THAT DECIDES SOMETHING. A sentence about rehire,
 *   payroll, a bonus, minimum wage, written notice or returned items survives
 *   only when the manager's notes raised the same subject — then it is their
 *   fact, restated; otherwise it is an HR answer nobody gave. The same holds
 *   for a termination the manager did not describe, a signature, a date the
 *   manager did not give, and any claim that a Step to Finish Termination
 *   (the personal file, MyGlow, home office, payroll, security, Sunlync) has
 *   been done.
 */

export const EXIT_DRAFT_RULES: readonly string[] = [
  "THIS FORM IS A RESIGNATION/EXIT FORM. The rules in this paragraph override every instruction above about coaching guidance, expectations or what an employee should do next time: the employee is leaving, and there is nothing of that kind to write.",
  "The Additional Details field is a short, neutral, factual account in the past tense of what the manager described about the departure: the circumstances of how and when the employee left, and any other facts the manager gave. The resignation date, how they resigned, the reason, returned items, the salon key, payroll deduction, minimum wage, bonus and rehire are printed on their own labelled lines above it and are filled separately; do not restate them as a list. Two to four sentences. Keep the manager's specifics and add none.",
  "Write any date exactly as the manager wrote it.",
  "Never state or imply an answer to any of these questions unless the manager stated it, and then only in the manager's own terms: whether store items were returned, whether a payroll deduction applies, whether a bonus is forfeited, whether pay drops to minimum wage, whether written notice is attached, or whether the employee is eligible for rehire.",
  "Never call the departure a termination, firing, dismissal or involuntary separation unless the manager did. Never give a reason for leaving the manager did not give.",
  "Never say that the form, a notice or anything else was signed.",
  "Never say that any step to finish the termination has been done — uploading to the personal file, removing the employee from MyGlow, notifying the home office, HR, payroll or security, or commenting on Sunlync.",
];

/**
 * Subjects a Details sentence may only mention when the notes did. The same
 * pattern is tested against the sentence and against the notes.
 */
const DECISION_TOPICS: RegExp[] = [
  /\brehir(?:e|ed|able|ing)\b/i,
  /\bpayroll\b|\bdeduct(?:ion|ions|ed)?\b/i,
  /\bbonus(?:es)?\b/i,
  /\bminimum wage\b/i,
  /\bwritten notice\b|\battached\b/i,
  /\breturn(?:ed|s|ing)?\b|\bstore items?\b/i,
  /\bsign(?:s|ed|ing|ature|atures)?\b/i,
  /\bmyglow\b|\bsunlync\b|\bhome office\b|\bpersonal file\b|\bsecurity system\b/i,
  /\bfired\b|\bterminat(?:e|ed|ion)\b|\blet (?:her|him|them) go\b|\blet go\b|\binvoluntar(?:y|ily)\b|\bdismiss(?:ed|al)?\b|\bdischarged\b/i,
];

export interface ExitDetailsGuard {
  value: string;
  /** Sentences removed, for the response. */
  removed: string[];
}

/**
 * Removes every Details sentence that raises a subject the manager did not, or
 * carries a date the manager did not give.
 *
 * WHOLE SENTENCES, not words: "She is not eligible for rehire" with "not
 * eligible" cut out would say the opposite, and a half-sentence on somebody's
 * exit paperwork is worse than a shorter paragraph.
 */
export function guardExitDetails(value: string, notes: string, today: string): ExitDetailsGuard {
  const allowedDates = new Set([
    ...datesInText(notes, today).map((found) => found.iso),
    ...(/\btoday/i.test(notes) ? [today] : []),
    ...(/\byesterday\b/i.test(notes) ? [shiftDays(today, -1)] : []),
    ...(/\btomorrow\b/i.test(notes) ? [shiftDays(today, 1)] : []),
    ...factDates(readExitFacts(notes, today)),
  ]);

  const sentences = value.split(/(?<=[.!?])\s+/).filter((sentence) => sentence.trim() !== "");
  const kept: string[] = [];
  const removed: string[] = [];
  for (const sentence of sentences) {
    const unraised = DECISION_TOPICS.some(
      (topic) => topic.test(sentence) && !topic.test(notes),
    );
    const undated = datesInText(sentence, today).some((found) => !allowedDates.has(found.iso));
    if (unraised || undated) removed.push(sentence);
    else kept.push(sentence);
  }
  return { value: kept.join(" ").trim(), removed };
}

function factDates(facts: ExitFacts): string[] {
  return [facts.lastDayWorked, facts.noticeGiven, facts.noticeFulfilled, facts.resignationDate].filter(
    (iso): iso is string => iso !== null,
  );
}

export interface ExitDraftResult {
  values: Record<string, string>;
  checked: Record<string, string[]>;
  /** The derived keys that were filled. */
  derived: string[];
  /** Details sentences the guard removed. */
  detailsRemoved: string[];

}

/**
 * The model's draft with the exit form's facts put in by code.
 *
 * Every derived key the model returned is DROPPED first, whatever it said, and
 * then the facts established from the notes are written in. So a date or tick
 * on the stored form is always one the manager's own words produced.
 */
export function applyExitDraft(input: {
  values: Record<string, string>;
  checked: Record<string, string[]>;
  notes: string;
  today: string;
}): ExitDraftResult {
  const facts = readExitFacts(input.notes, input.today);
  const derived = exitFactValues(facts);

  const values: Record<string, string> = {};
  for (const [key, value] of Object.entries(input.values)) {
    if (!EXIT_DERIVED_KEYS.has(key)) values[key] = value;
  }
  const checked: Record<string, string[]> = {};
  for (const [key, options] of Object.entries(input.checked)) {
    if (!EXIT_DERIVED_KEYS.has(key)) checked[key] = options;
  }

  let detailsRemoved: string[] = [];
  if (typeof values.details === "string") {
    const guarded = guardExitDetails(values.details, input.notes, input.today);
    detailsRemoved = guarded.removed;
    if (guarded.value) values.details = guarded.value;
    else delete values.details;
  }

  Object.assign(values, derived.values);
  Object.assign(checked, derived.checked);

  return {
    values,
    checked,
    derived: [...Object.keys(derived.values), ...Object.keys(derived.checked)],
    detailsRemoved,
  };
}

/** A model's checkbox output without the keys this module writes itself. */
export function withoutDerivedKeys(checked: Record<string, string[]>): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(checked).filter(([key]) => !EXIT_DERIVED_KEYS.has(key)),
  );
}

/** Whether this stored version is the exit form, read off its keys. */
export function isExitDocumentKeys(keys: Iterable<string>): boolean {
  for (const key of keys) if (EXIT_DERIVED_KEYS.has(key)) return true;
  return false;
}

export const EXIT_DETAILS_TRIMMED_NOTICE =
  "I left out of Details anything that would answer the payroll, bonus, minimum wage, written notice, returned items or rehire questions, or say the form was signed or a termination step was done, where you hadn't said it yourself. Those are yours to complete on the form.";
