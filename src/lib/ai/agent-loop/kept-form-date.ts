import { monthDayToIso } from "./dates";

/**
 * ============================================================================
 * ONCE SET, THE CARD'S FORM DATE STAYS (port from the sibling app: its QA's live re-test, 21 Nov 2026; QA2's Sunny R3)
 * ============================================================================
 *
 * "She was late on 10/5 and 10/15" put 2026-10-15 on the card; a later turn rebuilt it with no date (the model left
 * incident_date out) and Create saved today, or the reply asked "Which date goes on the form?" and Create went through
 * unanswered. This person's latest card (the server's record), on any form, keeps its date when this turn gives none,
 * this message states no date and asks for no new form; a date the manager gave in this request still has to be among
 * them. A date the manager gives now (`latestDates`) or the model's own `date` always wins.
 */
export function keptFormDate(input: {
  /** An account form (Corrective Action, Coaching …): the only kind whose date is the incident's. */
  readonly accountForm: boolean;
  /** The date this proposal already has (the model's, or the answer read this turn). */
  readonly date: string | null;
  readonly asksNewForm: boolean;
  /** Dates stated in the manager's latest message. */
  readonly latestDates: readonly string[];
  /** Dates stated in this request ("10/5", "10/15"). */
  readonly datesGiven: readonly string[];
  readonly today: string;
  /** The date on this person's latest card, from the server's card record. */
  readonly ownCardDate: string | null | undefined;
}): string | null {
  const { accountForm, date, asksNewForm, latestDates, datesGiven, today, ownCardDate } = input;
  if (!accountForm || date || asksNewForm || latestDates.length > 0 || !ownCardDate) return null;
  if (datesGiven.length > 0 && !datesGiven.some((given) => monthDayToIso(given, today) === ownCardDate)) return null;
  return ownCardDate;
}
