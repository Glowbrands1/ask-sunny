/**
 * ============================================================================
 * EVERY FACT ON THE CARD'S ACCOUNT STAYS IN THE SAVED OBSERVATION (QA's live test of #1121, 20 Nov 2026; f061)
 * ============================================================================
 *
 * A 351-word late-opening account was saved without "This is the third time in two months that <P> has opened late" and
 * "one customer said she would not come back …": the drafter shortened the account and lost two facts. A loop card's
 * account (`what_happened`, the manager's own words as the card showed them) is the record of what the manager said.
 * After drafting, each of its sentences must be in the Observed part of the write-up:
 *   - a sentence is kept when nearly all its content words are there (WORDS_KEPT), or at least half its nearby word
 *     pairs are (PAIRS_KEPT; unordered within a few words, so "refunds on their memberships" and "membership refunds"
 *     agree). Words alone are not enough in a long account: "one customer said she would not come back" shares most
 *     of its words with other sentences ("would", "back", "waiting outside") by chance;
 *   - a sentence of coordinate clauses (", and" / "; ") is checked clause by clause, and each missing clause is added;
 *   - a sentence that does not split is added whole.
 * What is added is the card's own words, at the end of the Observed part (before "Expectation:"), never invented.
 * This compares the card's record with the app's own drafted text: no word list reads the manager's messages. Pure.
 */

/** A sentence or clause is kept when the write-up holds this share of its content words… */
const WORDS_KEPT = 0.85;
/** …or this share of its nearby word pairs… */
const PAIRS_KEPT = 0.5;
/**
 * …or one written sentence holds this share of its content words (QA, f083: "A customer stated they would not return because
 * nobody was at the desk" already holds "a customer said they won't come back because nobody was at the desk").
 */
const ONE_SENTENCE_KEPT = 0.6;
/**
 * …or (QA2's Sunny live R3, 21 Nov 2026) it lists two or more dates, each stated in a written sentence that shares one of
 * its other words, and at most this many of its other words are nowhere in the write-up. "<First> was late on the last
 * two shifts, 11/17 and 11/18" is held by "<First> was late to work on November 17, 2026. <First> was late to work on
 * November 18, 2026."; a reason the drafter left out ("because his car broke down") is more words than this, and added.
 */
const DATE_LIST_UNHELD = 2;
const MONTH_DAY = /^\d{1,2}\/\d{1,2}$/;
/** Words this far apart (or nearer) in one sentence make a pair. */
const PAIR_WINDOW = 3;
const NEXT_HEADING = /^\s*(?:expectations?|going forward|action plan)\s*:/im;

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
/** "November 18, 2026", "Nov 18" and "11/18/2026" all read as "11/18", so a date written out is the same date. */
function sameDates(text: string): string {
  return text
    .replace(new RegExp(`\\b(${MONTHS.map((month) => `${month.slice(0, 3)}(?:${month.slice(3)})?\\.?`).join("|")})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?\\b`, "gi"), (_match, month: string, day: string) => `${MONTHS.findIndex((name) => name.startsWith(month.toLowerCase().slice(0, 3))) + 1}/${Number(day)}`)
    .replace(/\b(\d{1,2})\/(\d{1,2})\/\d{2,4}\b/g, (_match, month: string, day: string) => `${Number(month)}/${Number(day)}`)
    /*
     * Port from the sibling app (its QA's live re-test of the loop, 21 Nov 2026, A2–A5): the manager's dashed "10-20-26"
     * is the drafter's "October 20, 2026" too. Unread, every sentence holding one looked missing and was added again in
     * the manager's words ("… on October 20, 2026. … on 10-20-26."), and a clause that is only a date was tacked on alone
     * ("On 10-20-26."). With its year only: a bare "10-12" is more often a range ("10-12 hours").
     */
    .replace(/(?<![\d/-])(\d{1,2})-(\d{1,2})-(?:\d{4}|\d{2})(?![\d-])/g, (_match, month: string, day: string) => `${Number(month)}/${Number(day)}`);
}

