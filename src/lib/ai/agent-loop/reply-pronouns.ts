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
/** A verb that reports what someone asked, said or wrote (in Sunny's reply): the clause after it is reported speech. */
const REPORTING = /\b(?:asked|asking|told|telling|said|saying|stated|stating|reminded|reminding|messaged|messaging|texted|texting|emailed|wrote|writing|replied|replying|explained|explaining|claimed|claiming|admitted|admitting|wanted\s+to\s+know)\b/;
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
export function withoutPersonPronouns(
  reply: string,
  name: string,
  others: readonly string[] = [],
  managerWords?: string,
  /** Who may report for the card's person besides the person themself: the signed-in manager and roster leaders (QA, 17 Nov 2026). */
  reporters: readonly string[] = [],
): { text: string; replaced: number } {
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
    return otherKeys.some((other) => nameRe(other).test(before));
  };
  /*
   * Pau's ruling (QA, 16 Nov 2026; Runner 2's c090 T5, c091 T2), as QA narrowed it on 17 Nov 2026 (c090 T5, c091 T5, c247 T1
   * on train 3): a pronoun inside a clause a named person reports ("asked whether she …", "stating she quit") is the card
   * person's, and is replaced, only when that reporter is the card's person themself (c247: "<P> messaged <SD> via Woven
   * stating she quit"), the signed-in manager, or someone the roster titles a leader (c090/c091: the salon's manager asks
   * the consultant). A peer or a guest who asks or says something keeps the pronoun: "Juno asked whether she could swap
   * shifts" is Juno asking about herself. The clause is the text since the sentence's last comma, semicolon or colon, with
   * a reporting verb (REPORTING) in it; its reporter is the named person nearest before a finite verb ("<M> asked"), and the
   * sentence's first named person for a participle ("<P> messaged <SD> … stating"). A reporter who is a pronoun keeps it.
   * Anything else after another person's name stays as written: "<M> and her figures" (c210 T2), "<M> … during her
   * onboarding" (c097).
   */
  const reporterKeys = new Set([display.toLowerCase(), ...reporters.map((reporter) => reporter.trim().toLowerCase()).filter(Boolean)]);
  const knownKeys = [...new Set([display.toLowerCase(), ...otherKeys, ...reporterKeys])];
  /** For a pronoun in a reported clause: "trusted" (replace it), "untrusted" (keep it); null when it is not in one. */
  const reportedBy = (at: number): "trusted" | "untrusted" | null => {
    const before = sentenceBefore(reply, at).toLowerCase();
    const clause = before.split(/[,;:]/).at(-1) ?? before;
    const verb = REPORTING.exec(clause);
    if (!verb) return null;
    /*
     * A reporter who is a pronoun: it is the card's person exactly when that pronoun is replaced itself ("She said her car
     * broke down": both are the person's; train 4's pr6 case), else it may be the speaker's own ("<M> came in, and she said
     * her checklist …"). The reporter pronoun sits earlier in the sentence, so this ends.
     */
    const reporterPronouns = [...clause.slice(0, verb.index).matchAll(/\b(?:he|she|they)\b/g)];
    if (reporterPronouns.length > 0) {
      const sentenceStart = at - before.length;
      const clauseStart = sentenceStart + before.length - clause.length;
      return keepsOwn(clauseStart + reporterPronouns.at(-1)!.index!) ? "untrusted" : "trusted";
    }
    if (/\b(?:him|her|them|his|their)\b/.test(clause.slice(0, verb.index))) return "untrusted";
    const verbAt = before.length - clause.length + verb.index;
    const upToVerb = before.slice(0, verbAt);
    const hits = knownKeys.flatMap((key) => [...upToVerb.matchAll(nameRe(key, "gu"))].map((match) => ({ key, from: match.index!, to: match.index! + match[0].length })));
    if (/ing$/.test(verb[0])) {
      // A participle reports for the sentence's subject: its first named person ("<P> messaged <SD> … stating").
      if (hits.length === 0) return "untrusted";
      const first = Math.min(...hits.map((hit) => hit.from));
      return hits.some((hit) => hit.from === first && reporterKeys.has(hit.key)) ? "trusted" : "untrusted";
    }
    // A finite verb's reporter is the name right before it (markdown, or an appositive between commas, may sit between).
    const adjacent = hits.filter((hit) => /^[\s*_]*(?:,[^,]*,[\s*_]*)?$/.test(upToVerb.slice(hit.to)));
    if (adjacent.length > 0) return adjacent.some((hit) => reporterKeys.has(hit.key)) ? "trusted" : "untrusted";
    // "You said she …", "I asked whether she …": the manager or Sunny asking about the card's person.
    return /\b(?:you|i|we)[\s*_]*$/.test(upToVerb) ? "trusted" : "untrusted";
  };
  const keepsOwn = (at: number) => {
    const reported = reportedBy(at);
    return reported !== null ? reported === "untrusted" : namesAnother(at);
  };
  /*
   * THE PERSON TOLD (QA, 20 Nov 2026, board row f059; the live test of #1117): "<L>, the shift lead, told her to clock out
   * early and she refused" kept both pronouns, because "her" sat after a reporting verb of a non-leader. But the pronoun
   * right after "told / asked / reminded / instructed …" and before "to / not / that / if / whether" is the LISTENER, not
   * part of what was said: when someone other than the card's person is the one telling, the listener is the card's
   * person. The same pronoun opening a joined clause later in the sentence ("and she refused", "but he left") is that
   * listener acting, and is named too. Text in quotes stays as typed.
   */
  const told = new Set<number>();
  for (const match of reply.matchAll(/\b(?:told|asked|reminded|instructed|directed|warned)[\s*_]+(him|her|them)\b(?=\s+(?:to|not|that|if|whether)\b)/gi)) {
    const at = match.index! + match[0].length - match[1]!.length;
    if (quoted.some(([from, to]) => at >= from && at < to)) continue;
    const before = sentenceBefore(reply, match.index!).toLowerCase();
    // The card's person telling someone else ("Tamsin told her to …") is not this.
    const named = knownKeys.flatMap((key) => [...before.matchAll(nameRe(key, "gu"))].map((hit) => ({ key, at: hit.index! })));
    const teller = named.sort((a, b) => b.at - a.at)[0]?.key;
    if (!teller || teller === display.toLowerCase()) continue;
    told.add(at);
    const subject = { him: "he", her: "she", them: "they" }[match[1]!.toLowerCase() as "him" | "her" | "them"];
    const rest = reply.slice(at + match[1]!.length);
    const end = rest.search(/[.?!](?!\d)|\n/);
    const sentence = end === -1 ? rest : rest.slice(0, end);
    for (const joined of sentence.matchAll(new RegExp(`\\b(?:and|but|so|then)\\s+(${subject})\\b`, "gi"))) told.add(at + match[1]!.length + joined.index! + joined[0].length - joined[1]!.length);
  }
  const inQuote = (at: number) => quoted.some(([from, to]) => at >= from && at < to) || (!told.has(at) && keepsOwn(at));
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
