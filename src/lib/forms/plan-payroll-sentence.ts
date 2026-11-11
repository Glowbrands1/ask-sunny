import { planPayrollSentenceEnabled } from "@/lib/config/chat-quality-flags";

import { employeeFirstName } from "./employee-reference";
import { CA_ACTION_PLAN_CLOSING, CA_ACTION_PLAN_CLOSING_REVISION_5 } from "./required-closing";
import type { PayrollDeductAnswer } from "./payroll-deduct-answer";

/**
 * PLAN_PAYROLL_SENTENCE_ENABLED (QA LS-B6 / LS-B9 and SX2 / SX3, 26 Oct 2026, in both apps): payroll
 * deduct Yes with the amount filled ($3.25, $25), and the Action Plan read
 * "Management will review the … policy with <name>. Future policy
 * violations …" with no word of the deduction. With the flag on the plan
 * gains "<name> will be payroll deducted <amount>." before its closing, the
 * amount the manager stated. Nothing else in the plan changes. Off, the plan
 * as it was.
 */
export function withPayrollSentence(
  plan: string,
  input: { readonly answer: PayrollDeductAnswer | null; readonly amount: string | null; readonly employeeName: string | null | undefined },
): string {
  if (!planPayrollSentenceEnabled()) return plan;
  return planWithPayrollSentence(plan, input);
}

/**
 * The same sentence, without the flag: CARD_CHANGE_PLAN_REBUILD_ENABLED adds it
 * when the finalized form's Change something panel sets payroll deduct Yes and
 * the Payroll deduction amount (`ca-action-plan-sync.ts`).
 */
export function planWithPayrollSentence(
  plan: string,
  input: { readonly answer: PayrollDeductAnswer | null; readonly amount: string | null; readonly employeeName: string | null | undefined },
): string {
  if (input.answer !== "yes" || !input.amount) return plan;
  const figure = input.amount.trim().replace(/^\$?\s*/, "$");
  if (plan.includes(figure)) return plan;
  const sentence = `${employeeFirstName(input.employeeName) ?? "The employee"} will be payroll deducted ${figure}.`;
  for (const closing of [CA_ACTION_PLAN_CLOSING, CA_ACTION_PLAN_CLOSING_REVISION_5]) {
    const at = plan.lastIndexOf(closing);
    if (at >= 0) return `${plan.slice(0, at)}${sentence} ${plan.slice(at)}`.replace(/\s+/g, " ").trim();
  }
  return `${plan.trim()} ${sentence}`;
}
