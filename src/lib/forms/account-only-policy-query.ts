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
 *   the drafting rules say the Observed and Going Forward state no role,
 *   shift, opening or closing duty the manager did not write;
 *
 *   after the model, a sentence that still states an opening or closing duty
 *   the manager never wrote is taken out (`withoutInventedDuty`).
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
  "The Observed and Going Forward sections state only what the manager wrote. Never add a role, a shift, an opening or closing duty, or any other detail the manager did not write — a policy quoted below is not part of their account.",
];

/** The drafting rules this flag adds. Off, none. */
export function accountOnlyRules(): readonly string[] {
  return accountOnlyPolicyQueryEnabled() ? ACCOUNT_ONLY_RULES : [];
}

const DUTY = /\b(?:open|opens|opened|opening|close|closes|closed|closing)\b/i;
const LABELS = [OBSERVED_LABEL, EXPECTATION_LABEL, GOING_FORWARD_LABEL];

/**
 * After the model: a narrative sentence that states an opening or closing duty
 * the manager never wrote is taken out. The Observed sentence is replaced by
 * the manager's own clause (`managerWords`, "Observed:\n<their words>."); an
 * Expectation or Going Forward sentence is dropped, and a section left empty
 * loses its label. Notes that say open or close themselves are left alone.
 * Off, the values as given.
 */
export function withoutInventedDuty(
  values: Record<string, string>,
  keys: ReadonlySet<string>,
  notes: string,
  managerWords: () => string | null,
): Record<string, string> {
  if (!accountOnlyPolicyQueryEnabled() || DUTY.test(notes)) return values;
  const next: Record<string, string> = { ...values };
  for (const [key, value] of Object.entries(values)) {
    if (!keys.has(key) || typeof value !== "string" || !DUTY.test(value)) continue;
    next[key] = rewritten(value, managerWords);
  }
  return next;
}

function rewritten(value: string, managerWords: () => string | null): string {
  const sections: { label: string | null; lines: string[] }[] = [];
  for (const line of value.split("\n")) {
    const label = LABELS.find((name) => line.trim() === name);
    if (label || sections.length === 0) sections.push({ label: label ?? null, lines: [] });
    if (!label) sections[sections.length - 1]!.lines.push(line);
  }
  const out: string[] = [];
  for (const section of sections) {
    const body = section.lines.join("\n").trim();
    let kept = body;
    if (DUTY.test(body)) {
      if (section.label === OBSERVED_LABEL) {
        const words = managerWords()?.replace(OBSERVED_LABEL, "").trim();
        kept = words || withoutDutySentences(body);
      } else {
        kept = withoutDutySentences(body);
      }
    }
    if (!kept) continue;
    out.push(section.label ? `${section.label}\n${kept}` : kept);
  }
  return out.join("\n\n");
}

function withoutDutySentences(text: string): string {
  return text
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => !DUTY.test(sentence))
    .join(" ")
    .trim();
}
