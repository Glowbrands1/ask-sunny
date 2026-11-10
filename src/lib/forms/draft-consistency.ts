import { payrollAmounts } from "@/lib/ai/intent-slots";
import { firstNameEnoughEnabled } from "@/lib/config/chat-quality-flags";

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
 *   - every word of the header's employee name that the manager's notes
 *     contain (the form's own employee, as the notes name her);
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
  const noted = new Set(wordsOf(notes));
  const seen = new Set<string>();
  for (const word of (input.employeeName ?? "").split(/\s+/).filter(Boolean)) {
    const folded = wordsOf(word)[0];
    if (!folded || seen.has(folded) || !noted.has(folded)) continue;
    seen.add(folded);
    facts.push({ kind: "name", shown: word, in: (text) => wordsOf(text).some((said) => said === folded || said.split("-").includes(folded)) });
  }
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

/** FIRST_NAME_ENOUGH_ENABLED: the narrative fields where a first name is the name (the Coaching Form's Details). */
const FIRST_NAME_FIELDS = new Set(["coaching_details"]);

/** The facts no narrative field holds (all narrative fields read together). */
export function missingFacts(values: Readonly<Record<string, string>>, narrativeKeys: readonly string[], facts: readonly DraftFact[]): DraftFact[] {
  const text = narrativeKeys.map((key) => values[key] ?? "").join("\n");
  if (fold(text) === "") return [];
  const missing = facts.filter((fact) => !fact.in(text));
  /*
   * FIRST_NAME_ENOUGH_ENABLED (QA's live Bubbles round 17b, 10 Nov 2026): "The draft left out <surname> in Details of
   * Coaching" while Details named the employee by first name. A name the account already uses, by any word of it, is
   * not reported missing. Only for the Coaching Form's Details (QA's report): a Corrective Action's Observation still
   * reports a dropped surname ("Marnie was late", the single-writer spec, `pm-draft-route.single-writer.test.ts`).
   * Off, every word of the name is checked, as before.
   */
  const coachingOnly = narrativeKeys.length > 0 && narrativeKeys.every((key) => FIRST_NAME_FIELDS.has(key));
  if (firstNameEnoughEnabled() && coachingOnly && facts.some((fact) => fact.kind === "name" && fact.in(text))) {
    return missing.filter((fact) => fact.kind !== "name");
  }
  return missing;
}

function listed(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

/** The reply's line when the draft left something out. */
export function leftOutLine(missing: readonly DraftFact[], labels: readonly string[]): string {
  return `The draft left out ${listed(missing.map((fact) => fact.shown))} in ${listed(labels)}; tell me if you want it added.`;
}
