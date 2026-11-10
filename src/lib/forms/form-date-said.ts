import { datesInText } from "./form-date-answer";

/**
 * ============================================================================
 * "MAKE THE DATE FOR 10/14/26" IS THE FORM'S DATE, NOT ONE MORE CANDIDATE
 * ============================================================================
 *
 * FORM_DATE_SAID_SETTLES_ENABLED (QA, 8 Nov 2026; both apps). On a Coaching proposal card about a meeting missed on
 * 10/10/26, "I need you to make it about showing up late and please list the policy make the date for 10/14/26."
 * still got "You mentioned more than one date (10/10, 10/14). Which date goes on the form?": in the sibling app the
 * card's Date stayed unset; here it read 10/14 and asked anyway. A date the manager says the FORM takes — "make /
 * set / change / put the date (to / for / as) <date>", "date it <date>", "the date should be <date>" — is the answer
 * to that question before it is asked. The latest such date wins.
 *
 * Pure: the caller decides when the flag applies.
 */

const SAID_BEFORE = new RegExp(
  String.raw`(?:` +
    // "make the date for 10/14/26", "set the form's date to 10/14", "change the date on the form to 10/14"
    String.raw`\b(?:make|set|change|put|update|switch|fix|correct|move)\s+(?:the\s+)?(?:form'?s\s+|its\s+)?date(?:\s+on\s+(?:the|this)\s+(?:form|draft|card))?\s+(?:(?:to|for|as|at|on)\s+)?(?:be\s+)?` +
    // "date it 10/14", "date the form for 10/14"
    String.raw`|\bdate\s+(?:it|this|the\s+(?:form|draft|card))\s+(?:(?:for|as|on|to)\s+)?` +
    // "the date should be 10/14", "the form's date is 10/14"
    String.raw`|\b(?:the\s+)?(?:form'?s\s+)?date\s+(?:should|needs?\s+to|has\s+to|must)\s+be\s+(?:(?:for|on)\s+)?` +
    String.raw`|\b(?:the\s+)?(?:form'?s\s+)?date\s+(?:is|will\s+be)\s+(?:(?:for|on)\s+)?` +
    String.raw`)$`,
  "i",
);

/** The date the manager said the form takes, latest first said last; null when none was. */
export function saidFormDate(text: string, today: string): string | null {
  const said = (text ?? "").replace(/[’]/g, "'");
  let found: string | null = null;
  for (const date of datesInText(said, today)) {
    const before = said.slice(Math.max(0, date.index - 80), date.index);
    if (SAID_BEFORE.test(before)) found = date.iso;
  }
  return found;
}
