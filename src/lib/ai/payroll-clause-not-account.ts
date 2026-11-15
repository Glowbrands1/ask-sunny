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

/*
 * QA, batch J (15 Nov 2026): "yes payroll but I don't know the amount", the answer to the payroll question, was
 * written into the Observation after the account ("… late on 11/9/26 yes payroll but I don't know the amount"). A
 * sentence that is only the payroll answer ("yes payroll", "payroll yes", "no payroll deduct"), with or without the
 * not-known amount after it, is no account. A sentence that says anything else is left as it was.
 */
const PAYROLL_ANSWER_ONLY =
  /^(?:(?:yes|yeah|yep|yup|no|nope|and)[,\s]+)?(?:(?:the\s+)?payroll[- ]?(?:deduct(?:ion|ed)?)?|pd)(?:\s+(?:is\s+)?(?:yes|no|applies|apply|applicable))?$/i;
const AMOUNT_NOT_KNOWN =
  /^(?:but\s+|and\s+)?(?:i\s+)?(?:do\s*n['’]?t|do\s+not)\s+know(?:\s+(?:what\s+)?the)?\s+(?:amount|figure|total)(?:\s+yet)?$|^(?:but\s+|and\s+)?(?:not\s+sure|unsure)\s+(?:of|about|what)\s+(?:the\s+)?(?:amount|figure|total)$|^(?:but\s+|and\s+)?idk\s+(?:the\s+)?(?:amount|figure|total)$/i;

function onlyThePayrollAnswer(sentence: string): boolean {
  const said = sentence.trim().replace(/[.!]+$/, "").trim();
  if (said === "") return false;
  if (AMOUNT_NOT_KNOWN.test(said)) return true;
  const [answer, ...rest] = said.split(/\s*(?:,|;|\bbut\b)\s*/i);
  if (!PAYROLL_ANSWER_ONLY.test((answer ?? "").trim())) return false;
  return rest.every((clause) => clause.trim() === "" || AMOUNT_NOT_KNOWN.test(clause.trim()));
}

export function withoutPayrollClauses(text: string): string {
  if (!payrollClauseNotAccountEnabled()) return text;
  const kept = text
    .split(/(?<=[.!?])\s+|\n+/)
    .filter((sentence) => !onlyThePayrollAnswer(sentence))
    .join(" ");
  return kept.replace(STATE_LINE, "").replace(BARE_ANSWER, "").replace(/\s{2,}/g, " ").trim();
}
