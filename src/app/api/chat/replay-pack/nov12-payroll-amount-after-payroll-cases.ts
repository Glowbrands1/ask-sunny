import { expect, vi } from "vitest";

import { STAFF, KEARNEY, type ReplayCase } from "./cases";

/**
 * ============================================================================
 * "PAYROLL $25." IS THE STATED AMOUNT (QA, 12 Nov 2026)
 * ============================================================================
 *
 * INTENT_PAYROLL_MANAGER_ONLY (on here in production) was NO-GO in the sibling
 * app: with it on, an amount the manager typed was dropped — "…showed up late
 * on october 1, 2026. payroll $25." kept no payroll amount, because the amount
 * reader read only "deduct(ion) $N" and "$N … deducted". This app drops it
 * the same way. QA's exact wording, "payroll $25.", ends the request here (the
 * employee is the replay directory's invented one).
 * PAYROLL_AMOUNT_AFTER_PAYROLL_ENABLED reads it.
 */

const SAID = "verbal corrective action for marnie holloway at kearney. she showed up late on november 1, 2026. payroll $25.";

export const NOV12_PAYROLL_AMOUNT_AFTER_PAYROLL_CASES: ReplayCase[] = [
  {
    id: "nov12-payroll-amount-after-payroll",
    title: `"…showed up late on november 1, 2026. payroll $25." then "yes": the $25 is the card's amount, not asked again`,
    report: "QA, 12 Nov 2026 (from the sibling app's gate NO-GO on INTENT_PAYROLL_MANAGER_ONLY): \"payroll $25.\" gave payrollAmount null",
    status: { open: "\"payroll $25.\" is not read as the deduction amount; the card asks for it" },
    fixFlags: ["PAYROLL_AMOUNT_AFTER_PAYROLL_ENABLED"],
    async run(t) {
      vi.setSystemTime(new Date("2026-11-03T15:00:00Z"));
      t.directory(STAFF);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      await thread.say(SAID);
      expect(thread.proposal, "no CA card for Marnie Holloway").toMatchObject({ employeeName: "Marnie Holloway" });
      const reply = await thread.say("yes");
      expect(reply.content, `the amount was asked again:\n${reply.content}`).not.toMatch(/Payroll deduction amount\**\?/);
      expect(reply.content, `the $25 is not on the card:\n${reply.content}`).toMatch(/Payroll deduction amount:?\**:?\s*\**\$25\b/);
      t.draftWrites({ observation: "Observed:\nOn 11/01/2026 Marnie Holloway showed up late." });
      const id = await thread.create();
      expect(t.values(id).payroll_deduct_amount ?? "", "the draft's Payroll deduction amount").toBe("$25");
    },
  },
];
