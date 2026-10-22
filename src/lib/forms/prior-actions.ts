import { statesFirstOccurrence } from "./corrective-action-intake";
import { correctedDates, datesInText, priorSteps } from "./form-date-answer";
import { OFFICIAL_POLICY_MANUAL } from "./official-policy-manual";

/**
 * ============================================================================
 * "LIST PREVIOUSLY RECEIVED COACHING AND/OR CORRECTIVE ACTION WITH DATE SIGNED"
 * ============================================================================
 *
 * The Corrective Action Form's one line for the employee's history, from
 * revision 5 (HR feedback, 3 Oct 2026). It replaced two single lines —
 * "Previous corrective action for this policy or issue" and "Date of previous
 * corrective action" — which held one step and one date between them.
 *
 * ONE ENTRY PER LINE, each saying what was received and when it was signed:
 *
 *   Coaching — signed 09/02/2026
 *   Verbal warning — signed 09/21/2026
 *
 * THE HISTORY IS THE MANAGER'S, NEVER THE MODEL'S. The whole progression
 * escalates on this line, so a date in it survives only where the manager
 * stated it, and a step the manager dated in their own words is put here by
 * code even if the model left it out — which is the production fix the old
 * date line carried (`priorStepDate`), kept for the list. Pure and
 * browser-safe.
 */

export const PRIOR_ACTIONS_KEY = "prior_actions";
export const PRIOR_ACTIONS_LABEL =
  "List previously received coaching and/or corrective action with date signed";

/** The two revision-4 keys this field replaced. Still read on forms filed against them. */
export const LEGACY_PREVIOUS_ACTION_KEY = "previous_action";
export const LEGACY_PREVIOUS_ACTION_DATE_KEY = "previous_action_date";

/** What the line says when there is no history — a real answer, not a blank. */
export const NO_PRIOR_ACTION = "None — first occurrence";

/** `YYYY-MM-DD` as the business writes a date by hand. */
export function signedDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  return match ? `${match[2]}/${match[3]}/${match[1]}` : iso.trim();
}

/**
 * The kinds of step the list records, most specific first. A verbal, written
 * or final written CA is its own step, and so is a policy acknowledgement —
 * "previous coaching: jba policy manual 1-1-26, verbal ca 9-1-26" lists a
 * verbal corrective action (HR, 21 Oct 2026).
 */
const STEPS: readonly [RegExp, string][] = [
  [/final\s+written\s+(?:corrective actions?|cas?\b|c\/a)/i, "Final written corrective action"],
  [/written\s+(?:corrective actions?|cas?\b|c\/a)/i, "Written corrective action"],
  [/verbal\s+(?:corrective actions?|cas?\b|c\/a)/i, "Verbal corrective action"],
  [/final\s+written\s+warning/i, "Final written warning"],
  [/written\s+warning/i, "Written warning"],
  [/verbal\s+warning/i, "Verbal warning"],
  [/write[- ]?ups?|written up/i, "Write-up"],
  [/corrective actions?/i, "Corrective action"],
  // "prior CA 9/1": the form's own shorthand.
  [/\b(?:cas?|c\/a)\b/i, "Corrective action"],
  [/coach(?:ed|ing)?/i, "Coaching"],
  [/disciplin\w*/i, "Disciplinary action"],
  [/warn(?:ing|ings|ed)/i, "Warning"],
  [/(?:\bpolicy\s+)?\backnowledge?ments?\b|\backnowledged\b/i, "Policy acknowledgement"],
];

/** The step a manager's words named, as a line on the list begins. */
function stepLabel(named: string): string {
  return namedStep(named)?.label ?? "Coaching or corrective action";
}

/**
 * The step nearest the date in the manager's words, and where it sits: the
 * step nearest the date is the one the date belongs to. Where two end at the
 * same place ("verbal warning" and its "warning"), the more specific, listed
 * first, wins.
 */
function namedStep(named: string): { start: number; end: number; label: string } | null {
  let best: { start: number; end: number; label: string } | null = null;
  for (const [pattern, label] of STEPS) {
    const global = new RegExp(pattern.source, "gi");
    for (const match of named.matchAll(global)) {
      const end = match.index + match[0].length;
      if (!best || end > best.end) best = { start: match.index, end, label };
    }
  }
  return best;
}

export function priorActionLine(step: string, iso: string, topic = ""): string {
  return `${topic ? `${step} — ${topic}` : step} — signed ${signedDate(iso)}`;
}

