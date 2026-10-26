import { payrollTypoNotANameEnabled } from "@/lib/config/chat-quality-flags";

/**
 * ============================================================================
 * "YES PAYROL LDEDUCT" IS A PAYROLL ANSWER, NEVER A PERSON
 * ============================================================================
 *
 * Manager, 26 Oct 2026 (Ask Sunny production, conv 2a156f63): after a Late
 * Opening card for her employee, "yes payrol ldeduct" answered the payroll
 * question. The name reader takes a short reply, after "yes", as a typed name;
 * "payroll" and "deduct" are stop words, but the typos are not, so
 * "payrol ldeduct" became the employee and the card warned "This proposal is
 * out of date: the conversation now says the form is for payrol ldeduct, not
 * <employee>." and Create was refused. With PAYROLL_TYPO_NOT_A_NAME_ENABLED, a
 * manager turn that is only a payroll answer — "yes"/"no" and payroll / pay /
 * deduct(ion) wording, typos included — is not read for the employee by the
 * proposal currency check, as an answer to the date question already is not.
 */
// "payroll", "payrol", "pay roll", "deduct", "deduction", "ldeduct" (the l slipped off "payroll"), "amount".
const PAYROLL_WORD = /^(?:pay|roll|pa?y?r+o+l+|deduct(?:ion|ed|s)?|dedu?c?t\w*|amount|amt)$/;

export function isPayrollWords(candidate: string): boolean {
  if (!payrollTypoNotANameEnabled()) return false;
  const words = candidate
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .map((word) => word.replace(/[.,!?'"]+/g, "").replace(/^l(?=d)/, ""))
    .filter(Boolean);
  // Every word payroll wording, and at least one of them payroll or deduct itself: "Roll" alone is somebody.
  return words.length > 0 && words.every((word) => PAYROLL_WORD.test(word)) && /pa?y?\s*r+o+l|dedu?c/.test(words.join(" "));
}

/** "yes payrol ldeduct", "payrol deduct yes", "no payroll deduct": a turn that only answers the payroll question. */
export function isPayrollAnswer(turn: string): boolean {
  if (!payrollTypoNotANameEnabled()) return false;
  const words = turn
    .trim()
    .replace(/^(?:yes|yeah|yep|yup|no|nope)\b[\s,.!-]*/i, "")
    .replace(/[\s,.!-]*\b(?:yes|yeah|yep|yup|no|nope)[.!]*$/i, "");
  return isPayrollWords(words);
}
