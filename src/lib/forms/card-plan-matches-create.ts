import { attendanceActionPlanEnabled, cardPlanMatchesCreateEnabled } from "@/lib/config/chat-quality-flags";

import { attendanceActionPlan, isAttendancePlan, missedMeetingNotLateness } from "./attendance-action-plan";

/*
 * ============================================================================
 * THE CARD SHOWS THE ACTION PLAN CREATE WILL SAVE (CARD_PLAN_MATCHES_CREATE_ENABLED)
 * ============================================================================
 *
 * Ported from the sibling app: QA's Bubbles 17l live test (12 Nov 2026), reproduced here: "create a written CA for <B>, she was 20 minutes late on 11/9/26, no action
 * plan". The card's plan read "Management will review the Attendance policy with <B first>. Future policy violations …";
 * Create saved Pau's attendance plan (ATTENDANCE_ACTION_PLAN, his approved wording: "<B> is expected to arrive on time for
 * all scheduled shifts moving forward. Leadership will monitor …"). QA's ruling (B): Pau's plan stays — it is the
 * company standard, not an invention, and "no action plan" keeps the template plan — but the card must show the plan
 * Create will save, so they never disagree. With the flag on, a Corrective Action card whose Policy line cites the
 * Attendance policy (never Late Opening), for an account that is not a missed meeting or shift without lateness, shows the attendance
 * plan, built by the same writer the draft route uses. Off, the card as built. Pure.
 */

/** The card's general plan line ("Management will review … with <first>. …"). */
const PLAN_LINE = /^(\*\*Action plan:\*\*)\s*Management will review [^\n]*$/im;
/** The policy the card cites: its Policy line's name, before the page, the source or "as you said". */
const POLICY_LINE = /^\*\*Policy:\*\*\s*([^(\n,—]+?)(?:\s*\(|\s*,|\s+—|\s*$)/im;

interface CardLike {
  readonly templateKey?: string;
  readonly employeeName?: string | null;
}

/** The card's Action Plan line as Create will save it: Pau's attendance plan for an Attendance CA. Off, unchanged. */
export function withCardPlanAsCreate<T extends { content: string; formProposal?: CardLike | null }>(answer: T, account: string): T {
  if (!cardPlanMatchesCreateEnabled() || !attendanceActionPlanEnabled()) return answer;
  const card = answer.formProposal;
  if (!card || card.templateKey !== "dpoa") return answer;
  const line = PLAN_LINE.exec(answer.content);
  const policy = POLICY_LINE.exec(answer.content)?.[1];
  if (!line || !policy) return answer;
  const citedPolicies = policy.split(/\s*(?:,|&|\band\b)\s*/).map((name) => name.trim()).filter(Boolean);
  const input = { citedPolicies, employeeName: card.employeeName ?? null, payroll: { answer: null, amount: null } };
  if (!isAttendancePlan(input) || missedMeetingNotLateness(account)) return answer;
  return { ...answer, content: answer.content.replace(line[0], `${line[1]} ${attendanceActionPlan(input)}`) };
}