/**
 * WHAT AN EARLIER STEP WAS ABOUT, as the manager labelled it: "previous
 * coaching was jba policy manual 1-1-26" → "JBA Policy Manual" (District
 * Manager feedback, 21 Oct 2026). Their words, in their order; only a word of
 * the official manual's own name is printed the way the manual spells it, so
 * "jba manual" reads "JBA Manual" on the record. Nothing is added.
 */
const MANUAL_WORDS = new Map(
  OFFICIAL_POLICY_MANUAL.fallbackTitles
    .flatMap((title) => title.split(/\s+/))
    .filter((word) => /^[A-Za-z]+$/.test(word))
    .map((word) => [word.toLowerCase(), word] as const),
);

function stepTopic(topic: string | undefined): string {
  let words = (topic ?? "").trim();
  // "previous coaching: verbal ca 9-1-26": the item names its own step, which the line already opens with.
  const step = namedStep(words);
  if (step) words = `${words.slice(0, step.start)} ${words.slice(step.end)}`.trim();
  return words
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => MANUAL_WORDS.get(word.toLowerCase()) ?? word)
    .join(" ");
}

/**
 * The earlier steps the manager dated in their own words, as lines on the list
 * — what `groundPriorActions` adds when the draft left one out, and what the
 * chat reads back before the form is created.
 */
export function statedPriorActions(notes: string, today: string): string[] {
  return priorSteps(notes, today).map((step) =>
    priorActionLine(stepLabel(step.named), step.iso, stepTopic(step.topic)),
  );
}

/**
 * The drafted list, held to what the manager actually said.
 *
 *   A line carrying a date the manager never gave is removed — an invented
 *   date on a disciplinary history is the worst thing this line can hold.
 *   Each step the manager dated in their own words and the draft left out is
 *   added as its own line, and so is each finalized form on file for them.
 *   Left empty, and told "first time", it reads "None — first occurrence".
 *
 * Lines without a date are kept: "Coaching on attendance (date not given)" is
 * the manager's to complete, not this function's to delete.
 */
export function groundPriorActions(input: {
  drafted: string;
  notes: string;
  today: string;
  /**
   * The employee's finalized forms in Form Monitoring, as lines — see
   * `prior-forms.ts`. A record, so its dates stand as the manager's do, and a
   * step on file that the draft left out is listed.
   */
  onFile?: readonly { formDate: string; line: string }[];
}): { value: string; added: string[]; removed: string[] } {
  const onFile = input.onFile ?? [];
  const stated = new Set([
    ...datesInText(input.notes, input.today).map((found) => found.iso),
    ...onFile.map((form) => form.formDate),
  ]);
  const removed: string[] = [];

  // A date the manager corrected ("9-2-26 not 9-1-26") is no longer one they gave.
  for (const retracted of correctedDates(input.notes, input.today).keys()) stated.delete(retracted);
  const kept = (input.drafted ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => {
      if (line === "") return false;
      const dates = datesInText(line, input.today);
      if (dates.some((found) => !stated.has(found.iso))) {
        removed.push(line);
        return false;
      }
      return true;
    });

  const present = new Set(kept.flatMap((line) => datesInText(line, input.today).map((found) => found.iso)));
  const added: string[] = [];
  for (const step of priorSteps(input.notes, input.today)) {
    if (present.has(step.iso)) continue;
    present.add(step.iso);
    added.push(priorActionLine(stepLabel(step.named), step.iso, stepTopic(step.topic)));
  }
  // What the manager said of a step comes first; the record fills in the rest.
  for (const form of onFile) {
    if (present.has(form.formDate)) continue;
    present.add(form.formDate);
    added.push(form.line);
  }

  const lines = [...kept, ...added];
  // A history and "None" cannot both be true; a dated step wins.
  const history = lines.filter((line) => !/^none\b/i.test(line));
  const final = history.length > 0 ? history : lines;

  if (final.length === 0 && statesFirstOccurrence(input.notes)) {
    return { value: NO_PRIOR_ACTION, added: [NO_PRIOR_ACTION], removed };
  }
  return { value: final.join("\n"), added, removed };
}

/**
 * The revision-4 pair, read as one entry on the new list — so a form revised
 * onto revision 5 keeps the history its original recorded. Null when the
 * original recorded neither.
 */
export function legacyPriorActions(
  previousAction: string | null | undefined,
  previousActionDate: string | null | undefined,
): string | null {
  const action = (previousAction ?? "").trim();
  const date = (previousActionDate ?? "").trim();
  if (action === "" && date === "") return null;
  if (date === "") return action;
  const step = action === "" ? "Previous corrective action" : action;
  return `${step} — signed ${signedDate(date)}`;
}
