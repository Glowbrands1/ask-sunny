/**
 * ============================================================================
 * REPLY CHECKS FOR THE LOOP'S LIVE CASES (QA, 16 Nov 2026; Pau's first-name rule)
 * ============================================================================
 *
 * Test code only: these read a reply the way a reviewer would, to judge a live run. They are never used by the app (the
 * loop never reads the model's reply with word lists).
 *
 * A pronoun for the PERSON fails. he/him/his/she/her/hers/himself/herself always do (they never mean form fields).
 * they/them/their/theirs/themself fail only when they point at the person: in a person's place ("tell them", "they
 * quit", "themself") with no field word before them in the sentence, or "their" right before a person word ("their
 * last day", "their shift"). "I'll add them, or fill them on the draft" (the blank fields) passes.
 */

const ALWAYS = /\b(?:he|him|his|she|her|hers|himself|herself)\b/i;
/** they/them in a person's place: someone told, asked, thanked; someone who quit, worked, said; "themself". */
const THEY_PERSON =
  /\b(?:tell|ask|let|remind|give|call|text|email|meet|thank|inform|notify|pay|schedule|fire|terminate|coach)\s+them\b|\bthey(?:'re|'ve|'ll|'d)?\s+(?:were|are|was|is|have|had|will|would|quit|resigned|left|worked|said|did|can|should|need|gave|told|missed|came)\b|\bthemsel(?:f|ves)\b/i;
/** Words that make "they/them" the form's fields or the card, when they come before it in the sentence. */
const FIELD_WORDS = /\b(?:fields?|blanks?|boxes?|lines?|details|answers?|dates?|values?|sections?|items?|questions?)\b/i;
/** "their <person word>": the person's own things. */
const THEIR_PERSON = /\btheir\s+(?:\w+\s+)?(?:last\s+day|shift|shifts|manager|notice|job|title|position|schedule|salon|rehire|employment|paycheck|keys|conduct|termination|resignation|hours|role|start|end)\b/i;

function sentences(text: string): string[] {
  return text.replace(/\*\*/g, "").split(/(?<=[.!?])\s+|\n+/).map((part) => part.trim()).filter(Boolean);
}

/** The sentence that uses a pronoun for the person, or null when there is none. */
export function personPronoun(reply: string, _names: readonly string[] = []): string | null {
  for (const sentence of sentences(reply)) {
    if (ALWAYS.test(sentence) || THEIR_PERSON.test(sentence)) return sentence;
    const they = THEY_PERSON.exec(sentence);
    if (they && !FIELD_WORDS.test(sentence.slice(0, they.index))) return sentence;
  }
  return null;
}

/** Pau's rule: the person by first name, never the full name in the reply's words. Null when it holds. */
export function fullNameUsed(reply: string, full: string): string | null {
  const plain = reply.replace(/\*\*/g, "");
  if (new RegExp(`\\b${full}\\b`, "i").test(plain)) return `the full name "${full}"`;
  return null;
}
