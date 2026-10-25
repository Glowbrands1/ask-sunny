import { NOT_A_NAME, NOT_A_TYPED_NAME } from "./name-words";
import { notANameGuardEnabled } from "@/lib/config/chat-quality-flags";
import { isNotAName } from "./not-a-name";
import { isFormVocabulary } from "./template-intent";

/**
 * ============================================================================
 * "TEST EMPLOYEE" IS A NAME WHEN THE MANAGER TYPES IT AS ONE
 * ============================================================================
 *
 * QA, 25 Oct 2026: "create a written CA for Test Employee at Kearney for
 * missing the 10-15-26 woven deadline" drafted the form for **Test**. The
 * proposal's sentence reader ends a capitalised name at a word that names a
 * form, and "Employee" is one ("Employee Performance Plan"), so the second
 * word of the name was cut.
 *
 * Nobody is really surnamed "Employee", but a manager who types "Test
 * Employee" as the person's name gets that name. Only on that evidence:
 *
 *   - "Employee" capitalised, right after a capitalised first word that is a
 *     name (not "An", "My", "The", "New", a form word or a place);
 *   - in a place that gives the employee: the form's subject ("for Test
 *     Employee"), a label ("name is Test Employee", "employee: Test
 *     Employee"), or the start of the turn ("Test Employee at Kearney",
 *     "Test Employee, Salon Director");
 *   - not followed by another capitalised word ("Employee Performance Plan",
 *     "Employee Handbook").
 *
 * A lower-case "an employee", "my employee", "the employee" and "employee name
 * is X" are never read here. Used behind KEEP_FORM_EMPLOYEE_ENABLED.
 */

/** Words before "Employee" that describe somebody rather than name them. */
const DESCRIBING = new Set([
  "each", "every", "your", "another", "other", "some", "no", "former", "current", "part", "full", "senior",
  "junior", "lead", "hourly", "salaried", "seasonal", "temporary", "temp", "trainee", "problem", "star", "top",
  "model", "difficult", "good", "bad", "best", "worst", "same", "previous", "prior", "next", "last", "first",
]);

const FIRST = "([A-Z][a-z][a-zA-Z'’-]*)";
/** "Employee" as a whole word, not "Employees" or "Employee's", and not the start of a title. */
const EMPLOYEE = "Employee(?![\\w'’-])(?!\\s+[A-Z])";

const POSITIONS: readonly RegExp[] = [
  new RegExp(`\\b(?:for|about|regarding)\\s+${FIRST}\\s+${EMPLOYEE}`, "g"),
  new RegExp(`\\b(?:[Nn]ame|[Ee]mployee)\\s*(?:is|:)\\s*${FIRST}\\s+${EMPLOYEE}`, "g"),
  new RegExp(`(?:^|\\n)\\s*${FIRST}\\s+${EMPLOYEE}(?=\\s*(?:,|\\bat\\b|[.!]?\\s*$))`, "g"),
];

/*
 * NOT_A_NAME_GUARD_ENABLED (ported from Ask Bubbles, QA B8 / G11 there). The
 * role in front of the name: "for Tanning Consultant, Test Employee at
 * Kearney, NE", "for tanning consultant Test Employee at lincoln".
 */
const AFTER_ROLE = new RegExp(
  `\\b(?:for|about|regarding)\\s+(?:(?:a|an|the|my|our)\\s+)?(?:[A-Za-z]+\\s+){0,2}[A-Za-z]+,?\\s+${FIRST}\\s+${EMPLOYEE}(?=\\s*(?:,|\\bat\\b|\\bwho\\b|[.!]|$))`,
  "g",
);

/*
 * NOT_A_NAME_GUARD_ENABLED (QA G4, Ask Sunny conv_mvo1t7qv253555k): "Okay
 * let's restart. Test Employee, Tanning Consultant, KS Manhattan. …" — the
 * name opening a sentence after another, as it opens a turn. Only the model's
 * slot carried it, so the card dropped the employee in one run of three.
 */
const SENTENCE_START = new RegExp(`(?<=[.!?]\\s+)${FIRST}\\s+${EMPLOYEE}(?=\\s*(?:,|\\bat\\b|[.!]?\\s*$))`, "g");

function namesSomebody(first: string): boolean {
  const key = first.toLowerCase();
  if (NOT_A_NAME.has(key) || NOT_A_TYPED_NAME.has(key) || DESCRIBING.has(key)) return false;
  if (isFormVocabulary(first)) return false;
  return !isNotAName(first) && !isNotAName(`${first} Employee`);
}

/** "Test Employee" when the manager typed it as the employee's name, else null. */
export function typedEmployeeName(text: string): string | null {
  if (!text || !text.includes("Employee")) return null;
  for (const position of notANameGuardEnabled() ? [...POSITIONS, AFTER_ROLE, SENTENCE_START] : POSITIONS) {
    for (const match of text.matchAll(position)) {
      const first = match[1]!;
      if (namesSomebody(first)) return `${first} Employee`;
    }
  }
  return null;
}
