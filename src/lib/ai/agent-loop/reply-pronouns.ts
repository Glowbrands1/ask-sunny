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

/*
 * Reflexives (himself, herself, themself) are never replaced (port from the sibling app, its QA's live re-run, 23 Nov 2026:
 * "did not clean up after themself" became "… after <name>", the person the object of their own action), as the saved
 * write-up never replaces them (`employee-reference.ts`).
 */
const ALWAYS = /\b(?:he|him|his|she|her|hers)\b/gi;
/** they/them in a person's place: someone told, asked, thanked; someone who quit, worked, said; "themself". */
const THEY_PERSON =
  /\b(?:tell|ask|let|remind|give|call|text|email|meet|thank|inform|notify|pay|schedule|fire|terminate|coach)\s+them\b|\bthey(?:'re|'ve|'ll|'d)?\s+(?:were|are|was|is|have|had|will|would|quit|resigned|left|worked|said|did|can|should|need|gave|told|missed|came)\b/gi;
/** A verb that reports what someone asked, said or wrote (in Sunny's reply): the clause after it is reported speech. */
const REPORTING = /\b(?:asked|asking|told|telling|said|saying|stated|stating|reminded|reminding|messaged|messaging|texted|texting|emailed|wrote|writing|replied|replying|explained|explaining|claimed|claiming|admitted|admitting|wanted\s+to\s+know)\b/;
/** Words that make "they/them" the form's fields or the card, when they come before it in the sentence. */
const FIELD_WORDS = /\b(?:fields?|blanks?|boxes?|lines?|details|answers?|dates?|values?|sections?|items?|questions?)\b/i;
/** "their <person word>": the person's own things. */
const THEIR_PERSON = /\btheir(?=\s+(?:\w+\s+)?(?:last\s+day|shift|shifts|manager|notice|job|title|position|schedule|salon|store|rehire|employment|paycheck|keys|conduct|termination|resignation|hours|role|start|end|card|form)\b)/gi;
/** After "her", a word that is not the thing she owns: "for her and", "tell her that", "her." (object, not possessive). */
const NOT_OWNED = /^\s+(?:to|and|or|that|a|an|the|about|if|so|now|yet|on|in|at|for|with|again|know|too|as|is|was|when|before|after|by|from|this|these|those|it)\b/i;

/**
 * "have her practice the call-in process" (the owner's live check, 28 Nov 2026: it read "have <P>'s practice"): "her" after
 * have / let / make / help, whose next word is followed by an object, is the person doing it, not what they own. "have
 * her shift covered" and "help her team during …" still own something.
 */
const CAUSATIVE_BEFORE = /\b(?:have|has|had|having|let|lets|letting|make|makes|made|making|help|helps|helped|helping)[ \t]+$/i;
const OBJECT_AFTER_NEXT = /^[ \t]+[a-z]+[ \t]+(?:the|a|an|this|that|these|those|it|them|him|me|you|us|what|how|his|their|your|my|each|every|some|any)\b/i;

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

