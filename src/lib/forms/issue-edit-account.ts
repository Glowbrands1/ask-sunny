/**
 * ============================================================================
 * "CHANGE THE ISSUE TO <SENTENCE>" REPLACES THE ACCOUNT (ISSUE_EDIT_IS_THE_ACCOUNT_ENABLED)
 * ============================================================================
 *
 * v2-Gate-Bubbles-5's probes on main (via QA, 14 Nov 2026): on a saved Corrective Action for lateness, "change the issue
 * to she was texting on her cell phone the whole shift on Nov 4th" changed only the date, and "… on 11/3/26" replied
 * "Nothing needed changing": the CA's date reader (`ca-chat-corrections.ts`) took the turn for the date in it.
 *
 * A turn that replaces the account names the account ("the issue", "the observation (of offense)", "what happened",
 * "the account", "the write-up", "the details", "the incident") after an edit verb, and gives a new account after
 * "to / with / as": words left once the dates are taken out, at least three of them. "change the incident to 11/4"
 * (a date alone) and "change the incident date to 11/4" are dates, not accounts. Pure: no flag, no I/O.
 */

const ACCOUNT_EDIT =
  /\b(?:change|update|replace|switch|rewrite|re-?write|reword|make|set|edit)\s+(?:the\s+|her\s+|his\s+|their\s+|this\s+)?(?:issue|observation(?:\s+of\s+offen[cs]e)?|account|what\s+happened|write[- ]?up|details|incident)\s+(?:to(?:\s+say)?|with|as|so\s+it\s+says)\s*:?\s+(.+)$/i;

const MONTHS = "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";
const DATE_WORDS = new RegExp(
  [
    String.raw`\b(?:on|dated|from)?\s*\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b`,
    String.raw`\b(?:on|dated|from)?\s*(?:${MONTHS})\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?\b`,
    String.raw`\b(?:on|dated|from)?\s*(?:the\s+)?\d{1,2}(?:st|nd|rd|th)\s+of\s+(?:${MONTHS})\b`,
    String.raw`\b(?:on\s+)?(?:yesterday|today|last\s+night)\b`,
  ].join("|"),
  "gi",
);

/** The new account a turn replaces the old one with, or null when the turn is not an account replacement. */
export function replacedAccount(question: string): string | null {
  const match = ACCOUNT_EDIT.exec((question ?? "").trim());
  if (!match) return null;
  const account = match[1]!.trim().replace(/[.!]+$/, "");
  const words = account.replace(DATE_WORDS, " ").trim().split(/\s+/).filter((word) => /[a-z]/i.test(word));
  return words.length >= 3 ? account : null;
}
