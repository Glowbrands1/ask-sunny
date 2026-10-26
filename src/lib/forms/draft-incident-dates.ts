import { datesInText, listIncidentDates } from "./form-date-answer";
import { incidentOnly, incidentOnlyOn } from "./form-date-incident-only";
import { withYearlessDatesWritten } from "./late-open";
import { OBSERVED_LABEL } from "./narrative-draft";

/**
 * ============================================================================
 * THE OBSERVATION KEEPS EVERY STATED INCIDENT DATE
 * (FORM_DATE_INCIDENT_ONLY_ENABLED)
 * ============================================================================
 *
 * Coordinator, 26 Oct 2026 (live card test, sibling app): "late to open on
 * 10-5 and 10-15. i coached her on 10-16 about being late" was drafted as "On
 * October 16, 2026, <name> was coached regarding these instances of
 * lateness": the two late dates the manager stated were not in the
 * Observation at all. The draft model writes the narrative; nothing held it to
 * the incident dates. The form's date is chosen apart from the narrative, so
 * an incident date that does not date the form must still be on the record.
 *
 * On, when the drafted Observation leaves out an incident date the manager
 * stated (an earlier step's, a deadline's or a follow-up's is not one), the
 * manager's own clause that states it is put at the top of "Observed:", word
 * for word. Nothing is changed when every stated incident date is there. Off,
 * the draft is unchanged.
 */

const OBSERVATION_KEY = "observation";

/** Every incident date in `text`, a cued yearless "10-5" included. */
function incidentIsos(text: string, today: string): string[] {
  const written = withYearlessDatesWritten(text, today);
  return [...new Set(incidentOnly(written, today, listIncidentDates(written, today)).map((found) => found.iso))];
}

/** Every date the Observation already names, in any shape the readers accept. */
function shownIsos(text: string, today: string): Set<string> {
  return new Set(datesInText(withYearlessDatesWritten(text, today), today).map((found) => found.iso));
}

/** The manager's clauses (sentences split at commas) that state one of `missing`, in order. */
function clausesStating(notes: string, today: string, missing: ReadonlySet<string>): string[] {
  const clauses = notes
    .split(/(?<=[.!?])\s+|\n+/)
    .flatMap((sentence) => sentence.split(/,\s+/))
    .map((clause) => clause.trim().replace(/[.!?]+$/, ""))
    .filter((clause) => clause !== "");
  return clauses.filter((clause) => incidentIsos(clause, today).some((iso) => missing.has(iso)));
}

function sentence(clause: string): string {
  return `${clause.charAt(0).toUpperCase()}${clause.slice(1)}.`;
}

/** `values` with the Observation holding every incident date the notes state. */
export function withStatedIncidentDates(
  values: Record<string, string>,
  notes: string,
  today: string,
): Record<string, string> {
  if (!incidentOnlyOn()) return values;
  const observation = values[OBSERVATION_KEY];
  if (!observation?.trim()) return values;
  const shown = shownIsos(observation, today);
  const missing = new Set(incidentIsos(notes, today).filter((iso) => !shown.has(iso)));
  if (missing.size === 0) return values;
  const carried = clausesStating(notes, today, missing);
  if (carried.length === 0) return values;
  const line = carried.map(sentence).join(" ");
  const label = new RegExp(`^${OBSERVED_LABEL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\n`, "i");
  const next = label.test(observation)
    ? observation.replace(label, (head) => `${head}${line} `)
    : `${line} ${observation}`;
  return { ...values, [OBSERVATION_KEY]: next };
}