/** Content words: numbers and times as typed, and 4+ letter words cut to 5 letters ("customers" → "custo"). */
function contentWords(text: string, skip: ReadonlySet<string>): string[] {
  const words = sameDates(text).toLowerCase().match(/\d+(?:[:/.]\d+)*|[a-z][a-z'’-]{3,}/g) ?? [];
  /* A contraction's stem under four letters ("won't" → "won") is no content word, like any short word. */
  return words.map((word) => (/^\d/.test(word) ? word : word.replace(/['’].*$/, "").slice(0, 5))).filter((word) => (/^\d/.test(word) || word.length >= 4) && !skip.has(word));
}

function share(items: readonly string[], kept: ReadonlySet<string>): number {
  return items.length === 0 ? 1 : items.filter((item) => kept.has(item)).length / items.length;
}

/** Unordered pairs of content words at most PAIR_WINDOW apart, within one sentence. */
function pairsOf(words: readonly string[]): string[] {
  const pairs: string[] = [];
  for (let at = 0; at < words.length; at += 1) {
    for (let next = at + 1; next <= at + PAIR_WINDOW && next < words.length; next += 1) {
      if (words[at] !== words[next]) pairs.push([words[at], words[next]].sort().join("+"));
    }
  }
  return pairs;
}

const sentencesOf = (text: string) => text.split(/(?<=[.!?])\s+(?=[A-Z0-9"“])/).map((sentence) => sentence.trim()).filter(Boolean);
/*
 * QA (f083): a clause that opens with the manager's pronoun opens with the person's first name, in the form's voice
 * ("She left early …" → "<First> left early …"). Only the clause's first word; the rest is the card's words.
 */
/** A clause with its own finite verb is a sentence already ("the doors were not unlocked"); grammar, not meaning. */
const FINITE = /\b(?:is|are|was|were|has|have|had|did|does|do|will|would|can|could|said|says)\b/i;

const asSentence = (clause: string, first: string | null = null, afterComma = false) => {
  /*
   * QA2 (21 Nov 2026, the f083 follow-up): a clause that is no sentence on its own reads as one in the form's voice. A noun
   * phrase set after a comma ("the third time in two months") is "This is the third time in two months."; a "which …"
   * clause is "This …". Only these two openings; everything else is the card's words.
   */
  const phrase = afterComma && !FINITE.test(clause);
  const own = clause
    .trim()
    .replace(/^(?:the|a|an)\b/i, (article) => (phrase ? `This is ${article.toLowerCase()}` : article))
    .replace(/^which\b/i, "This");
  const trimmed = own.replace(/[,;]+$/, "").replace(/^(?:she|he)\b/i, (pronoun) => first ?? pronoun);
  const capital = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  return /[.!?]$/.test(capital) ? capital : `${capital}.`;
};

/** The card account's sentences (or clauses) the write-up does not hold, in the card's own words. */
export function missingAccountFacts(writeUp: string, account: string, employeeName: string | null): string[] {
  const skip = new Set(contentWords(employeeName ?? "", new Set()));
  const keptWords = new Set(contentWords(writeUp, skip));
  const keptPairs = new Set(sentencesOf(writeUp).flatMap((sentence) => pairsOf(contentWords(sentence, skip))));
  const writtenSentences = sentencesOf(writeUp).map((sentence) => new Set(contentWords(sentence, skip)));
  const datesStatedOneByOne = (words: readonly string[]) => {
    const dates = [...new Set(words.filter((word) => MONTH_DAY.test(word)))];
    const others = words.filter((word) => !MONTH_DAY.test(word));
    if (dates.length < 2 || others.length === 0) return false;
    return dates.every((date) => writtenSentences.some((written) => written.has(date) && others.some((word) => written.has(word)))) && others.filter((word) => !keptWords.has(word)).length <= DATE_LIST_UNHELD;
  };
  const holds = (text: string) => {
    const words = contentWords(text, skip);
    return (
      share(words, keptWords) >= WORDS_KEPT ||
      share(pairsOf(words), keptPairs) >= PAIRS_KEPT ||
      writtenSentences.some((written) => share(words, written) >= ONE_SENTENCE_KEPT) ||
      datesStatedOneByOne(words)
    );
  };
  const first = (employeeName ?? "").trim().split(/\s+/)[0] || null;
  const missing: string[] = [];
  for (const sentence of sentencesOf(account)) {
    if (contentWords(sentence, skip).length < 3) continue;
    /* A sentence of several clauses is checked clause by clause: most of it kept does not keep its last fact. */
    /*
     * Clauses: at ", and" and ";", and (QA, f083) at a comma that starts a new clause ("…late on 11/18, this is the third
     * time in two months"): only the missing clause is added, never the sentence around it again.
     */
    /* QA2 (the f083 follow-up): also at any comma with a fact on each side ("…late on 11/18, the third time in two months"). */
    const parts = sentence.split(/,\s+and\s+|;\s+|,\s+/i);
    const clauses = parts.every((part) => contentWords(part, skip).length >= 3) ? parts : sentence.split(/,\s+and\s+|;\s+|,\s+(?=(?:this|that|it|she|he|they|there|i|we)\b)/i).filter((clause) => contentWords(clause, skip).length >= 3);
    if (clauses.length < 2) {
      if (!holds(sentence)) missing.push(asSentence(sentence, first));
      continue;
    }
    clauses.forEach((clause, at) => {
      if (!holds(clause)) missing.push(asSentence(clause, first, at > 0));
    });
  }
  return missing;
}

/** The write-up with every missing fact of the card's account added at the end of its Observed part. */
export function withAccountFactsKept(writeUp: string, account: string, employeeName: string | null): { text: string; added: string[] } {
  if (writeUp.trim() === "" || account.trim() === "") return { text: writeUp, added: [] };
  const heading = NEXT_HEADING.exec(writeUp);
  const observed = heading ? writeUp.slice(0, heading.index) : writeUp;
  const added = missingAccountFacts(observed, account, employeeName);
  if (added.length === 0) return { text: writeUp, added };
  const rest = heading ? writeUp.slice(heading.index) : "";
  const body = `${observed.trimEnd()} ${added.join(" ")}`;
  return { text: rest ? `${body}\n\n${rest.trimStart()}` : body, added };
}
