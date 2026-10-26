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
