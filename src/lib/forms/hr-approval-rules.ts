import { envFlag } from "@/lib/config/chat-quality-flags";

/**
 * ============================================================================
 * HR APPROVAL — THE RULES, WITH NO DATABASE IN THEM
 * ============================================================================
 *
 * Owner request, 23 Nov 2026: every form except the Coaching Form waits for HR
 * after the manager presses "Finalize and send for approval". HR approves (the
 * form is then finalized exactly as before), rejects, or sends it back for
 * changes, each with a note, and may edit it meanwhile.
 *
 *   pending            sent; waiting for HR. Nobody but HR may change it.
 *   changes_requested  HR sent it back. The creator edits and sends it again.
 *   rejected           HR rejected it. The creator may change it and send it again.
 *   approved           HR approved it; the form was finalized at that moment.
 *
 * WHILE A FORM IS NOT APPROVED IT IS A DRAFT (`status = 'draft'`), so every
 * existing rule already treats it as not on file: it is not a prior warning,
 * the chat does not call it filed, and there is no final PDF.
 *
 * WHO KNOWS IT EXISTS (owner, 23 Nov 2026: "only me and HR can see its
 * waiting and im the only one to see HR's note or approval"). While a form
 * is pending, sent back or rejected, only the manager who created it and HR may
 * see it at all — not their District or Regional Manager, not an administrator.
 * HR's notes and decision are served only to the creator and HR, ever.
 *
 * FORMS_HR_APPROVAL_ENABLED turns the step on. Off, Finalize finalizes as it
 * always did. A form already carrying an approval state stays hidden by the
 * rule below whether or not the flag is on: turning the flag off never
 * publishes a form HR has not approved.
 */

export const HR_APPROVAL_FLAG = "FORMS_HR_APPROVAL_ENABLED";

export function hrApprovalEnabled(): boolean {
  return envFlag(HR_APPROVAL_FLAG);
}

export type HrApprovalState = "pending" | "changes_requested" | "rejected" | "approved";

export type HrDecision = "approve" | "reject" | "send_back";

const STATES: readonly HrApprovalState[] = ["pending", "changes_requested", "rejected", "approved"];

export function asHrApprovalState(value: unknown): HrApprovalState | null {
  return typeof value === "string" && (STATES as readonly string[]).includes(value) ? (value as HrApprovalState) : null;
}

/**
 * THE ONE EXEMPTION, BY THE TEMPLATE'S OWN PERMISSION — never by its layout.
 * The Demotion Form and the Position Transfer Form share the Coaching Form's
 * layout (`layoutFamily: "coaching"`), so a layout test would let them skip HR.
 * `create_coaching_form` is held by exactly the Coaching Form and the Follow-Up
 * Coaching Form (`hr-approval-routing.test.ts` lists every template).
 */
export const HR_EXEMPT_PERMISSIONS: ReadonlySet<string> = new Set(["create_coaching_form"]);

/** Whether a form made from this template waits for HR when it is finalized. */
export function templateRoutesToHr(requiredPermission: string | null | undefined): boolean {
  if (typeof requiredPermission !== "string" || requiredPermission.length === 0) return true;
  return !HR_EXEMPT_PERMISSIONS.has(requiredPermission);
}

/** A form HR has not approved yet: hidden from everyone but its creator and HR. */
export function awaitingHr(state: HrApprovalState | null | undefined): boolean {
  return state === "pending" || state === "changes_requested" || state === "rejected";
}

/** Only `pending` freezes the form for its creator; sent back or rejected, they may change it and send it again. */
export function heldForHr(state: HrApprovalState | null | undefined): boolean {
  return state === "pending";
}

export interface HrReader {
  id: string;
  /** This reader approves forms as HR (`form_hr_approvers`). Absent means no. */
  hrApprover?: boolean;
}

/**
 * Whether this reader must not learn that this form exists. Applied before
 * every other visibility rule, global and administrators included.
 */
export function hiddenWhileAwaitingHr(
  reader: HrReader,
  instance: { createdBy: string; hrApprovalState?: HrApprovalState | null },
): boolean {
  if (!awaitingHr(instance.hrApprovalState ?? null)) return false;
  if (instance.createdBy === reader.id) return false;
  return reader.hrApprover !== true;
}

/** Whether this reader may see HR's decision and notes on this form: its creator and HR, nobody else. */
export function mayReadHrDecision(
  reader: HrReader,
  instance: { createdBy: string; hrApprovalState?: HrApprovalState | null },
): boolean {
  if (!instance.hrApprovalState) return false;
  return instance.createdBy === reader.id || reader.hrApprover === true;
}

export const HR_STATE_LABEL: Record<HrApprovalState, string> = {
  pending: "Waiting for HR approval",
  changes_requested: "Sent back by HR for changes",
  rejected: "Rejected by HR",
  approved: "Approved by HR",
};

/*
 * ============================================================================
 * TIME — CENTRAL, WEEKDAYS
 * ============================================================================
 *
 * The owner's reminders are "weekdays, 6 AM until 5 PM" Central, whatever the
 * deployment's business zone is set to, so these read America/Chicago directly.
 * A form is OVERDUE once one business day has passed since it was sent (owner,
 * 23 Nov 2026: "1 business day waiting"): sent Monday 10:00, overdue Tuesday
 * 10:00; sent Friday 15:00, overdue Monday 15:00; sent on a weekend, the clock
 * starts Monday 00:00, so overdue Tuesday 00:00.
 */
