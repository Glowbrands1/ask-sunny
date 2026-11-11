import { accountOnlyPolicyQueryEnabled } from "@/lib/config/chat-quality-flags";

import { EXPECTATION_LABEL, GOING_FORWARD_LABEL, OBSERVED_LABEL } from "./narrative-draft";

/**
 * ACCOUNT_ONLY_POLICY_QUERY_ENABLED (QA live, 27 Oct 2026; same flag in both
 * apps): the manager typed "create a CA form for <name> at <place>. she was
 * late on the 2nd" / "yes payroll deduct" / "$25", and the drafted Observed
 * read "<name> was scheduled to open … and was late arriving", with an
 * Expectation about being "unable to open on time". Nobody said open. The
 * draft searches the manual for its APPROVED POLICY with the manager's whole
 * notes, so "payroll deduct" and "$25" pulled in the section that charges $25
 * by payroll deduction for a late opening, and the model wrote that section's
 * story. With the flag on:
 *
 *   the policy search reads the account only — a line that only answers the
 *   payroll question or gives the amount ("yes payroll deduct", "$25", "i
 *   dont know the amount") is left out of the search, never out of the notes;
 *
 *   the drafting rules keep full sentences and the policy's expectations, and
 *   forbid any fact about what happened the manager did not write;
 *
 *   after the model, a sentence that still adds a detail the manager never
 *   wrote is taken out (`withoutInventedDetail`).
 */
