import { payrollClauseNotAccountEnabled } from "@/lib/config/chat-quality-flags";

/*
 * ============================================================================
 * "$20 PAYROLL DEDUCT APPLIES" IS THE PAYROLL ANSWER, NOT THE ACCOUNT (PAYROLL_CLAUSE_NOT_ACCOUNT_ENABLED)
 * ============================================================================
 *
 * QA's Sunny round-5 live tester (8 Nov 2026), item 2a: "… she was late today, $20 payroll deduct applies" read the
 * $20 (AMOUNT_BEFORE_PAYROLL_DEDUCT), but the Observation of Offense kept the raw "$20 payroll deduct applies" (as it
 * did before round 5) and, new with round 5, the app's own state line after it: "… applies Payroll deduction amount:
 * $20.". With the flag on, the account loses the app's "Payroll deduction amount: $X." line and a bare payroll answer
 * clause ("$20 payroll deduct applies", "payroll deduct is applicable"). A payroll clause that says what it is for
 * ("$25 will be payroll deducted for late open on 10-21-26") is left to the existing reader, which keeps the reason.
 * Off, the text as it was.
 */

const AMOUNT = String.raw`\$\s?\d[\d,]*(?:\.\d{1,2})?`;
const STATE_LINE = new RegExp(String.raw`\s*\bPayroll deduction amount:\s*${AMOUNT}\.?`, "gi");
const BARE_ANSWER = new RegExp(
  String.raw`(?:,\s*|\s+|^)(?:(?:and|with)\s+)?(?:${AMOUNT}\s+)?(?:will\s+be\s+)?payroll[- ]?deduct(?:ion|ed)?\s+(?:applies|apply|is\s+applicable|applicable|yes)(?=\s*(?:[.,;!?]|$))`,
  "giu",
);

export function withoutPayrollClauses(text: string): string {
  if (!payrollClauseNotAccountEnabled()) return text;
  return text.replace(STATE_LINE, "").replace(BARE_ANSWER, "").replace(/\s{2,}/g, " ").trim();
}
