import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * THE PAYROLL ANSWER IS NOT THE OBSERVATION (QA's Sunny round-5 live tester, 8 Nov 2026, item 2a;
 * PAYROLL_CLAUSE_NOT_ACCOUNT_ENABLED)
 * ============================================================================
 *
 * "… she was late today, $20 payroll deduct applies" (the wording of nov8-amount-before-payroll-deduct, the person
 * invented): the $20 is read and not asked again (round 5), but the Observation of Offense kept the raw "$20 payroll
 * deduct applies" and, new with round 5, the app's "Payroll deduction amount: $20." after it.
 */
// AMOUNT_BEFORE_PAYROLL_DEDUCT is live with QA's round 5 (#684, not yet in production-flags.json here): the $20 is read.
const FIX = ["AMOUNT_BEFORE_PAYROLL_DEDUCT_ENABLED", "PAYROLL_CLAUSE_NOT_ACCOUNT_ENABLED"];
const REPORT = "QA's Sunny round-5 live tester, 8 Nov 2026 (item 2a): the payroll answer in the Observation";

function observationLine(content: string): string {
  return content.split("\n").find((line) => /\*\*Observation of Offense:\*\*/.test(line)) ?? "";
}

async function card(t: ReplayContext, said: string): Promise<string> {
  vi.setSystemTime(new Date("2026-11-07T15:00:00Z"));
  t.directory(STAFF);
  t.as("salon_director", KEARNEY);
  const thread = t.thread();
  const reply = await thread.say(said);
  expect(thread.proposal, `no Corrective Action card for Rowan Kestrel:\n${reply.content}`).toMatchObject({ templateKey: "dpoa", employeeName: "Rowan Kestrel" });
  return reply.content;
}

export const NOV8_PAYROLL_CLAUSE_NOT_ACCOUNT_CASES: ReplayCase[] = [
  {
    id: "nov8-payroll-clause-not-account",
    title: "\"… she was late today, $20 payroll deduct applies\": the Observation is the account, the $20 stays on payroll",
    report: REPORT,
    // Changed on purpose (8 Nov 2026): fixed in production by PAYROLL_CLAUSE_NOT_ACCOUNT_ENABLED, QA round 6, 8 Nov 2026; it now holds with production's flags.
    status: "fixed",
    fixFlags: FIX,
    async run(t) {
      const content = await card(t, "create a verbal ca for Rowan Kestrel she was late today, $20 payroll deduct applies");
      const line = observationLine(content);
      expect(line, `the account is lost:\n${content}`).toMatch(/late today/);
      expect(line, `the payroll answer is the account:\n${content}`).not.toMatch(/payroll deduct|Payroll deduction amount|\$20/i);
      expect(content, `the $20 left the payroll line:\n${content}`).toMatch(/\*\*Payroll deduction:\*\* Yes, \$20/);
    },
  },
  {
    id: "nov8-payroll-clause-reason-kept",
    title: "must not change: \"$25 will be payroll deducted for late open on 10-21-26\" keeps what the deduction is for",
    report: REPORT,
    status: "fixed",
    fixFlags: FIX,
    async run(t) {
      const content = await card(t, "create a written ca for Rowan Kestrel. $25 will be payroll deducted for late open on 10-21-26");
      expect(observationLine(content), `the reason is lost:\n${content}`).toMatch(/late open/i);
    },
  },
];
