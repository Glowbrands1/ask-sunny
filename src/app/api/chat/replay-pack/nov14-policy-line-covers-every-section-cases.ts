import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * THE CARD'S POLICY LINE AND THE DRAFT NAME EVERY POLICY (POLICY_LINE_COVERS_EVERY_SECTION_ENABLED)
 * ============================================================================
 *
 * Ported from Ask Bubbles. QA's two-offense Create check (13 Nov 2026), Coding-2's probe wording: "create ca form for <B>, she was late on
 * 11/3/26 and yelled at a customer" read as Attendance only: the card said "Policy: Attendance, from what you described
 * ("late")", Direct policy cited Attendance only, and the conduct incident was never read. And with both policies
 * named (NAMED_POLICIES_ALL_KEPT on), the card still said one: "Policy: Standards of Conduct …, as you said". On: the
 * card line names both, the draft ticks both and Direct policy cites both. The person is invented.
 *
 * WHAT THIS REPLAY SHOWS, AND DOES NOT: the plan's wording for Attendance plus another policy is MIXED_POLICY_PLAN's.
 */

const NELL: DirectoryRow = { id: "e-nell-orrin-plc", firstName: "Nell", lastName: "Orrin", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" };
const DESCRIBED = "create ca form for nell orrin, she was late on 11/3/26 and yelled at a customer. verbal. no payroll deduct.";
const NAMED = "create ca form for nell orrin for violating the attendance policy and standards of conduct, she was late on 11/3/26 and yelled at a customer. verbal. no payroll deduct.";
const LATE_ONLY = "create ca form for nell orrin, she was late on 11/3/26. verbal. no payroll deduct.";
const DENIED = "create ca form for nell orrin, she was late on 11/3/26 but she was not rude about it. verbal. no payroll deduct.";
const REPORT = "QA's two-offense Create check (13 Nov 2026): a CA on two offenses showed and cited one policy";
const FLAG = "POLICY_LINE_COVERS_EVERY_SECTION_ENABLED";
const ATTENDANCE_KEYS = /^(?:attendance_policy|tardiness|absenteeism)$/;

async function create(t: ReplayContext, request: string, observation: string) {
  vi.setSystemTime(new Date("2026-11-10T15:00:00Z"));
  t.directory([...STAFF, NELL]);
  t.as("salon_director", KEARNEY);
  const thread = t.thread();
  const card = await thread.say(request);
  t.draftWrites({ observation });
  const id = await thread.create();
  const policyLine = card.content.split("\n").find((line) => line.startsWith("**Policy:**")) ?? "";
  return { id, policyLine, card: card.content };
}

function bothOnDraft(t: ReplayContext, id: string) {
  const offense = t.checked(id).offense_type ?? [];
  const values = t.values(id);
  const citation = (values.policy_language ?? "").split("\n").filter((line) => /JBA Policy Manual/.test(line)).join(" ");
  expect(offense, `Standards of Conduct is not ticked: ${offense.join(", ")}`).toContain("standards_of_conduct");
  expect(offense.some((key) => ATTENDANCE_KEYS.test(key)), `Attendance is not ticked: ${offense.join(", ")}`).toBe(true);
  expect(values.policy_violated ?? "", "Policy Violated dropped a policy").toMatch(/attendance[\s\S]*standards of conduct|standards of conduct[\s\S]*attendance/i);
  expect(citation, `the Direct policy citation does not name Attendance: ${citation}`).toMatch(/attendance/i);
  expect(citation, `the Direct policy citation does not name Standards of Conduct: ${citation}`).toMatch(/standards of conduct/i);
}

export const NOV14_POLICY_LINE_COVERS_EVERY_SECTION_CASES: ReplayCase[] = [
  {
    id: "nov14-policy-line-covers-every-section-described",
    title: `"${DESCRIBED}": the card names Attendance and Standards of Conduct, and the draft ticks and cites both`,
    report: REPORT,
    status: { open: "the card says Attendance only, and the draft cites Attendance only" },
    fixFlags: [FLAG],
    async run(t) {
      const { id, policyLine, card } = await create(t, DESCRIBED, "Observed:\nNell Orrin was late on November 3, 2026 and yelled at a customer.");
      expect(policyLine, `the card's Policy line does not name Attendance:\n${card}`).toMatch(/attendance/i);
      expect(policyLine, `the card's Policy line does not name Standards of Conduct:\n${card}`).toMatch(/standards of conduct/i);
      expect(policyLine, "the card does not quote the manager's words for the conduct").toMatch(/yelled at a customer/);
      bothOnDraft(t, id);
    },
  },
  {
    id: "nov14-policy-line-covers-every-section-named",
    title: `"${NAMED}" (NAMED_POLICIES_ALL_KEPT on): the card names both policies`,
    report: REPORT,
    status: { open: "the card says one policy while the draft keeps two" },
    fixFlags: ["NAMED_POLICIES_ALL_KEPT_ENABLED", FLAG],
    async run(t) {
      const { id, policyLine, card } = await create(t, NAMED, "Observed:\nNell Orrin was late on November 3, 2026 and yelled at a customer.");
      expect(policyLine, `the card's Policy line does not name Attendance:\n${card}`).toMatch(/attendance/i);
      expect(policyLine, `the card's Policy line does not name Standards of Conduct:\n${card}`).toMatch(/standards of conduct/i);
      bothOnDraft(t, id);
    },
  },
  {
    id: "nov14-policy-line-covers-every-section-lateness-only",
    title: `"${LATE_ONLY}": one offense stays one policy`,
    report: `${REPORT}; negative`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      const { id, policyLine } = await create(t, LATE_ONLY, "Observed:\nNell Orrin was late on November 3, 2026.");
      expect(policyLine).not.toMatch(/standards of conduct/i);
      expect(t.checked(id).offense_type ?? []).not.toContain("standards_of_conduct");
    },
  },
  {
    id: "nov14-policy-line-covers-every-section-denied-incident",
    title: `"${DENIED}": a denied incident adds no policy`,
    report: `${REPORT}; negative`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      const { id, policyLine } = await create(t, DENIED, "Observed:\nNell Orrin was late on November 3, 2026.");
      expect(policyLine).not.toMatch(/standards of conduct/i);
      expect(t.checked(id).offense_type ?? []).not.toContain("standards_of_conduct");
    },
  },
];
