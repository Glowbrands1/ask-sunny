import { statesFirstOccurrence } from "./corrective-action-intake";
import { datesInText, priorSteps } from "./form-date-answer";

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

/** The step a manager's words named, as a line on the list begins. */
function stepLabel(named: string): string {
  const steps: [RegExp, string][] = [
    [/final\s+written\s+warning/i, "Final written warning"],
    [/written\s+warning/i, "Written warning"],
    [/verbal\s+warning/i, "Verbal warning"],
    [/write[- ]?ups?|written up/i, "Write-up"],
    [/corrective actions?/i, "Corrective action"],
    [/coach(?:ed|ing)?/i, "Coaching"],
    [/disciplin\w*/i, "Disciplinary action"],
    [/warn(?:ing|ings|ed)/i, "Warning"],
  ];
  // The step nearest the date is the one the date belongs to; where two end
  // at the same place ("verbal warning" and its "warning"), the more specific,
  // listed first, wins.
  let best: { end: number; label: string } | null = null;
  for (const [pattern, label] of steps) {
    const global = new RegExp(pattern.source, "gi");
    for (const match of named.matchAll(global)) {
      const end = match.index + match[0].length;
      if (!best || end > best.end) best = { end, label };
    }
  }
  return best?.label ?? "Coaching or corrective action";
}

export function priorActionLine(step: string, iso: string): string {
  return `${step} — signed ${signedDate(iso)}`;
}

/**
 * The drafted list, held to what the manager actually said.
 *
 *   A line carrying a date the manager never gave is removed — an invented
 *   date on a disciplinary history is the worst thing this line can hold.
 *   Each step the manager dated in their own words and the draft left out is
 *   added as its own line.
 *   Left empty, and told "first time", it reads "None — first occurrence".
 *
 * Lines without a date are kept: "Coaching on attendance (date not given)" is
 * the manager's to complete, not this function's to delete.
 */
export function groundPriorActions(input: {
  drafted: string;
  notes: string;
  today: string;
}): { value: string; added: string[]; removed: string[] } {
  const stated = new Set(datesInText(input.notes, input.today).map((found) => found.iso));
  const removed: string[] = [];

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
    added.push(priorActionLine(stepLabel(step.named), step.iso));
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
