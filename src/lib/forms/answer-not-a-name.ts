import { answerNotANameEnabled, dateAnswerAppliedEnabled } from "@/lib/config/chat-quality-flags";

import { isPayrollWords } from "./payroll-words";

/*
 * The same words as `isDateAnswerWords` in `incident-dates.ts`, held here
 * because that module imports `proposal.ts` and this one is imported by it
 * (see `import-cycles.test.ts`). A test pins the two to the same answers.
 */
const DATE_ANSWER_WORDS = /^(?:the\s+)?(?:most\s+recent|latest|newest|last(?:\s+(?:one|date))?|first(?:\s+one)?|earliest|oldest|second(?:\s+one)?)$/i;

function isDateAnswer(name: string): boolean {
  return dateAnswerAppliedEnabled() && DATE_ANSWER_WORDS.test(name.trim());
}

/**
 * ============================================================================
 * AN ANSWER TO THE APP'S QUESTION NAMES NOBODY
 * ============================================================================
 *
 * Manager, 26 Oct 2026 (Ask Sunny production): six turns about a late
 * opening, the fourth "yes payrol ldeduct". The name reader in `proposal.ts`
 * took "payrol ldeduct" for a person, so the card's sources restarted at that
 * turn and the account before it never reached the draft: blank. The same
 * with "most recent" answering the date question after a turn in between.
 *
 * With ANSWER_NOT_A_NAME_ENABLED, a candidate that is only payroll wording or
 * only a date answer is not a name. Off, every candidate is kept: main.
 */
export function namesSomebody(name: string): boolean {
  if (!answerNotANameEnabled()) return true;
  return !isPayrollWords(name) && !isDateAnswer(name);
}
