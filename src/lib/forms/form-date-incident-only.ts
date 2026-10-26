import { formDateIncidentOnlyEnabled } from "@/lib/config/chat-quality-flags";

import { datesInText } from "./form-date-answer";

/**
 * ============================================================================
 * THE FORM'S DATE IS THE INCIDENT'S (FORM_DATE_INCIDENT_ONLY_ENABLED, D3)
 * ============================================================================
 *
 * Pau's coordinator, 25 Oct 2026: the form's date is the incident date the
 * manager stated, or the day the form is created — never a deadline, due
 * date, assignment date, prior-action date or a "by <date>". "she didnt do
 * deep clean assigned by 9-15-26" dated the form 9/15 (conv_mvod8jw02vsk2py);
 * "deep clean assigned 9-1-26 … due by 9-15-26" offered the assignment day;
 * "missing the 10-15-26 woven deadline" and "previous coaching. verbal
 * (06/25/2026) and written (07/28/2026)" were offered as form dates
 * (conv_mvof8w712p9rd9c, conv_mvoexl0b2upub8p).
 *
 * Only the choice of the FORM'S DATE skips these dates: every one stays in the
 * account, and the readers that ask "did this turn give a date at all?"
 * (`extractFormDate` keeping an intake open) read them as before. The rule is
 * applied where the date is chosen — `decideFormDate`, `incidentDates`,
 * `explicitIncidentIso`, the late-open reader and the remap — so the shared
 * reader in `form-date-answer.ts` is unchanged.
 */
const ANY_BY_BEFORE = /\bby\s+(?:the\s+)?$/i;
const ASSIGNED_BEFORE = /\b(?:assigned|given\s+out|handed\s+out)\s+(?:on\s+)?$/i;
/*
 * The date IS the deadline: "the 10-15-26 woven deadline", "10/15 due date".
 * Up to two words that name the deadline may sit between, never a clause
 * word: "late on 10/2 and the deadline was missed" and "late on 10/2 for the
 * deadline" date the incident 10/2 (QA-6 date matrix, 26 Oct 2026).
 */
const DEADLINE_NEAR_AFTER =
  /^\s*(?:(?!(?:and|for|the|but|or|then|after|before|so|to|was|were|is|are|of|on|at|with|because|when|while|she|he|they|her|his|it)\b)[a-z]+\s+){0,2}(?:deadline|due\s+date)\b/i;
/*
 * "missing the woven deadline of 11-1-26", "the deadline is 10/15": the
 * deadline word before the date (live card test, 26 Oct 2026). Not "missed the
 * woven deadline on 10/15/26": that is the day it was missed, the incident.
 */
const DEADLINE_BEFORE = /\b(?:deadline|due\s+date)\s+(?:of|is|was)\s+(?:the\s+)?$/i;
const PRIOR_LEVEL_PAREN_BEFORE =
  /\b(?:verbal|written|final|coachings?|coached|warnings?|ca|c\/a|corrective\s+action|write[- ]?up)\s*\(\s*$/i;

/** Whether the date at `index`..`end` is a deadline, assignment or prior-action date, never the incident. */
export function notTheIncident(text: string, index: number, end: number): boolean {
  const before = text.slice(Math.max(0, index - 60), index);
  const after = text.slice(end, end + 30);
  return (
    ANY_BY_BEFORE.test(before) ||
    ASSIGNED_BEFORE.test(before) ||
    DEADLINE_NEAR_AFTER.test(after) ||
    DEADLINE_BEFORE.test(before) ||
    PRIOR_LEVEL_PAREN_BEFORE.test(before)
  );
}

/** `found` (dates read from `text`) without the ones that are not the incident, when the flag is on. */
export function incidentOnly<T extends { readonly index: number }>(text: string, today: string, found: readonly T[]): T[] {
  if (!formDateIncidentOnlyEnabled()) return [...found];
  const ends = new Map(datesInText(text, today).map((date) => [date.index, date.end]));
  return found.filter((date) => !notTheIncident(text, date.index, ends.get(date.index) ?? date.index));
}

/** Whether every mention of `iso` in `text` is a deadline, assignment or prior-action date. */
export function onlyNotTheIncident(text: string, today: string, iso: string): boolean {
  const mentions = datesInText(text, today).filter((date) => date.iso === iso);
  return mentions.length > 0 && mentions.every((date) => notTheIncident(text, date.index, date.end));
}

/** Whether FORM_DATE_INCIDENT_ONLY_ENABLED is on. One import for the callers. */
export function incidentOnlyOn(): boolean {
  return formDateIncidentOnlyEnabled();
}
