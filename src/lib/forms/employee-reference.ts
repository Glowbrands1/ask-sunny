/**
 * ============================================================================
 * "CHRISTIANA DID NOT CALL IN", NOT "SHE DID NOT CALL IN"
 * ============================================================================
 *
 * REPORTED BY A TESTER (29 September 2026): "Sunny wrote: 'She did not call
 * in…' and we should avoid using pronouns so Sunny should say Christiana did
 * not call in." The business writes employment records by name. A gendered
 * pronoun is also a guess: the drafting model is given a name and the
 * manager's notes, and picks "she" or "he" from them.
 *
 * The drafting prompt now says so. This is the guard that runs on what came
 * back, because a prompt instruction is a request and not a boundary.
 *
 * ============================================================================
 * WHAT IT REPLACES, AND WHAT IT DELIBERATELY LEAVES
 * ============================================================================
 *
 * A SENTENCE-INITIAL "She" / "He" (and "She's", "Her …", "His …") becomes the
 * employee's first name. At the start of a sentence "Her" and "His" can only
 * be possessive, so "Her shift" becomes "Christiana's shift" without any
 * grammar being guessed. Mid-sentence pronouns are left: "told her" versus
 * "her shift" is exactly the guess this refuses to make, and the prompt
 * already asks the model to write the name there.
 *
 * NEVER INSIDE QUOTATION MARKS. A manager's quoted words, or a quoted policy,
 * are somebody else's text and stay as written.
 *
 * NEVER WHERE THE PRONOUN MAY BE SOMEBODY ELSE. "A customer complained. She
 * said…" — the "she" is the customer, and putting the employee's name there
 * would change a fact on an HR record. A pronoun that follows a sentence
 * introducing another person is left as the model wrote it.
 */

const SUBJECT = /^(She|He)(['’]s)?\b/;
const POSSESSIVE = /^(Her|His)\b(?=\s+[a-z])/;

/** Nouns that introduce a second person, so the next "she" may not be the employee. */
const ANOTHER_PERSON =
  /\b(?:customers?|clients?|guests?|tanners?|members?|callers?|visitors?|co-?workers?|colleagues?|team ?mates?|team members?|another (?:employee|consultant|tc)|managers?|supervisors?|salon directors?|district managers?|sds?|asds?|dms?|mother|father|mom|dad|parents?|husband|wife|boyfriend|girlfriend|partner|friends?|daughter|son|child|someone|somebody|a (?:woman|man|lady|guy))\b/i;

/** The employee's first name as a sentence opens with it. */
function firstName(employeeName: string): string | null {
  const first = employeeName.trim().split(/\s+/)[0];
  if (!first || !/^[A-Za-z][A-Za-z'’-]*$/.test(first)) return null;
  return first.charAt(0).toUpperCase() + first.slice(1);
}

/** The text with sentence-initial gendered pronouns replaced by the employee's first name. */
export function nameInsteadOfPronouns(text: string, employeeName: string): string {
  const name = firstName(employeeName);
  if (!name || !text) return text;

  // Quoted spans are split out and kept verbatim; only the text between them is read.
  const parts = text.split(/("[^"\n]*"|“[^”\n]*”)/);
  let previousSentence = "";
  return parts
    .map((part, index) => {
      if (index % 2 === 1) {
        previousSentence += part;
        return part;
      }
      // A sentence starts at the beginning, after . ! ? or a line break, or after a label's colon.
      return part.replace(
        /(^|[.!?]\s+|\n\s*|:\s+)([^.!?\n:]*)/g,
        (whole, opening: string, sentence: string, offset: number) => {
          const startsText = offset === 0 && index === 0;
          const rewritten = startsText || opening !== "" ? rewrite(sentence, previousSentence, name) : sentence;
          previousSentence = sentence;
          return opening + rewritten;
        },
      );
    })
    .join("");
}

function rewrite(sentence: string, previous: string, name: string): string {
  if (ANOTHER_PERSON.test(previous)) return sentence;
  const subject = SUBJECT.exec(sentence);
  if (subject) return `${name}${subject[2] ?? ""}${sentence.slice(subject[0].length)}`;
  if (POSSESSIVE.test(sentence)) return sentence.replace(POSSESSIVE, `${name}'s`);
  return sentence;
}

/** Every drafted value, with the employee named rather than gendered. */
export function nameEmployeeInDraft(
  values: Record<string, string>,
  employeeName: string,
): { values: Record<string, string>; renamed: string[] } {
  const next: Record<string, string> = {};
  const renamed: string[] = [];
  for (const [key, value] of Object.entries(values)) {
    const rewritten = typeof value === "string" ? nameInsteadOfPronouns(value, employeeName) : value;
    if (rewritten !== value) renamed.push(key);
    next[key] = rewritten;
  }
  return { values: next, renamed };
}

/** The drafting instruction, with the employee's name in it. */
export function employeeReferenceRule(employeeName: string): string {
  return `Refer to the employee by name (${employeeName.trim()}), never as "she", "he", "her", "him", "his" or "hers". Where repeating the name would read awkwardly, restructure the sentence rather than use a gendered pronoun. Keep any words you quote from the manager exactly as they wrote them.`;
}
