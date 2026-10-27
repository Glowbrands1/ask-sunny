import { meetingNotLatenessPlanEnabled } from "@/lib/config/chat-quality-flags";

import { employeeFirstName } from "./employee-reference";
import { policyNamesFromViolated, type ActionPlanInput } from "./ca-action-plan";
import { CA_ACTION_PLAN_CLOSING } from "./required-closing";

/**
 * Pau's attendance Action Plan (26 Oct 2026; same flag in both apps,
 * ATTENDANCE_ACTION_PLAN_ENABLED, default off).
 *
 * A Corrective Action whose policy is Attendance (tardiness) gets her wording,
 * with no follow-up date: the follow-up is recorded on its own control, never
 * as a bracket in the plan. "her attendance" is written with the employee's
 * name so nobody is assigned a pronoun. The form's required closing follows,
 * as it does on every other plan.
 */

/** Late Opening is its own policy with its own plan; only Attendance is covered here. */
export function isAttendancePlan(input: ActionPlanInput): boolean {
  const names = input.citedPolicies.length > 0 ? input.citedPolicies : policyNamesFromViolated(input.policyViolated);
  if (names.some((name) => /\blate\s+open/i.test(name))) return false;
  return names.some((name) => /\battendance\b/i.test(name));
}

/*
 * MEETING_NOT_LATENESS_PLAN_ENABLED (QA LS-B8 / SX1, 26 Oct 2026, in both apps: "create a written
 * CA for <name> for not attending the monthly meeting on 10-20-26"): the
 * policy is Attendance, so the plan said "expected to arrive on time for all
 * scheduled shifts" about a missed meeting. With the flag on an account of a
 * missed meeting that says nothing about lateness keeps the general plan. The
 * policy pick is unchanged. Off, as before.
 */
const MISSED_MEETING =
  /\b(?:miss(?:ed|es|ing)?|skip(?:ped|s)?|did\s*n[o']?t\s+(?:attend|come\s+to|show\s+(?:up\s+)?(?:to|for))|not\s+attend(?:ing)?|no[- ]show(?:ed)?\s+(?:to|for|at)|absent\s+from)\b[^.!?\n]{0,40}?\bmeetings?\b/i;
const LATENESS = /\b(?:late|lateness|tard(?:y|iness)|on\s+time|clock(?:ed)?\s+in|arriv\w*)\b/i;

export function missedMeetingNotLateness(account: string): boolean {
  return meetingNotLatenessPlanEnabled() && MISSED_MEETING.test(account) && !LATENESS.test(account);
}

export function attendanceActionPlan(input: ActionPlanInput): string {
  const first = employeeFirstName(input.employeeName);
  const who = first ?? "The employee";
  const whose = first ? `${first}'s` : "the employee's";
  const body = [
    `${who} is expected to arrive on time for all scheduled shifts moving forward.`,
    `Leadership will monitor ${whose} attendance closely and provide coaching as needed.`,
    "A follow-up meeting will be scheduled to review progress.",
    "Continued lateness will result in further disciplinary review per company policy.",
  ].join(" ");
  const closing = (input.closing?.trim() || CA_ACTION_PLAN_CLOSING).replace(/\s+/g, " ").trim();
  const ended = /[.!?]$/.test(closing) ? closing : `${closing}.`;
  return `${body} ${ended}`;
}
