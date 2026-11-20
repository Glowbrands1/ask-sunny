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
/** …or this share of its nearby word pairs. */
const PAIRS_KEPT = 0.5;
/** Words this far apart (or nearer) in one sentence make a pair. */
const PAIR_WINDOW = 3;
const NEXT_HEADING = /^\s*(?:expectations?|going forward|action plan)\s*:/im;

/** Content words: numbers and times as typed, and 4+ letter words cut to 5 letters ("customers" → "custo"). */
function contentWords(text: string, skip: ReadonlySet<string>): string[] {
  const words = text.toLowerCase().match(/\d+(?:[:/.]\d+)*|[a-z][a-z'’-]{3,}/g) ?? [];
  return words.map((word) => (/^\d/.test(word) ? word : word.replace(/['’].*$/, "").slice(0, 5))).filter((word) => word.length > 0 && !skip.has(word));
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
const asSentence = (clause: string) => {
  const trimmed = clause.trim().replace(/[,;]+$/, "");
  const capital = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  return /[.!?]$/.test(capital) ? capital : `${capital}.`;
};

/** The card account's sentences (or clauses) the write-up does not hold, in the card's own words. */
export function missingAccountFacts(writeUp: string, account: string, employeeName: string | null): string[] {
  const skip = new Set(contentWords(employeeName ?? "", new Set()));
  const keptWords = new Set(contentWords(writeUp, skip));
  const keptPairs = new Set(sentencesOf(writeUp).flatMap((sentence) => pairsOf(contentWords(sentence, skip))));
  const holds = (text: string) => {
    const words = contentWords(text, skip);
    return share(words, keptWords) >= WORDS_KEPT || share(pairsOf(words), keptPairs) >= PAIRS_KEPT;
  };
  const missing: string[] = [];
  for (const sentence of sentencesOf(account)) {
    if (contentWords(sentence, skip).length < 3) continue;
    /* A sentence of several clauses is checked clause by clause: most of it kept does not keep its last fact. */
    const clauses = sentence.split(/,\s+and\s+|;\s+/).filter((clause) => contentWords(clause, skip).length >= 3);
    if (clauses.length < 2) {
      if (!holds(sentence)) missing.push(asSentence(sentence));
      continue;
    }
    for (const clause of clauses) if (!holds(clause)) missing.push(asSentence(clause));
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