/** A pronoun's person: she/her/hers/herself, he/him/his/himself, or they/them/their/theirs/themself. Null for any other word. */
function pronounKind(word: string): "she" | "he" | "they" | null {
  const lower = word.toLowerCase();
  if (/^(?:she|her|hers|herself)$/.test(lower)) return "she";
  if (/^(?:he|him|his|himself)$/.test(lower)) return "he";
  if (/^(?:they|them|their|theirs|themself|themselves)$/.test(lower)) return "they";
  return null;
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
 * ============================================================================
 * TWO PEOPLE OF ONE PRONOUN KIND (port of Ask Bubbles #1053, db7201b1; its QA, 22 Nov 2026, production; people invented)
 * ============================================================================
 *
 * The manager wrote about <A> (she) and a coworker <B> (she) who was giving <A> an attitude; the write-up said "<A> was
 * giving <A> an attitude". The pronoun-kind check (below) covers only another person of a DIFFERENT kind. Here, from the sentence's
 * own structure and the names in the manager's words and the text, never a list of phrasings:
 *
 * - Each named person's kind is read from the subject pronouns (she / he) in the MANAGER'S words whose nearest named
 *   person before them is that person ("<B> was on register. she was giving her …": <B> is "she").
 * - A she/he pronoun whose nearest named person of its kind before it is another person is that person's, and stays as
 *   written. The card's person is a candidate unless their own kind is known and is not this pronoun's.
 * - An object pronoun (her, him; not "her" owning something) is never the person named in its own clause ("<A> cussed
 *   at her": "her" is not <A>), so that person is passed over.
 * - A subject pronoun gives no kind when another pronoun stands between it and the name ("<L> told her … and she
 *   refused": "she" may continue "her").
 * - When nothing settles it (nobody of its kind named before it, as when Create's write-up opens with that sentence),
 *   it is left as the manager wrote it.
 *
 * Only when another person named has a known kind equal to the pronoun's: a write-up about one person, or a pronoun of
 * a kind no other person has, reads exactly as before. Returns: true when the pronoun at `at` is left as written.
 */
function sameKindOther(text: string, display: string, others: readonly string[], managerWords: string, personKind: "she" | "he" | null): (at: number) => boolean {
  const escape = (word: string) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const keysOf = (name: string) => {
    const full = name.trim().toLowerCase().replace(/\s+/g, " ");
    return [...new Set([full, full.split(" ")[0] ?? ""])].filter((key) => key.length >= 2);
  };
  const ownKeys = new Set(keysOf(display));
  /* Person 0 is the card's person; the others follow, each with the keys that are not also the card's person's. */
  const people = [[...ownKeys], ...others.map((other) => keysOf(other).filter((key) => !ownKeys.has(key)))]
    .map((keys, index) => ({ index, keys }))
    .filter((person) => person.index === 0 || person.keys.length > 0);
  if (people.length < 2) return () => false;
  const mentionsIn = (words: string) => {
    const found: Array<{ person: number; at: number; end: number }> = [];
    for (const person of people) {
      for (const key of person.keys) {
        for (const match of words.matchAll(new RegExp(`(?<![\\p{L}'-])${escape(key)}(?![\\p{L}-])`, "giu"))) found.push({ person: person.index, at: match.index!, end: match.index! + match[0].length });
      }
    }
    return found.sort((a, b) => a.at - b.at);
  };
  /*
   * Each person's kinds: the subject pronouns in the MANAGER'S words whose nearest named person before them is that
   * person (never the text being rewritten, whose pronouns are the question).
   */
  const kinds = new Map<number, Set<"she" | "he">>();
  const spokenNames = mentionsIn(managerWords);
  for (const subject of managerWords.matchAll(/\b(she|he)\b/gi)) {
    const nearest = spokenNames.filter((mention) => mention.end <= subject.index!).at(-1);
    /* Another pronoun between them ("<L> told her to go home and she refused") may be whom it continues: no kind read. */
    if (!nearest || /\b(?:he|him|his|she|her|hers|they|them|their)\b/i.test(managerWords.slice(nearest.end, subject.index!))) continue;
    kinds.set(nearest.person, new Set([...(kinds.get(nearest.person) ?? []), subject[1]!.toLowerCase() as "she" | "he"]));
  }
  if (personKind) kinds.set(0, new Set([...(kinds.get(0) ?? []), personKind]));
  const mentions = mentionsIn(text);
  return (at: number) => {
    const word = text.slice(at).match(/^\p{L}+/u)?.[0] ?? "";
    const kind = pronounKind(word);
    if (kind !== "she" && kind !== "he") return false;
    if (!people.some((person) => person.index !== 0 && kinds.get(person.index)?.has(kind))) return false;
    const ownKinds = kinds.get(0);
    const ownCandidate = !ownKinds || ownKinds.size === 0 || ownKinds.has(kind);
    const lower = word.toLowerCase();
    const after = text.slice(at + word.length);
    const object = lower === "him" || (lower === "her" && !(/^\s+[A-Za-z0-9$]/.test(after) && !NOT_OWNED.test(after)));
    const clauseStart = object ? Math.max(-1, ...[...text.slice(0, at).matchAll(/[,;:.!?\n]/g)].map((stop) => stop.index!)) : -1;
    const nearest = mentions
      .filter((mention) => mention.end <= at && (mention.person === 0 ? ownCandidate : kinds.get(mention.person)?.has(kind)))
      .filter((mention) => !(object && mention.at > clauseStart))
      .at(-1);
    /* Nobody of its kind named before it (the saved write-up can open with it): not settled, so left as written. */
    return nearest ? nearest.person !== 0 : true;
  };
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
      /*
       * QA's round 2 (22 Nov 2026, U23; port of Ask Bubbles #1014): "she asked another employee what they would do if they
       * had 8 arms" became "<P> asked another employee what <P> would do …". A pronoun of another kind than its reporter's
       * ("they" in a clause "she" reports, "he" in one "she" reports) is someone else, and stays as written.
       */
      const reporterKind = pronounKind(reporterPronouns.at(-1)![0]);
      const ownKind = pronounKind(reply.slice(at).match(/^\p{L}+/u)?.[0] ?? "");
      if (reporterKind !== null && ownKind !== null && reporterKind !== ownKind) return "untrusted";
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
    /*
     * The teller is the subject right before the verb, an appositive between commas set aside ("<A>'s shift lead, <L>,
     * told her"). It need not be a known name: QA's live retest (conv_mwp5inao2y4s849) named the lead in an earlier turn,
     * off the roster, and "Test's shift lead" was read as Test telling. The card's person telling someone else ("Tamsin
     * told her to …") and a pronoun telling ("She told her to …") are not this; a possessive ("Test's") never tells.
     */
    const subject = before.replace(/[\s*_]+$/, "").replace(/,[^,]*,$/, "").replace(/[\s*_:]+$/, "");
    // The card's person as the subject: their reply name, alone or with a surname after it ("Test told", "Test Testy told").
    const own = display.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const ownTells = new RegExp(`(?:^|[^\\p{L}'-])${own}(?:\\s+\\p{L}+)?$`, "u").test(subject);
    if (!subject || ownTells || /(?:^|[^\p{L}'-])(?:he|she|they|i|you|we)$/u.test(subject)) continue;
    told.add(at);
    const listener = { him: "he", her: "she", them: "they" }[match[1]!.toLowerCase() as "him" | "her" | "them"];
    const rest = reply.slice(at + match[1]!.length);
    const end = rest.search(/[.?!](?!\d)|\n/);
    const sentence = end === -1 ? rest : rest.slice(0, end);
    for (const joined of sentence.matchAll(new RegExp(`\\b(?:and|but|so|then)\\s+(${listener})\\b`, "gi"))) told.add(at + match[1]!.length + joined.index! + joined[0].length - joined[1]!.length);
  }
  /*
   * Port of Ask Bubbles #1041 (its QA's live round-2 re-run, 22 Nov 2026, U23) with #1053 (round 3, U23: the saved
   * Observation): "<P> asked another employee what they would do if they had 8 arms" became "what <P> would do if <P> had".
   * The person's own pronoun is the one the manager uses for people in their words: when they use only "she" forms (or
   * only "he" forms), a pronoun of another kind (they/them/their, or the other one) is someone else, wherever it stands.
   * Unknown (both, or neither, or no manager words) keeps the reading above. Grammar from the manager's own words, never a
   * list of phrasings. Create's pass reads the same words (`first-name-write-up.ts`), so the card and the saved form agree.
   */
  const spoken = (managerWords ?? "").toLowerCase();
  const usesShe = /\b(?:she|her|hers|herself)\b/.test(spoken);
  const usesHe = /\b(?:he|him|his|himself)\b/.test(spoken);
  const personKind: "she" | "he" | null = usesShe && !usesHe ? "she" : usesHe && !usesShe ? "he" : null;
  const anotherKind = (word: string) => {
    const kind = pronounKind(word);
    return personKind !== null && kind !== null && kind !== personKind;
  };
  const othersOwn = sameKindOther(reply, display, others, managerWords ?? "", personKind);
  /*
   * Sunny's port: a pronoun inside a reported clause keeps the reported-speech reading above (Pau's ruling; c090, c247:
   * "<P> messaged <SD>, <B> via Woven stating she quit" is <P>'s "she"). The same-kind reading decides only outside one.
   */
  const othersOwnUnreported = (at: number) => reportedBy(at) === null && othersOwn(at);
  const inQuote = (at: number) =>
    quoted.some(([from, to]) => at >= from && at < to) ||
    (!told.has(at) && (keepsOwn(at) || othersOwnUnreported(at))) ||
    anotherKind(reply.slice(at).match(/^\p{L}+/u)?.[0] ?? "");
  const edits: Array<{ from: number; to: number; text: string }> = [];

  /*
   * QA (20 Nov 2026, item 19; the production audit): "<P> did not come into <P>'s scheduled shift today" reads clumsily.
   * The person's second mention in one sentence (the name already written, or an earlier pronoun of theirs replaced) is
   * not the name again: a possessive right after a preposition is "the" ("did not come into the scheduled shift"; one
   * elsewhere, "said her car broke down", keeps its owner as the name), and a subject after "and",
   * "but", "or" or "then" is dropped ("came in late and left early"). The first mention is the name, as before, and no
   * pronoun is ever kept.
   */
  const nameInSentence = nameRe(display.toLowerCase(), "iu");
  const mentionedBefore = (at: number) => {
    const before = sentenceBefore(reply, at);
    const sentenceStart = at - before.length;
    return nameInSentence.test(before) || edits.some((edit) => edit.from >= sentenceStart && edit.from < at);
  };
  for (const match of reply.matchAll(ALWAYS)) {
    const at = match.index!;
    if (inQuote(at)) continue;
    const word = match[0].toLowerCase();
    const end = at + match[0].length;
    const doerAfterCausative = word === "her" && CAUSATIVE_BEFORE.test(reply.slice(Math.max(0, at - 12), at)) && OBJECT_AFTER_NEXT.test(reply.slice(end));
    const owns = word === "his" || word === "hers" || (word === "her" && !doerAfterCausative && /^\s+[A-Za-z0-9$]/.test(reply.slice(end)) && !NOT_OWNED.test(reply.slice(end)));
    const again = mentionedBefore(at);
    // Only after a place or time preposition ("into her scheduled shift"): "Remy said her car broke down" keeps the owner.
    const afterPreposition = /\b(?:into|for|to|on|at|during|from|before|after|in)[ \t]+$/i.test(reply.slice(Math.max(0, at - 10), at));
    /*
     * QA2's live R3 (21 Nov 2026): "Test came into the salon to show her team her new puppy" was replied as "to show Test's
     * team Test's new puppy", while the saved write-up read "to show the team the new puppy". Outside reported speech
     * (no reporting verb in the clause before it), a possessive of the person already named in the sentence is "the", as
     * the saved write-up writes it (`nameInsteadOfPronouns`). "Remy said her car broke down" keeps its owner, as before.
     */
    const clauseBefore = sentenceBefore(reply, at).split(/[,;:]/).at(-1) ?? "";
    const notReported = !REPORTING.test(clauseBefore.toLowerCase());
    /* Only an object ("show her team", "team her new puppy"): never one opening a clause ("and her shift …") or after "with"/"of". */
    const opensClause = clauseBefore.trim() === "" || /\b(?:and|but|or|so|then|with|of)[ \t]+$/i.test(clauseBefore);
    /*
     * Port of Ask Bubbles #1075 (9ce649e; QA's ruling, 22 Nov 2026, Pau's round 3 U23: "her personal life" became "the
     * personal life"): the first possessive of the person already named keeps its owner ("<Name>'s"); "the" only after a
     * place or time preposition (item 19: the closed set just above) or once this sentence already said whose ("show
     * <P>'s team the new puppy"). QA's ruling (B): this is the chat's card and reply only; the saved write-up keeps HR's
     * design (`employee-reference.ts`, 3 Oct 2026), so the two may now differ on a possessive, by design.
     */
    const sentenceStart = at - sentenceBefore(reply, at).length;
    const ownerSaid = new RegExp(`${possessive(display).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}])`, "iu").test(sentenceBefore(reply, at)) || edits.some((edit) => edit.from >= sentenceStart && edit.from < at && edit.text === possessive(display));
    if (again && owns && word !== "hers" && (afterPreposition || (ownerSaid && notReported && !opensClause))) {
      edits.push({ from: at, to: end, text: match[0][0] === match[0][0]!.toUpperCase() ? "The" : "the" });
      continue;
    }
    const joined = /\b(?:and|but|or|then)[ \t]+$/i.exec(reply.slice(Math.max(0, at - 8), at));
    /*
     * Dropped only when the person is the subject the sentence opens with ("Remy came in late and she left early"). The
     * listener of someone else's instruction ("Corin told her to clock out early and she refused", #1147's f059) is named,
     * never dropped: the joined clause's subject would read as the teller's.
     */
    const lead = sentenceBefore(reply, at).replace(/^\s*(?:\*\*[^*]*\*\*\s*)?(?:[A-Z][\w ]{0,40}:\s+)?/, "");
    const firstWord = (display.split(/\s+/)[0] ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const opensWithPerson = new RegExp(`^(?:${firstWord}|she|he)\\b`, "iu").test(lead);
    if (again && !told.has(at) && opensWithPerson && (word === "she" || word === "he") && joined && /^\s+[a-z]/.test(reply.slice(end))) {
      edits.push({ from: at, to: end + (/^[ \t]/.test(reply.slice(end)) ? 1 : 0), text: "" });
      continue;
    }
    /*
     * QA2's live R3 (21 Nov 2026, #1168's case): "Her shift lead told her to go home and she refused" read "Test's shift
     * lead, <J>, told Test to go home and Test refused". The told listener later in this sentence is named (f059), so a
     * possessive before it, at the sentence's first mention, is the plain article: "The shift lead … told Remy …".
     */
    if (owns && word !== "hers" && !again) {
      const rest = reply.slice(end);
      const stop = rest.search(/[.?!](?!\d)|\n/);
      const sentenceEnd = end + (stop === -1 ? rest.length : stop);
      if ([...told].some((listener) => listener > at && listener < sentenceEnd)) {
        edits.push({ from: at, to: end, text: match[0][0] === match[0][0]!.toUpperCase() ? "The" : "the" });
        continue;
      }
    }
    // "her shift", "her 146 tans", "her own" own something; "for her.", "with her and", "talked to her" do not.
    const text = owns ? possessive(display) : display;
    edits.push({ from: at, to: end, text });
  }
  for (const match of reply.matchAll(THEY_PERSON)) {
    const at = match.index!;
    if (inQuote(at) || FIELD_WORDS.test(sentenceBefore(reply, at))) continue;
    const phrase = match[0];
    const pronoun = /\bthem\b/i.exec(phrase) ?? /\bthey\b/i.exec(phrase) ?? /\bthemsel(?:f|ves)\b/i.exec(phrase);
    if (!pronoun || anotherKind(pronoun[0])) continue;
    const from = at + pronoun.index;
    const to = from + pronoun[0].length;
    if (/^they$/i.test(pronoun[0])) {
      const tail = phrase.slice(pronoun.index + pronoun[0].length);
      edits.push({ from, to: at + phrase.length, text: display + singularAfterThey(tail) });
    } else edits.push({ from, to, text: display });
  }
  for (const match of reply.matchAll(THEIR_PERSON)) {
    const at = match.index!;
    if (inQuote(at) || anotherKind(match[0].match(/\p{L}+/u)?.[0] ?? "") || FIELD_WORDS.test(sentenceBefore(reply, at))) continue;
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
