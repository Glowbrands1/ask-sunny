import { NOT_A_NAME, NOT_A_TYPED_NAME, TYPED_NAME_WORD } from "./name-words";
import { samePerson } from "./proposal";
import { isFormVocabulary } from "./template-intent";

/**
 * ============================================================================
 * "NOW ONE FOR <SOMEBODY ELSE>" IS A NEW FORM, NOT AN EDIT OF THE OPEN ONE
 * ============================================================================
 *
 * DIFFERENT_EMPLOYEE_NEW_FORM_ENABLED (sibling QA, B21-4, 25 Oct 2026). After Create
 * for Test Employee, "now one for Test Employee Two at Kearney for being late
 * on 10-20-26" redrafted Test Employee's form: the name reader keeps only
 * "Test" (it drops "Employee", a word that ends a document's name), and "Test"
 * is Test Employee's first name. So the turn's own typed person is read here,
 * whole, as the manager wrote it after "for": a capitalised run of up to four
 * words, ending at the first word that is not capitalised.
 *
 * A turn that names somebody who is not the open form's employee, or that asks
 * for "one for", "another one for" or "the same for" somebody else, is about
 * another form. The open form is left alone and the turn gets its own card.
 *
 * QA-6 (below) reads the same names typed in any case, and leaves out a person
 * the manager ruled out. Everything here runs only behind the flag: its two
 * callers (`other-employee-form.ts` from the chat route, and
 * `proposal-currency.ts`) check DIFFERENT_EMPLOYEE_NEW_FORM_ENABLED first, so
 * with the flag off nothing here is read and the chat is as on main.
 */

const TYPED_FOR = /for\s+((?:[A-Z][\w'’-]*)(?:\s+[A-Z][\w'’-]*){0,3})/y;

/** Capitalised words after "for" that are not a person: a form, a policy, a day. */
const NOT_A_PERSON = /^(?:the|a|an|her|him|them|this|that|my|our|being|not|no|monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|may|june|july|august|september|october|november|december|corrective|coaching|ca|policy|written|verbal|final)$/i;

/*
 * QA-6, 26 Oct 2026: NO READER MAY DEPEND ON CAPITALS. "now one for test
 * employee two" read nobody, so the open form was redrafted, while "Test
 * Employee Two" made its own card. A name typed without capitals is read the
 * way the repo's typed-name readers read one (`readTypedName` in
 * `proposal.ts`, `couldBeName` in `template-intent.ts`): up to three words that
 * can each be part of a name, ending at the first that cannot ("at", "for",
 * "being", a form word, a comma). "Employee" after a first word is the
 * surname a manager gives a test person ("test employee two"), as
 * `typed-employee-name.ts` reads it with capitals.
 *
 * Without a capital, nothing in the word itself says "name", so the POSITION
 * has to: a name the conversation already knows (the open form's employee, or
 * somebody typed earlier), "test employee", or a request for a form ("one
 * for", "another one for", "the same for", "a CA for", ", for" correcting a
 * "not for"). "she was written up for rudeness" and "now one for the closing
 * shift" name nobody.
 */
const ANY_FOR = /\bfor\s+/gi;
const NAME_PARTS = 3;
const GERUND = /^[a-z]{3,}ing$/i;
const PLACEHOLDER_SURNAME = "employee";
const ASKS_FOR_A_FORM =
  /\b(?:one|another(?:\s+one)?|(?:the\s+)?same(?:\s+thing)?|ca|form|card|write-?up|corrective\s+action(?:\s+form)?)\s*$/i;

/*
 * QA-6: A PERSON THE MANAGER RULED OUT IS NOT ANOTHER EMPLOYEE. "never one for
 * Rowan Pell" and "do not make one for Rowan Pell" made a new card for Rowan
 * Pell. A name governed, in its own clause, by not / never / no / don't / do
 * not (make, create … one) / without / except is left out. In "not for X, for
 * Y" only Y counts: the comma starts Y's own clause.
 */
const CLAUSE_BREAK = /[,.;:!?]|\s[-–—]\s|\bbut\b/gi;
const RULED_OUT = new RegExp(
  "\\b(?:not|never|no|without|except|don['’]?t|do\\s+not)\\s+" +
    "(?:(?:make|create|do|start|draft|write|open|file|give|need|want)\\s+)?" +
    "(?:(?:a|an|the|another|any|one|same|thing|new|form|card|ca|corrective|action|write-?up)\\s+){0,3}$",
  "i",
);