export const HR_REMINDER_ZONE = "America/Chicago";
export const HR_REMINDER_HOUR = 6;

interface LocalMoment {
  /** yyyy-mm-dd in Central time. */
  date: string;
  /** Minutes since local midnight. */
  minutes: number;
  /** 0 = Sunday. */
  weekday: number;
}

export function centralMoment(at: Date): LocalMoment {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: HR_REMINDER_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((entry) => entry.type === type)?.value ?? "";
  const date = `${part("year")}-${part("month")}-${part("day")}`;
  return {
    date,
    minutes: Number(part("hour")) * 60 + Number(part("minute")),
    weekday: new Date(`${date}T00:00:00Z`).getUTCDay(),
  };
}

function shiftDate(date: string, days: number): string {
  const shifted = new Date(`${date}T00:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

function weekdayOfDate(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

function isWeekend(date: string): boolean {
  const day = weekdayOfDate(date);
  return day === 0 || day === 6;
}

function nextBusinessDate(date: string): string {
  let next = shiftDate(date, 1);
  while (isWeekend(next)) next = shiftDate(next, 1);
  return next;
}

/** When a form sent at `requestedAt` becomes overdue, as a Central date and minute of the day. */
export function overdueFrom(requestedAt: Date): { date: string; minutes: number } {
  const sent = centralMoment(requestedAt);
  let startDate = sent.date;
  let startMinutes = sent.minutes;
  if (isWeekend(startDate)) {
    while (isWeekend(startDate)) startDate = shiftDate(startDate, 1);
    startMinutes = 0;
  }
  return { date: nextBusinessDate(startDate), minutes: startMinutes };
}

export function isOverdue(requestedAt: string | Date | null | undefined, now: Date = new Date()): boolean {
  if (!requestedAt) return false;
  const sent = requestedAt instanceof Date ? requestedAt : new Date(requestedAt);
  if (Number.isNaN(sent.getTime())) return false;
  const due = overdueFrom(sent);
  const current = centralMoment(now);
  return current.date > due.date || (current.date === due.date && current.minutes >= due.minutes);
}

/** Business days (Monday to Friday, Central) from the day it was sent to today; 0 on the day it was sent. */
export function businessDaysWaiting(requestedAt: string | Date | null | undefined, now: Date = new Date()): number {
  if (!requestedAt) return 0;
  const sent = requestedAt instanceof Date ? requestedAt : new Date(requestedAt);
  if (Number.isNaN(sent.getTime())) return 0;
  const from = centralMoment(sent).date;
  const to = centralMoment(now).date;
  let days = 0;
  for (let date = from; date < to; date = shiftDate(date, 1)) {
    const next = shiftDate(date, 1);
    if (!isWeekend(next)) days += 1;
  }
  return days;
}

/** "Waiting 2 business days" — what HR's tab and the chat both say. */
export function waitingLabel(requestedAt: string | Date | null | undefined, now: Date = new Date()): string {
  const days = businessDaysWaiting(requestedAt, now);
  if (days === 0) return "Sent today";
  return `Waiting ${days} business day${days === 1 ? "" : "s"}`;
}

/**
 * Whether the daily reminder is due at this moment: a weekday, 6 o'clock in
 * Central. The cron runs at 11:00 and 12:00 UTC (6 AM in CDT and in CST), so
 * exactly one of the two runs is 6 o'clock local whatever the season.
 */
export function reminderDueAt(now: Date): { due: boolean; localDate: string } {
  const moment = centralMoment(now);
  const weekday = moment.weekday >= 1 && moment.weekday <= 5;
  return { due: weekday && Math.floor(moment.minutes / 60) === HR_REMINDER_HOUR, localDate: moment.date };
}

/*
 * THE DRAFT LOOKUPS. A chat turn reuses "the conversation's draft" by reading
 * `status = 'draft'` rows; a form waiting for HR is still a draft, so those
 * reads also leave it out. PostgREST `or` filters, applied only while the flag
 * is on (which is also what says the column exists).
 */
/** Leaves out a form waiting for HR (`pending`); a form sent back or rejected stays its creator's to change. */
export const NOT_HELD_FOR_HR_FILTER = "hr_approval_state.is.null,hr_approval_state.neq.pending";
/** Leaves out every form HR has not approved: for a lookup that is not limited to the reader's own forms. */
export const NOT_AWAITING_HR_FILTER = "hr_approval_state.is.null,hr_approval_state.eq.approved";

/** A draft lookup without the forms waiting for HR; unchanged while the flag is off. */
export function withoutHeldForHr<Q extends { or(filters: string): Q }>(query: Q): Q {
  return hrApprovalEnabled() ? query.or(NOT_HELD_FOR_HR_FILTER) : query;
}

/** A draft lookup without any form HR has not approved; unchanged while the flag is off. */
export function withoutAwaitingHr<Q extends { or(filters: string): Q }>(query: Q): Q {
  return hrApprovalEnabled() ? query.or(NOT_AWAITING_HR_FILTER) : query;
}

/** Whether this draft may be written by its creator or the chat: a draft, and not waiting for HR. */
export function editableDraft(instance: { status: string; hrApprovalState?: HrApprovalState | null }): boolean {
  return instance.status === "draft" && !heldForHr(instance.hrApprovalState ?? null);
}
