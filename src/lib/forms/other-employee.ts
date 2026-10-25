import { samePerson } from "./proposal";

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
 */

const TYPED_FOR = /\bfor\s+((?:[A-Z][\w'’-]*)(?:\s+[A-Z][\w'’-]*){0,3})/g;

/** Capitalised words after "for" that are not a person: a form, a policy, a day. */
const NOT_A_PERSON = /^(?:the|a|an|her|him|them|this|that|my|our|being|not|no|monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|may|june|july|august|september|october|november|december|corrective|coaching|ca|policy|written|verbal|final)$/i;

/** The people the manager typed after "for", whole, as written. */
export function typedPeopleAfterFor(question: string): string[] {
  const people: string[] = [];
  for (const match of question.matchAll(TYPED_FOR)) {
    const words = match[1]!.split(/\s+/);
    if (NOT_A_PERSON.test(words[0]!)) continue;
    people.push(words.join(" "));
  }
  return people;
}

const ONE_FOR = /\b(?:now\s+)?(?:one|another(?:\s+one)?|the\s+same(?:\s+thing)?|same(?:\s+thing)?)\s+for\s+\S/i;

/** Whether this turn is about a form for somebody other than the open form's employee. */
export function namesAnotherEmployee(question: string, employeeName: string): boolean {
  const typed = typedPeopleAfterFor(question);
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
  return question.replace(ONE_FOR_PHRASE, `a ${templateName}`);
}
