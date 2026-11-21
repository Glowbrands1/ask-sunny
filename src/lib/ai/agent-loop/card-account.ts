/**
 * ============================================================================
 * THE CARD'S ACCOUNT IS A SENTENCE ABOUT THE PERSON, DATED AS THE ISSUE LINE DATES (port from the sibling app: its QA's live re-test, 21 Nov 2026, A5)
 * ============================================================================
 *
 * "create verbal ca for <name> for opening the salon late on 10-1-26. …" got the card issue line "Opening the salon late on
 * 10-1-26.": the model put the request's for-clause in what_happened as typed, with no subject, and the dashed date as
 * typed. The sibling's QA expected "<First> opened the salon late on 10/1/26.". The rules book already asks for the person's name in
 * front; code now checks it (`accountHasNoSubject`: propose_form hands the account back to be written again with the
 * person as its subject), and writes a dashed date the way the issue line writes dates (`withSlashDates`). Grammar
 * only, never a word list about what happened. Pure.
 */

/** Words ending in "-ing" that open a sentence without being its verb. */
const NOT_A_VERB = /^(?:during|regarding|including|following|concerning|according|morning|evening|nothing|something|anything|everything|thing|clothing|ceiling|building|king|ring|spring|string|wing|bring|sing)$/i;
/** A finite verb or a subject pronoun: the sentence has its own subject somewhere. */
const HAS_SUBJECT = /\b(?:is|are|was|were|am|has|have|had|did|does|do|will|would|can|could|should|said|says|i|he|she|they|we)\b/i;
/** The account's first sentence opens with a gerund ("Opening the salon late …", "Not attending …", "For leaving early …"). */
const GERUND_LEAD = /^(?:for\s+)?(?:(?:not|again|repeatedly|consistently|continually)\s+)?([a-z]{2,}ing)\b/i;

/** Whether the account's first sentence says what was done with no one doing it ("Opening the salon late on 10-1-26."). */
export function accountHasNoSubject(account: string): boolean {
  const first = account.trim().split(/(?<=[.!?])\s+/)[0] ?? "";
  const lead = GERUND_LEAD.exec(first);
  if (!lead || NOT_A_VERB.test(lead[1]!)) return false;
  return !HAS_SUBJECT.test(first);
}

/** A dashed month-day-year ("10-1-26") written as the issue line writes dates ("10/1/26"); anything else as typed. */
export function withSlashDates(text: string): string {
  return text.replace(/(?<![\d/-])(\d{1,2})-(\d{1,2})-(\d{4}|\d{2})(?![\d-])/g, (typed, month: string, day: string, year: string) => {
    const m = Number(month);
    const d = Number(day);
    return m >= 1 && m <= 12 && d >= 1 && d <= 31 ? `${m}/${d}/${year}` : typed;
  });
}
