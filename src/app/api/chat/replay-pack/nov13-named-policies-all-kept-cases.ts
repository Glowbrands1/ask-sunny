import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * EVERY POLICY THE MANAGER NAMES IS KEPT (NAMED_POLICIES_ALL_KEPT_ENABLED)
 * ============================================================================
 *
 * Ported from Ask Bubbles. QA's two-offense Create check (13 Nov 2026), in Coding-2's probe wording: "create ca form for <B> for violating the
 * attendance policy and standards of conduct, she was late on 11/3/26 and yelled at a customer" saved Type of Offense,
 * Policy Violated and the plan on Standards of Conduct only: the last policy named won, and Attendance was dropped. On:
 * both are kept. A correction ("not attendance, standards of conduct") still keeps one. The person is invented.
 *
 * WHAT THIS REPLAY SHOWS, AND DOES NOT: the plan wording for a draft on two policies, one of them Attendance, is
 * MIXED_POLICY_PLAN's (Pau's wording, pending); here the plan is only checked not to leave Attendance out.
 */

const NELL: DirectoryRow = { id: "e-nell-orrin-npk", firstName: "Nell", lastName: "Orrin", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" };
const BOTH = "create ca form for nell orrin for violating the attendance policy and standards of conduct, she was late on 11/3/26 and yelled at a customer. verbal. no payroll deduct.";
const CORRECTED = "create ca form for nell orrin, not attendance, standards of conduct, she yelled at a customer on 11/3/26. verbal. no payroll deduct.";
const REPORT = "QA, 13 Nov 2026 (two-offense Create check): naming the attendance policy and standards of conduct kept only Standards of Conduct";
const FLAG = "NAMED_POLICIES_ALL_KEPT_ENABLED";
const ATTENDANCE_KEYS = /^(?:attendance_policy|tardiness|absenteeism)$/;

async function create(t: ReplayContext, request: string, observation: string) {
  vi.setSystemTime(new Date("2026-11-10T15:00:00Z"));
  t.directory([...STAFF, NELL]);
  t.as("salon_director", KEARNEY);
  const thread = t.thread();
  const card = await thread.say(request);
  t.draftWrites({ observation });
  const id = await thread.create();
  return { id, card };
}

export const NOV13_NAMED_POLICIES_ALL_KEPT_CASES: ReplayCase[] = [
  {
    id: "nov13-named-policies-all-kept-both",
    title: `"${BOTH}": the offense, Policy Violated, Direct policy and plan keep Attendance and Standards of Conduct`,
    report: REPORT,
    status: { open: "only Standards of Conduct is kept: Attendance leaves the offense, Policy Violated and the plan" },
    fixFlags: [FLAG],
    async run(t) {
      const { id } = await create(t, BOTH, "Observed:\nNell Orrin was late on November 3, 2026 and yelled at a customer.");
      const offense = t.checked(id).offense_type ?? [];
      const values = t.values(id);
      expect(offense, "Standards of Conduct left the offense").toContain("standards_of_conduct");
      expect(offense.some((key) => ATTENDANCE_KEYS.test(key)), `Attendance left the offense: ${offense.join(", ")}`).toBe(true);
      expect(values.policy_violated ?? "", "Policy Violated dropped Attendance").toMatch(/attendance/i);
      expect(values.policy_violated ?? "", "Policy Violated dropped Standards of Conduct").toMatch(/standards of conduct/i);
      expect(values.policy_language ?? "", "Direct policy dropped Attendance").toMatch(/attendance/i);
      expect(values.policy_language ?? "", "Direct policy dropped Standards of Conduct").toMatch(/standards of conduct/i);
      expect(values.action_plan ?? "", "the plan reviews Standards of Conduct only").not.toMatch(/review the Standards of Conduct policy with/i);
    },
  },
  {
    id: "nov13-named-policies-all-kept-correction-keeps-one",
    title: `"${CORRECTED}": a correction keeps one policy, Standards of Conduct`,
    report: `${REPORT}; negative (a name that corrects an earlier one wins alone)`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      const { id } = await create(t, CORRECTED, "Observed:\nNell Orrin yelled at a customer on November 3, 2026.");
      const offense = t.checked(id).offense_type ?? [];
      expect(offense, "the corrected-away Attendance was ticked").not.toContain("attendance_policy");
      expect(t.values(id).policy_violated ?? "").not.toMatch(/attendance/i);
    },
  },
];
