import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * "THE ACTION PLAN NOW STATES THE PAYROLL DEDUCTION" — AND IT DOES NOT (QA's prod-env reading, 10 Nov 2026, D1;
 * CORRECTION_PLAN_KEEPS_AMOUNT_ENABLED)
 * ============================================================================
 *
 * With production's flags, after Create, "change the payroll deduction to $5.00" replied "Payroll deduction amount →
 * $5.00. The Action Plan now states the payroll deduction.", but the saved Action Plan named no deduction, and the earlier
 * "$3.25" sentence was gone too (Ask Bubbles' qa-oct21-audit-e2e, Issue 4; ported). `forms/chat-correction.ts` syncs the plan without its
 * amount sentence; every other edit path writes it. The wording is the test's (a production conversation); the person
 * invented.
 */
const FIX = ["CORRECTION_PLAN_KEEPS_AMOUNT_ENABLED"];
const REPORT = "Ported from Ask Bubbles: QA's prod-env reading there (10 Nov 2026, D1): a payroll-deduction change claimed on the Action Plan and not saved";
const REQUEST = "create verbal ca for marnie holloway. marnie had a register shortage of $3.25 on 10-20-26. payroll deduct of $3.25 is applicable";
const MODEL = {
  observation:
    "Observed:\nOn October 20, 2026, Marnie's register was found to be short by $3.25.\n\nExpectation:\nEmployees are expected to accurately count and reconcile their register drawer.",
  action_plan: "Marnie is expected to count and reconcile the register drawer accurately during each shift.",
  policy_violated: "Standards of Conduct",
};

async function created(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-10-21T15:00:00Z"));
  t.directory(STAFF);
  t.as("salon_director", KEARNEY);
  const thread = t.thread();
  await thread.say(REQUEST);
  t.draftWrites(MODEL, { offense_type: ["standards_of_conduct"] });
  const id = await thread.create();
  return { thread, id };
}

export const NOV10_CORRECTION_PLAN_KEEPS_AMOUNT_CASES: ReplayCase[] = [
  {
    id: "nov10-correction-plan-keeps-amount-change",
    title: "after Create, \"change the payroll deduction to $5.00\": the saved Action Plan states $5.00, as the reply says",
    report: REPORT,
    status: { open: "the reply says the Action Plan now states the deduction; the saved plan states none" },
    fixFlags: FIX,
    async run(t) {
      const { thread, id } = await created(t);
      const reply = await thread.say("change the payroll deduction to $5.00");
      const plan = t.values(id).action_plan ?? "";
      expect(t.values(id).payroll_deduct_amount ?? "", `the amount:\n${reply.content}`).toMatch(/5(?:\.00)?/);
      expect(plan, `the Action Plan has no $5.00:\nreply: ${reply.content}\nplan: ${plan}`).toContain("$5.00");
      expect(plan, `the Action Plan still has $3.25:\n${plan}`).not.toContain("$3.25");
    },
  },
  {
    id: "nov10-correction-plan-keeps-amount-repeat",
    title: "after Create, the deduction said again as it is on the form: the Action Plan keeps its deduction sentence",
    report: REPORT,
    status: { open: "repeating the answer already on the form strips the deduction sentence from the plan" },
    fixFlags: FIX,
    async run(t) {
      const { thread, id } = await created(t);
      const before = t.values(id).action_plan ?? "";
      const reply = await thread.say("payroll deduct of $3.25 is applicable");
      const plan = t.values(id).action_plan ?? "";
      if (/\$3\.25/.test(before)) expect(plan, `the deduction sentence was stripped:\nreply: ${reply.content}\nplan: ${plan}`).toContain("$3.25");
      if (/now states the payroll deduction/i.test(reply.content)) expect(plan, `claimed, not saved:\n${plan}`).toContain("$3.25");
    },
  },
];
