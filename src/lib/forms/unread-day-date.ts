import { unreadDayIn } from "@/lib/ai/unread-date-ask";
import { unreadDayNotIncidentDateEnabled } from "@/lib/config/chat-quality-flags";

import type { ResolvedFormDate } from "./form-date-grounding";

/**
 * ============================================================================
 * "LAST WEEK" IS NEVER DRAFTED AS TODAY — UNREAD_DAY_NOT_INCIDENT_DATE_ENABLED
 * ============================================================================
 *
 * QA, 29 Oct 2026 (same flag in both apps). The card said "I couldn't read
 * "last week" — which date?", the manager pressed Create without answering,
 * and the form was dated today (a form always has a date). On a Corrective
 * Action the draft was then told the form's date IS the incident's and to use
 * no other, so "she was late last week" could be recorded as late on today's
 * date — a wrong incident date on a disciplinary record.
 *
 * When the manager's notes hold a day the reader cannot read ("last week",
 * "last tuesday", "the other day"), give no calendar date for the incident,
 * do not say "today", and the form still has the date it was created with:
 * the draft is told today is NOT the incident date and to say when it
 * happened in the manager's own words; today's date is not treated as one the
 * manager gave (so a sentence stating it is not kept as the incident's date);
 * and the manager is told to set the date on the form. A form whose date the
 * manager gave, or notes with a date that was read, are never touched.
 * Off: as before.
 */

const SAID_TODAY = /\b(?:today|tonight|this (?:morning|afternoon|evening))\b/i;

/** The unread day phrase this draft is about, or null when the rule does not apply. */
export function unreadIncidentDay(input: {
  readonly notes: string;
  /** Dates the manager gave for what happened (`draftBriefDates`). */
  readonly incidentDates: readonly string[];
  readonly formDate: string | null | undefined;
  readonly today: string;
}): string | null {
  if (!unreadDayNotIncidentDateEnabled()) return null;
  if (input.incidentDates.length > 0 || input.formDate !== input.today || SAID_TODAY.test(input.notes)) return null;
  return unreadDayIn([input.notes]);
}

/** The FORM DATE line for such a draft, in place of the one that calls it the incident's date. */
export function unreadDayBrief(resolved: ResolvedFormDate, said: string): string {
  return `FORM DATE: ${resolved.long} (${resolved.weekday}). This is the date the form is dated, NOT the date of the incident. The manager wrote "${said}" and gave no calendar date: say when it happened in the manager's own words ("${said}"), and never write ${resolved.long} or any other date as the date of the incident.`;
}

/** What the manager is told on the draft. */
export function unreadDayNotice(said: string): string {
  return `The form is dated today; you wrote "${said}" - set the incident date on the form.`;
}
