import { payrollAmounts } from "@/lib/ai/intent-slots";

import { datesInText } from "./form-date-answer";
import { fold, wordsOf } from "./form-reducer";

/**
 * ============================================================================
 * THE DRAFT KEEPS THE FACTS THE MANAGER GAVE (post-draft consistency check)
 * ============================================================================
 *
 * FORM_EDIT_SINGLE_WRITER_ENABLED (step 2b, QA spec; ported from Ask Bubbles
 * 44856eb0). In the sibling app, live: "Create a
 * Corrective Action for <first> <last>, she was late to open on 10-20-26" was
 * drafted as "<first> was late …" — the last name gone from the Observation.
 * After the drafting model's draft has been through the route's guards, and
 * before it is written, this reads it against what is KNOWN, never against
 * phrases:
 *
 *   - (not the employee's name: Pau's first-name rule, QA's f078 below);
 *   - every date the notes state (the app's date reader, `datesInText`);
 *   - every amount the notes state (the app's amount reader, `payrollAmounts`);
 *
 * each must still be in the narrative fields (the account: `observed_expectation`).
 * On a miss the draft is saved and the reply says what it left out (QA: detect
 * and report only — no retry, no extra model call). Nothing here calls a model.
 */

export type DraftFactKind = "name" | "date" | "amount";

export interface DraftFact {
  readonly kind: DraftFactKind;
  /** As the manager or the header wrote it, for the reply. */
  readonly shown: string;
  /** Present in `text`. */
  readonly in: (text: string) => boolean;
}

/** The facts the notes give that a drafted account must keep. */
export function draftFacts(input: { employeeName: string | null; notes: string; today: string }): DraftFact[] {
  const notes = input.notes ?? "";
  const facts: DraftFact[] = [];
  /*
   * QA's f078 (20 Nov 2026; production dpl_5bzJ): "ca for <First> <Last>, late on 11/18" drafted "<First> was late on
   * 11/18" (the first name, by Pau's rule) and the note said "The draft left out <Last> in Observation of Offense". In
   * this app the account names the person by their first name on purpose, so the form's own employee's name words
   * (full, first or last) are never a fact the account left out. Dates and amounts are still checked. (`input.employeeName`
   * is kept in the signature for the callers.)
   */
  const dates = new Set<string>();
  for (const date of datesInText(notes, input.today)) {
    if (dates.has(date.iso)) continue;
    dates.add(date.iso);
    facts.push({ kind: "date", shown: notes.slice(date.index, date.end), in: (text) => datesInText(text, input.today).some((found) => found.iso === date.iso) });
  }
  for (const amount of payrollAmounts(notes)) {
    facts.push({ kind: "amount", shown: `$${amount}`, in: (text) => payrollAmounts(text).map(Number).includes(Number(amount)) });
  }
  return facts;
}

/** The facts no narrative field holds (all narrative fields read together). */
export function missingFacts(values: Readonly<Record<string, string>>, narrativeKeys: readonly string[], facts: readonly DraftFact[]): DraftFact[] {
  const text = narrativeKeys.map((key) => values[key] ?? "").join("\n");
  if (fold(text) === "") return [];
  return facts.filter((fact) => !fact.in(text));
}

function listed(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

/** The reply's line when the draft left something out. */
export function leftOutLine(missing: readonly DraftFact[], labels: readonly string[]): string {
  return `The draft left out ${listed(missing.map((fact) => fact.shown))} in ${listed(labels)}; tell me if you want it added.`;
}