const ANSWER_WORD =
  /^(?:yes|yeah|yep|yup|no|nope|pay|roll|payroll|payrol|ldeduct|deduct|deduction|deductions|deducted|applies|applicable|is|it|the|amount|amt|i|dont|don't|do|not|know|sure|of|idk|unsure|\$?\d[\d,]*(?:\.\d{2})?|dollars?)$/i;
const ANSWER_CUE = /^(?:yes|yeah|yep|yup|no|nope|payroll|payrol|ldeduct|deduct|deduction|deducted|amount|amt|\$?\d[\d,]*(?:\.\d{2})?)$/i;

/** "yes payroll deduct", "yes payrol ldeduct", "$25", "i dont know the amount", "no". */
export function answersOnlyPayroll(line: string): boolean {
  const words = line
    .trim()
    .split(/\s+/)
    .map((word) => word.replace(/^[("'“]+|[)"'”.,!?;:]+$/g, ""))
    .filter(Boolean);
  return words.length > 0 && words.every((word) => ANSWER_WORD.test(word)) && words.some((word) => ANSWER_CUE.test(word));
}

/** The text the draft searches the manual with. Off, the notes as given. */
export function policyQueryNotes(notes: string): string {
  if (!accountOnlyPolicyQueryEnabled()) return notes;
  return notes
    .split("\n")
    .filter((line) => !answersOnlyPayroll(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export const ACCOUNT_ONLY_RULES: readonly string[] = [
  "Write full, professional sentences in the three sections, and state the expectations and consequences the approved policy gives. But add NO fact about what happened that the manager did not write: no role or duty (opening, closing, cashier), no shift or schedule, no time of day, no customer or business impact, no one who noticed, no count of times, no place beyond the one given. A policy quoted below is not part of their account. \"She was late on the 2nd\" is written as \"<name> was late to work on <date>\", never \"late to open the location\" or \"scheduled to open\".",
];

/** The drafting rules this flag adds. Off, none. */
export function accountOnlyRules(): readonly string[] {
  return accountOnlyPolicyQueryEnabled() ? ACCOUNT_ONLY_RULES : [];
}

/**
 * Details about WHAT HAPPENED that a draft may not add (QA and Pau, 27 Oct
 * 2026). The draft still writes full sentences, the three paragraphs, and the
 * expectations and consequences the manual states; it never adds a role or
 * duty, a shift or schedule, a clock time, or — in the Observed — a customer,
 * who noticed, or how many times. A sentence is touched only when it uses one
 * of these and the manager's own turns never did. One list, so it can grow.
 */
const ANY_SECTION: readonly RegExp[] = [
  /\b(?:open|opens|opened|opening)\b/i,
  /\b(?:close|closes|closed|closing)\b/i,
  /\b(?:cashier|register|till)\b/i,
  /\b(?:morning|evening|night|overnight|mid|double)\s+shifts?\b/i,
  /\bscheduled\s+to\b/i,
  /\b\d{1,2}(?::\d{2})?\s?(?:am|pm|a\.m\.|p\.m\.)(?![a-z])/i,
];
const OBSERVED_ONLY: readonly RegExp[] = [
  /\b(?:customers?|clients?|guests?)\b/i,
  /\bnoticed\b/i,
  /\bagain\b/i,
  /\b(?:\d+|two|three|four|five|several|multiple|many)\s+times\b/i,
];

export const DRAFT_DETAIL_PATTERNS = { anySection: ANY_SECTION, observedOnly: OBSERVED_ONLY };

const LABELS = [OBSERVED_LABEL, EXPECTATION_LABEL, GOING_FORWARD_LABEL];

export interface InventedDetailContext {
  /** The manager's own turns, joined. */
  readonly notes: string;
  /** "Observed:\n<their words>." — `managerWordsObservation`. */
  readonly managerWords: () => string | null;
  /** The form's resolved date in words ("October 2, 2026"), when known. */
  readonly formDate: string | null;
  /** The employee's name, for "Quinn was late …" instead of "She was late …". */
  readonly employeeName: string | null;
  /** The manager's dates in their clause, as `{ index, end }` spans. */
  readonly datesIn: (text: string) => readonly { index: number; end: number }[];
}

function invented(sentence: string, notes: string, observed: boolean): boolean {
  const patterns = observed ? [...ANY_SECTION, ...OBSERVED_ONLY] : ANY_SECTION;
  return patterns.some((pattern) => pattern.test(sentence) && !pattern.test(notes));
}

/**
 * After the model: a narrative sentence that adds a detail the manager never
 * wrote is taken out. An Observed sentence is rewritten from the manager's own
 * clause, in a full sentence with the employee's name and the form's resolved
 * date ("Quinn was late on October 2, 2026."); an Expectation or Going
 * Forward sentence is dropped and every other sentence kept as written; a
 * section left empty loses its label. Off, the values as given.
 */
export function withoutInventedDetail(
  values: Record<string, string>,
  keys: ReadonlySet<string>,
  context: InventedDetailContext,
): Record<string, string> {
  if (!accountOnlyPolicyQueryEnabled()) return values;
  const next: Record<string, string> = { ...values };
  for (const [key, value] of Object.entries(values)) {
    if (!keys.has(key) || typeof value !== "string") continue;
    next[key] = rewritten(value, context);
  }
  return next;
}

function rewritten(value: string, context: InventedDetailContext): string {
  const sections: { label: string | null; lines: string[] }[] = [];
  for (const line of value.split("\n")) {
    const label = LABELS.find((name) => line.trim() === name);
    if (label || sections.length === 0) sections.push({ label: label ?? null, lines: [] });
    if (!label) sections[sections.length - 1]!.lines.push(line);
  }
  let changed = false;
  const out: string[] = [];
  for (const section of sections) {
    const observed = section.label === OBSERVED_LABEL;
    const body = section.lines.join("\n").trim();
    const sentences = body.split(/(?<=[.!?])\s+/);
    if (!sentences.some((sentence) => invented(sentence, context.notes, observed))) {
      if (body) out.push(section.label ? `${section.label}\n${body}` : body);
      continue;
    }
    changed = true;
    let kept = sentences.filter((sentence) => !invented(sentence, context.notes, observed));
    if (observed) {
      const words = managerSentence(context);
      kept = words ? [words, ...kept] : kept;
    }
    const text = kept.join(" ").trim();
    if (text) out.push(section.label ? `${section.label}\n${text}` : text);
  }
  return changed ? out.join("\n\n") : value;
}

const PAST_WORD = /^(?:last|this\s+past|past|yesterday|today)\b/i;

/** "she was late on the 2nd" → "Quinn was late on October 2, 2026." */
function managerSentence(context: InventedDetailContext): string | null {
  let clause = context.managerWords()?.replace(OBSERVED_LABEL, "").trim().replace(/[.!?]+$/, "") ?? "";
  if (!clause) return null;
  if (context.formDate) {
    for (const span of [...context.datesIn(clause)].sort((a, b) => b.index - a.index)) {
      const said = clause.slice(span.index, span.end);
      const before = clause.slice(0, span.index);
      const on = PAST_WORD.test(said) && !/\bon\s*$/i.test(before) ? "on " : "";
      clause = `${before}${on}${context.formDate}${clause.slice(span.end)}`;
    }
  }
  const first = context.employeeName?.trim().split(/\s+/)[0];
  if (first) clause = clause.replace(/^(?:she|he|they)\b/i, first);
  return `${clause.charAt(0).toUpperCase()}${clause.slice(1)}.`;
}
