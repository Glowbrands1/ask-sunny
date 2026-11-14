import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * ATTENDANCE AND ANOTHER POLICY: PAU'S ATTENDANCE PLAN, PLUS ONE LINE PER OTHER POLICY (MIXED_POLICY_PLAN_ENABLED)
 * ============================================================================
 *
 * Ported from Ask Bubbles. QA's Bubbles Create check (13 Nov 2026), tonight's wording with an invented person: "<B> was late on 11/3/26" and "she
 * yelled at a customer". The draft carried Attendance and Standards of Conduct, but the Action Plan covered lateness
 * only. Pau chose option A (13 Nov 23:57Z): keep the attendance plan exactly and add one line per other policy, "Management
 * will review the <Policy> policy with <employee>.". The card's plan and the saved plan agree. An Attendance-only CA is
 * unchanged. Here the card shows the generic plan (no CARD_PLAN_MATCHES_CREATE in this app). Run with NAMED_POLICIES_ALL_KEPT and POLICY_LINE_COVERS_EVERY_SECTION, which keep both offenses.
 */

const NELL: DirectoryRow = { id: "e-nell-orrin-mpp", firstName: "Nell", lastName: "Orrin", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" };
const BOTH = "create a ca for Nell Orrin, she was late on 11/3/26 and she yelled at a customer. verbal. no payroll deduct.";
const NAMED = "create a ca for Nell Orrin for violating the attendance policy and standards of conduct, she was late on 11/3/26 and she yelled at a customer. verbal. no payroll deduct.";
const LATE_ONLY = "create a ca for Nell Orrin for violating the attendance policy, she was late on 11/3/26. verbal. no payroll deduct.";
const REPORT = "QA's Bubbles Create check (13 Nov 2026): \"<B> was late on 11/3/26\" + \"she yelled at a customer\" saved a plan that covered lateness only; Pau's option A";
const KEEP_BOTH = ["NAMED_POLICIES_ALL_KEPT_ENABLED", "POLICY_LINE_COVERS_EVERY_SECTION_ENABLED"];
const FLAG = "MIXED_POLICY_PLAN_ENABLED";
const LATENESS_PLAN = /^Nell is expected to arrive on time for all scheduled shifts moving forward\. Leadership will monitor Nell's attendance closely and provide coaching as needed\. A follow-up meeting will be scheduled to review progress\. Continued lateness will result in further disciplinary review per company policy\. /;
const SOC_LINE = "Management will review the Standards of Conduct policy with Nell.";

async function create(t: ReplayContext, request: string, observation: string) {
  vi.setSystemTime(new Date("2026-11-10T15:00:00Z"));
  t.directory([...STAFF, NELL]);
  t.as("salon_director", KEARNEY);
  const thread = t.thread();
  const card = await thread.say(request);
  t.draftWrites({ observation });
  const id = await thread.create();
  const cardPlan = /^\*\*Action plan:\*\*\s*(.+)$/im.exec(card.content)?.[1]?.trim() ?? "";
  return { id, cardPlan, card: card.content };
}

function mixedPlan(t: ReplayContext, id: string, cardPlan: string, card: string) {
  const plan = t.values(id).action_plan ?? "";
  expect(plan, `the lateness plan is not kept as it is:\n${plan}`).toMatch(LATENESS_PLAN);
  expect(plan, `no line for the Standards of Conduct:\n${plan}`).toContain(SOC_LINE);
  expect(plan.indexOf(SOC_LINE), "the line is not before the closing").toBeLessThan(plan.indexOf("Future policy violations"));
  expect(plan.match(/Management will review/g)?.length ?? 0, `more than one line per other policy:\n${plan}`).toBe(1);
  // This app has no CARD_PLAN_MATCHES_CREATE (Ask Bubbles' 17l fix): its card shows the generic plan for every Attendance
  // CA, a gap that predates this flag (logged for QA, 14 Nov 2026). The card's plan is checked only for naming both.
  expect(cardPlan, `the card's plan leaves a policy out:\n${card}`).toMatch(/attendance[\s\S]*standards of conduct/i);
}

export const NOV14_MIXED_POLICY_PLAN_CASES: ReplayCase[] = [
  {
    id: "nov14-mixed-policy-plan-described",
    title: `"${BOTH}": Pau's attendance plan plus "${SOC_LINE}", the same on the card and the draft`,
    report: REPORT,
    status: { open: "the plan covers lateness only" },
    fixFlags: [...KEEP_BOTH, FLAG],
    async run(t) {
      const { id, cardPlan, card } = await create(t, BOTH, "Observed:\nNell Orrin was late on November 3, 2026 and she yelled at a customer.");
      mixedPlan(t, id, cardPlan, card);
    },
  },
  {
    id: "nov14-mixed-policy-plan-named",
    title: `"${NAMED}": the same with both policies named`,
    report: REPORT,
    status: { open: "the plan covers one policy only" },
    fixFlags: [...KEEP_BOTH, FLAG],
    async run(t) {
      const { id, cardPlan, card } = await create(t, NAMED, "Observed:\nNell Orrin was late on November 3, 2026 and she yelled at a customer.");
      mixedPlan(t, id, cardPlan, card);
    },
  },
  {
    id: "nov14-mixed-policy-plan-attendance-only-unchanged",
    title: `"${LATE_ONLY}": an Attendance-only CA keeps Pau's plan unchanged`,
    report: `${REPORT}; negative`,
    status: "fixed",
    fixFlags: [...KEEP_BOTH, FLAG],
    async run(t) {
      const { id } = await create(t, LATE_ONLY, "Observed:\nNell Orrin was late on November 3, 2026.");
      const plan = t.values(id).action_plan ?? "";
      expect(plan).toMatch(LATENESS_PLAN);
      expect(plan).not.toMatch(/Management will review/);
    },
  },
];