/** The words of `text` before `index` that are in the same clause. */
function clauseBefore(text: string, index: number): string {
  const before = text.slice(0, index);
  let start = 0;
  for (const match of before.matchAll(CLAUSE_BREAK)) start = match.index + match[0].length;
  return before.slice(start);
}

/** A name read without capitals: up to three words that can each be part of a name. */
function uncapitalisedName(after: string): string[] {
  const parts: string[] = [];
  for (const raw of after.split(/\s+/)) {
    if (parts.length === NAME_PARTS) break;
    const word = raw.replace(/[,.;:!?)"”’]+$/, "");
    const lower = word.toLowerCase();
    const usable =
      TYPED_NAME_WORD.test(word) &&
      word.length > 1 &&
      !NOT_A_NAME.has(lower) &&
      !NOT_A_TYPED_NAME.has(lower) &&
      (parts.length > 0 || (!NOT_A_PERSON.test(lower) && !GERUND.test(lower))) &&
      (!isFormVocabulary(lower) || (parts.length > 0 && lower === PLACEHOLDER_SURNAME));
    if (!usable) break;
    parts.push(word);
    if (word !== raw) break;
  }
  return parts;
}

/**
 * The people the manager typed after "for", whole, as written, in any case —
 * and never one the manager ruled out. `known` are the names the conversation
 * already knows, read wherever "for" gives them.
 */
export function typedPeopleAfterFor(question: string, known: readonly string[] = []): string[] {
  const people: string[] = [];
  const knownNames = known.map((name) => name.trim().toLowerCase().split(/\s+/).join(" ")).filter(Boolean);
  let ruledOutBefore = false;
  for (const match of question.matchAll(ANY_FOR)) {
    const clause = clauseBefore(question, match.index);
    const ruledOut = RULED_OUT.test(clause);
    const correcting = ruledOutBefore && clause.trim() === "";
    if (ruledOut) ruledOutBefore = true;
    TYPED_FOR.lastIndex = match.index;
    const capitalised = TYPED_FOR.exec(question);
    if (capitalised) {
      const words = capitalised[1]!.split(/\s+/);
      if (!ruledOut && !NOT_A_PERSON.test(words[0]!)) people.push(words.join(" "));
      continue;
    }
    if (ruledOut) continue;
    const words = uncapitalisedName(question.slice(match.index + match[0].length));
    if (words.length === 0) continue;
    const read = words.join(" ").toLowerCase();
    const placed =
      knownNames.some((name) => read === name || read.startsWith(`${name} `) || read === name.split(" ")[0]) ||
      words[1]?.toLowerCase() === PLACEHOLDER_SURNAME ||
      ASKS_FOR_A_FORM.test(clause) ||
      correcting;
    if (placed) people.push(words.join(" "));
  }
  return people;
}

const ONE_FOR = /\b(?:now\s+)?(?:one|another(?:\s+one)?|the\s+same(?:\s+thing)?|same(?:\s+thing)?)\s+for\s+\S/i;

/** Whether this turn is about a form for somebody other than the open form's employee. */
export function namesAnotherEmployee(question: string, employeeName: string, known: readonly string[] = []): boolean {
  const typed = typedPeopleAfterFor(question, [employeeName, ...known]);
  if (typed.some((person) => !samePerson(person, employeeName))) return true;
  return ONE_FOR.test(question) && typed.length > 0 && typed.every((person) => !samePerson(person, employeeName));
}

const ONE_FOR_PHRASE = /\b(?:now\s+)?(?:one|another(?:\s+one)?|the\s+same(?:\s+thing)?|same(?:\s+thing)?)(?=\s+for\s)/i;

/**
 * The turn with "one" / "another one" / "the same" replaced by the form's own
 * name, so every reader sees which form it asks for: "now one for Casey …"
 * → "a Corrective Action Form for Casey …". A turn without such a phrase is
 * returned as written.
 */
export function namingTheForm(question: string, templateName: string): string {
  const asked = ONE_FOR_PHRASE.exec(question);
  // QA-6: "never one for Rowan Pell" asks for no form; it is returned as written.
  if (asked && RULED_OUT.test(clauseBefore(question, asked.index))) return question;
  return question.replace(ONE_FOR_PHRASE, `a ${templateName}`);
}
