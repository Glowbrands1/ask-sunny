import { listIncidentDates } from "./form-date-answer";
import { incidentOnly } from "./form-date-incident-only";

/**
 * A date this turn states as the incident. A prior coaching date
 * ("a verbal ca was given on 9-1-26") is history and does not replace the
 * date already on the form.
 */
const HISTORY =
  /\b(?:verbal|written)\s+(?:ca|corrective action)\s+was\s+given\s+on\s+\S+(?:-\S+)?|\b(?:previous|prior)\s+coaching\b[^.\n]*|\bjba\s+manual\s+\d{1,2}[-/]\d{1,2}[-/]\d{2,4}|\bcoaching\s+\d{1,2}[-/]\d{1,2}[-/]\d{2,4}/gi;

export function explicitIncidentIso(question: string, today: string): string | null {
  const stripped = question.replace(HISTORY, " ");
  const dates = incidentOnly(stripped, today, listIncidentDates(stripped, today));
  if (dates.length === 1) return dates[0]!.iso;
  if (dates.length > 1) return null;
  if (/\btoday\b/i.test(stripped) && !/\bwas\s+given\b/i.test(question)) return today;
  return null;
}
