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
 * - Text inside quotes (the manager's words typed back verbatim) is left as written. The card's account line is
 *   Sunny's paraphrase and names the person too (QA, Runner 2's 266 re-run).
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

/** The card's account line (the Observation, coaching details): pronouns there are replaced too (QA, 16 Nov 2026). */
export const ACCOUNT_LINE = /^[ \t*_>-]*(?:Observation(?: of Offense)?|Coaching Details|What happened)[*_]*\s*:.*$/gim;

/**
 * The spans of the reply inside quotes (straight or curly): the manager's words typed back verbatim, left as written.
 * QA (16 Nov 2026, Runner 2's 266 re-run): the card's account line is NOT exempt any more. "She was late on …" there is
 * Sunny's paraphrase, Sunny's wording, so it names the person too; only text in quotes stays as the manager typed it.
 */
function quotedSpans(text: string, managerWords?: string): Array<[number, number]> {
  const flat = (words: string) => words.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const said = managerWords === undefined ? null : flat(managerWords);
  const spans: Array<[number, number]> = [];
  for (const match of text.matchAll(/"[^"\n]*"|“[^”\n]*”/g)) {
    /*
     * Runner 2's c020 T6: Sunny quoted its own card line ("She completed onboarding …"). Only what the manager typed is
     * kept as typed: with the manager's words given, a quote they do not hold is Sunny's wording and is named too.
     */
    if (said !== null && !said.includes(flat(match[0]))) {
      /*
       * Runner 2's c152 T1: the manager's words quoted back with a small difference ("sent her immediate resignation to
       * management") are still theirs: most of the quote's words (80%) and every pronoun in it are in what they typed.
       * c020 T6's quote holds a "She" the manager never typed, so it is Sunny's wording.
       */
      const saidWords = new Set(said.split(" "));
      const quoteWords = flat(match[0]).split(" ").filter(Boolean);
      const pronouns = quoteWords.filter((word) => /^(?:he|him|his|she|her|hers|himself|herself|they|them|their|theirs)$/.test(word));
      const held = quoteWords.filter((word) => saidWords.has(word)).length;
      const theirs = quoteWords.length > 0 && held / quoteWords.length >= 0.8 && pronouns.every((word) => saidWords.has(word));
      if (!theirs) continue;
    }
    spans.push([match.index!, match.index! + match[0].length]);
  }
  return spans;
}

/** The sentence around an offset (to read a field word before "they"). */
function sentenceBefore(text: string, at: number): string {
  // A full stop between digits or inside a date/number ("9.28", "1.5") does not end the sentence.
  const ends = [...text.slice(0, at).matchAll(/[.?!](?!\d)|\n/g)];
  const start = ends.length > 0 ? ends.at(-1)!.index! : -1;
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
export function withoutPersonPronouns(reply: string, name: string, others: readonly string[] = [], managerWords?: string): { text: string; replaced: number } {
  const display = name.trim();
  if (!display) return { text: reply, replaced: 0 };
  const quoted = quotedSpans(reply, managerWords);
  /*
   * Runner 2's c210 T2: "those edits name <M> and her figures" — "her" is <M>'s. A pronoun whose sentence names another
   * person before it is left as written (it may be theirs); the card's person named first ("She completed onboarding
   * with new hire <M>") is still replaced.
   */
  const otherKeys = others.map((other) => other.trim().toLowerCase()).filter((other) => other && other !== display.toLowerCase());
  const nameRe = (key: string, flags = "u") => new RegExp(`(?<![\\p{L}'-])${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}-])`, flags);
  const namesAnother = (at: number) => {
    const before = sentenceBefore(reply, at).toLowerCase();
    if (!otherKeys.some((other) => nameRe(other).test(before))) return false;
    return !reportedForThePerson(at, before);
  };
  /*
   * Pau's ruling (QA, 16 Nov 2026; Runner 2's c090 T5, c091 T2): "When <M> asked whether she had completed her 10-minute
   * sanitization, <P> said yes." When the card's person is ALSO named in the same sentence, a pronoun inside the clause the
   * other person's reporting verb opens ("<M> asked / told / said / reminded … whether / if / that / to …", up to the
   * clause's comma or semicolon) is the card's person's, and is replaced. Anything else after the other person's name stays
   * as written: "<M> and her figures" (c210 T2), "<M> … during her onboarding" (c097).
   */
  const reportedForThePerson = (at: number, before: string): boolean => {
    const sentenceEnd = /[.?!](?!\d)|\n/.exec(reply.slice(at));
    const sentence = before + reply.slice(at, sentenceEnd ? at + sentenceEnd.index : reply.length).toLowerCase();
    if (!nameRe(display.toLowerCase()).test(sentence)) return false;
    return otherKeys.some((other) => {
      const key = other.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const opener = new RegExp(`(?<![\\p{L}'-])${key}(?![\\p{L}-])[*_]*\\s+(?:asked|told|said|reminded|wanted\\s+to\\s+know)\\b(?:\\s+[\\p{L}'-]+){0,3}?\\s+(?:whether|if|that|to)\\b([^,;:]*)$`, "u");
      return opener.test(before);
    });
  };
  const inQuote = (at: number) => quoted.some(([from, to]) => at >= from && at < to) || namesAnother(at);
  const edits: Array<{ from: number; to: number; text: string }> = [];

  for (const match of reply.matchAll(ALWAYS)) {
    const at = match.index!;
    if (inQuote(at)) continue;
    const word = match[0].toLowerCase();
    const end = at + match[0].length;
    let text: string;
    if (word === "his" || word === "hers") text = possessive(display);
    // "her shift", "her 146 tans", "her own" own something; "for her.", "with her and", "talked to her" do not.
    else if (word === "her") text = /^\s+[A-Za-z0-9$]/.test(reply.slice(end)) && !NOT_OWNED.test(reply.slice(end)) ? possessive(display) : display;
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
