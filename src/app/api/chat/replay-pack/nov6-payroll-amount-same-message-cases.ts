import { expect, vi } from "vitest";

import { STAFF, KEARNEY, type ReplayCase } from "./cases";

/**
 * ============================================================================
 * THE AMOUNT GIVEN IN THE SAME MESSAGE IS NOT ASKED AGAIN (the sibling app's live chat, 5 Nov 2026)
 * ============================================================================
 *
 * A manager's request, word for word (the employee's name swapped for an
 * invented one): "create a verbal ca for <name>. on 11-1-26 the register was
 * off $20. which will be payroll deducted from <name>'s check. previous
 * coaching was jba policy manual on 8-1-26. payroll deduct applies". The card
 * read payroll deduct Yes and then asked "**Payroll deduction amount**?" — the
 * $20 two words back was not read, because "which" stood between the amount
 * and "will be payroll deducted". This app asks the same with the same words.
 * PAYROLL_AMOUNT_SAME_MESSAGE_ENABLED reads it (`payroll-deduct-answer.ts`).
 */

const SAID =
  "create a verbal ca for marnie holloway. on 11-1-26 the register was off $20. which will be payroll deducted from Marnie's check. previous coaching was jba policy manual on 8-1-26. payroll deduct applies";

export const NOV6_PAYROLL_AMOUNT_SAME_MESSAGE_CASES: ReplayCase[] = [
  {
    id: "nov6-payroll-amount-same-message",
    title: `"…the register was off $20. which will be payroll deducted… payroll deduct applies": the $20 is used, the amount is not asked`,
    report: "The sibling app's live chat, 5 Nov 2026 (relayed by QA, 6 Nov); reproduced here with the same words",
    status: { open: "the amount question is asked; PAYROLL_AMOUNT_SAME_MESSAGE_ENABLED reads the $20" },
    fixFlags: ["PAYROLL_AMOUNT_SAME_MESSAGE_ENABLED"],
    async run(t) {
      vi.setSystemTime(new Date("2026-11-05T15:49:00Z"));
      t.directory(STAFF);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      const reply = await thread.say(SAID);
      expect(thread.proposal, "no CA card for Marnie Holloway").toMatchObject({ employeeName: "Marnie Holloway" });
      expect(reply.content, `the amount was asked again:\n${reply.content}`).not.toMatch(/Payroll deduction amount\**\?/);
      expect(reply.content, `the $20 is not on the card:\n${reply.content}`).toMatch(/Payroll deduction amount:?\**:?\s*\**\$20\b/);
      expect(reply.content, `the deduction clause is answered as a question:\n${reply.content}`).not.toMatch(/You also asked/);
      t.draftWrites({ observation: "Observed:\nOn 11/01/2026 the register was off $20." });
      const id = await thread.create();
      expect(t.values(id).payroll_deduct_amount ?? "", "the draft's Payroll deduction amount").toBe("$20");
    },
  },
];
