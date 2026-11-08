import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase } from "./cases";

/**
 * ============================================================================
 * "$20 PAYROLL DEDUCT APPLIES" IS THE AMOUNT (QA's Sunny flip-9 live tester, 8 Nov 2026)
 * ============================================================================
 *
 * Live: "… $20 payroll deduct applies" read payroll deduct Yes and then asked "**Payroll deduction amount**?" —
 * PAYROLL_AMOUNT_SAME_MESSAGE reads "$20. which will be payroll deducted", not a figure before the bare "payroll
 * deduct". AMOUNT_BEFORE_PAYROLL_DEDUCT_ENABLED reads it (`forms/payroll-deduct.ts`). The person is invented.
 */
const SAID = "create a verbal ca for Rowan Kestrel. on 11-1-26 the register was off $20. $20 payroll deduct applies";

export const NOV8_AMOUNT_BEFORE_PAYROLL_DEDUCT_CASES: ReplayCase[] = [
  {
    id: "nov8-amount-before-payroll-deduct",
    title: `"… $20 payroll deduct applies": the $20 is the amount, never asked again`,
    report: "QA's Sunny flip-9 live tester, 8 Nov 2026 (2): the Yes is read, the $20 isn't, the amount is asked",
    // Changed on purpose (8 Nov 2026): fixed in production by AMOUNT_BEFORE_PAYROLL_DEDUCT_ENABLED, QA round 5, 8 Nov 2026; it now holds with production's flags.
    status: "fixed",
    fixFlags: ["PAYROLL_AMOUNT_SAME_MESSAGE_ENABLED", "AMOUNT_BEFORE_PAYROLL_DEDUCT_ENABLED"],
    async run(t) {
      vi.setSystemTime(new Date("2026-11-07T02:00:00Z"));
      t.directory(STAFF);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      const reply = await thread.say(SAID);
      expect(thread.proposal, `no CA card for Rowan Kestrel:\n${reply.content}`).toMatchObject({ templateKey: "dpoa", employeeName: "Rowan Kestrel" });
      expect(reply.content, `the amount was asked again:\n${reply.content}`).not.toMatch(/Payroll deduction amount\**\?/);
      expect(reply.content, `the $20 is not on the card:\n${reply.content}`).toMatch(/Payroll deduction amount:?\**:?\s*\**\$20\b/);
      t.draftWrites({ observation: "Observed:\nOn 11/01/2026 the register was off $20." });
      const id = await thread.create();
      expect(t.values(id).payroll_deduct_amount ?? "", "the draft's Payroll deduction amount").toBe("$20");
    },
  },
];
