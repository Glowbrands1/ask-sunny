/**
 * ============================================================================
 * THE REPLY CALLS THE PERSON BY NAME, NEVER A PRONOUN (Pau's rule; QA, 16 Nov 2026)
 * ============================================================================
 *
 * The rules book asks for <reply_name> every time, and the live run of #1067 still wrote "nothing is on file for her"
 * in 1 of 6 replies. This is the reply-side check: when exactly one person's reply_name came back from this turn's
 * tools, a pronoun in the reply that refers to a person is replaced by that name. Deterministic, no model call.
 *
 * It reads the MODEL'S reply (never the manager's words: those are never read with word lists). What counts:
 * - he / she / him / his / her / hers / himself / herself: always a person.
 * - they / them / their / theirs / themself: only in a person's place (someone told, asked or thanked; someone who quit,
 *   worked or said; "their last day", "their shift"), never after a field word in the sentence ("two fields are
 *   blank: tell me and I'll add them"), so "they" for the blank fields or a group stays.
 * - Text inside quotes (the manager's words quoted back, a form's wording), and the card's account line (the
 *   Observation in the manager's own words), are left as written.
 * The patterns were the replay pack's live-run judge (`replay-pack/reply-checks.ts`), whose must-pass and must-fail
 * examples are this module's unit tests.
 */

const ALWAYS = /\b(?:he|him|his|she|her|hers|himself|herself)\b/gi;
/** they/them in a person's place: someone told, asked, thanked; someone who quit, worked, said; "themself". */
const THEY_PERSON =
  /\b(?:tell|ask|let|remind|give|call|text|email|meet|thank|inform|notify|pay|schedule|fire|terminate|coach)\s+them\b|\bthey(?:'re|'ve|'ll|'d)?\s+(?:were|are|was|is|have|had|will|would|quit|resigned|left|worked|said|did|can|should|need|gave|told|missed|came)\b|\bthemsel(?:f|ves)\b/gi;
/** Words that make "they/them" the form's fields or the card, when they come before it in the sentence. */
const FIELD_WORDS = /\b(?:fields?|blanks?|boxes?|lines?|details|answers?|dates?|values?|sections?|items?|questions?)\b/i;
/** "their <person word>": the person's own things. */
const THEIR_PERSON = /\btheir(?=\s+(?:\w+\s+)?(?:last\s+day|shift|shifts|manager|notice|job|title|position|schedule|salon|store|rehire|employment|paycheck|keys|conduct|termination|resignation|hours|role|start|end|card|form)\b)/gi;
/** After "her", a word that is not the thing she owns: "for her and", "tell her that", "her." (object, not possessive). */
const NOT_OWNED = /^\s+(?:to|and|or|that|a|an|the|about|if|so|now|yet|on|in|at|for|with|again|know|too|as|is|was|when|before|after|by|from|this|these|those|it)\b/i;

/**
 * The card's account line: the Observation (or coaching details) is the manager's own words on the card, shown as the
 * card holds them (the pack's run found "Observation of Offense: she was late on 10/26/26"). Left as written.
 */
export const ACCOUNT_LINE = /^[ \t*_>-]*(?:Observation(?: of Offense)?|Coaching Details|What happened)[*_]*\s*:.*$/gim;

/** The spans of the reply inside quotes (straight or curly), or on the card's account line, which are left as written. */
function quotedSpans(text: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  for (const match of text.matchAll(/"[^"\n]*"|“[^”\n]*”/g)) spans.push([match.index!, match.index! + match[0].length]);
  for (const match of text.matchAll(ACCOUNT_LINE)) spans.push([match.index!, match.index! + match[0].length]);
  return spans;
}

/** The sentence around an offset (to read a field word before "they"). */
function sentenceBefore(text: string, at: number): string {
  const start = Math.max(text.lastIndexOf(".", at - 1), text.lastIndexOf("?", at - 1), text.lastIndexOf("!", at - 1), text.lastIndexOf("\n", at - 1));
  return text.slice(start + 1, at);
}

const possessive = (name: string) => (/s$/i.test(name) ? `${name}'` : `${name}'s`);

/** The verb after a replaced "they" agrees with one person ("they were" → "<name> was"). */
function singularAfterThey(rest: string): string {
  return rest
    .replace(/^'re\b/i, " is").replace(/^'ve\b/i, " has")
    .replace(/^(\s+)were\b/i, "$1was").replace(/^(\s+)are\b/i, "$1is").replace(/^(\s+)have\b/i, "$1has")
    .replace(/^(\s+)need\b/i, "$1needs").replace(/^(\s+)don't\b/i, "$1doesn't");
}

/**
 * The reply with every pronoun for the person replaced by `name`, and how many were replaced. `name` is the turn's one
 * reply_name; with none or several, the caller does not call this.
 */
export function withoutPersonPronouns(reply: string, name: string): { text: string; replaced: number } {
  const display = name.trim();
  if (!display) return { text: reply, replaced: 0 };
  const quoted = quotedSpans(reply);
  const inQuote = (at: number) => quoted.some(([from, to]) => at >= from && at < to);
  const edits: Array<{ from: number; to: number; text: string }> = [];

  for (const match of reply.matchAll(ALWAYS)) {
    const at = match.index!;
    if (inQuote(at)) continue;
    const word = match[0].toLowerCase();
    const end = at + match[0].length;
    let text: string;
    if (word === "his" || word === "hers") text = possessive(display);
    else if (word === "her") text = /^\s+[A-Za-z]/.test(reply.slice(end)) && !NOT_OWNED.test(reply.slice(end)) ? possessive(display) : display;
    else text = display;
    edits.push({ from: at, to: end, text });
  }
  for (const match of reply.matchAll(THEY_PERSON)) {
    const at = match.index!;
    if (inQuote(at) || FIELD_WORDS.test(sentenceBefore(reply, at))) continue;
    const phrase = match[0];
    const pronoun = /\bthem\b/i.exec(phrase) ?? /\bthey\b/i.exec(phrase) ?? /\bthemsel(?:f|ves)\b/i.exec(phrase);
    if (!pronoun) continue;
    const from = at + pronoun.index;
    const to = from + pronoun[0].length;
    if (/^they$/i.test(pronoun[0])) {
      const tail = phrase.slice(pronoun.index + pronoun[0].length);
      edits.push({ from, to: at + phrase.length, text: display + singularAfterThey(tail) });
    } else edits.push({ from, to, text: display });
  }
  for (const match of reply.matchAll(THEIR_PERSON)) {
    const at = match.index!;
    if (inQuote(at) || FIELD_WORDS.test(sentenceBefore(reply, at))) continue;
    edits.push({ from: at, to: at + match[0].length, text: possessive(display) });
  }
  if (edits.length === 0) return { text: reply, replaced: 0 };
  // Apply from the end, skipping overlaps.
  edits.sort((a, b) => b.from - a.from);
  let text = reply;
  let floor = Number.POSITIVE_INFINITY;
  let replaced = 0;
  for (const edit of edits) {
    if (edit.to > floor) continue;
    text = text.slice(0, edit.from) + edit.text + text.slice(edit.to);
    floor = edit.from;
    replaced += 1;
  }
  return { text, replaced };
}
