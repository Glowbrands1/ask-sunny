/*
 * ============================================================================
 * A CLOSE SENTENCE IS THE SAME SENTENCE (ACCOUNT_REPLACED_CLOSE_SENTENCE_KEPT_ENABLED)
 * ============================================================================
 *
 * QA, 13 Nov 2026 (follow-up to ACCOUNT_CHANGE_REDERIVES_POLICY): `accountReplaced` (form-patch-turn.ts) counts an old
 * sentence as kept only when a new sentence still holds it word for word, so a typo or date fix ("the whole shfit" →
 * "the whole shift", "October 20" → "October 21") read as a new account and re-derived the policy: a Corrective Action
 * drafted on the Attendance policy moved to Cell Phone on a one-letter fix. A close sentence is the same sentence:
 *   - the same letters once spaces are dropped ("th e10 minute" → "the 10 minute"); or
 *   - at most two words differ on each side, and each differing word pairs with one on the other side that is a date
 *     word (a number, a month or a weekday) on both sides, a pronoun or article on both sides (the saved Observation
 *     says "on the cell phone" where the manager retypes "on her cell phone"), or the same word misspelled (one or two
 *     letters off, a swap counting once).
 * A changed or added word that is neither ("late" → "on her phone") is a new sentence, as before.
 */

const MONTHS = /^(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)$/;
const WEEKDAYS = /^(?:mon|tues?|wed(?:nes)?|thu(?:rs?)?|fri|sat(?:ur)?|sun)(?:day)?$/;
const MAX_DIFFERING = 2;
const PRONOUNS_AND_ARTICLES = new Set(["the", "a", "an", "her", "his", "their", "she", "he", "they", "him", "them", "this", "that"]);

function dateWord(word: string): boolean {
  return /^\d+(?:st|nd|rd|th)?$/.test(word) || MONTHS.test(word) || WEEKDAYS.test(word);
}

/** Optimal string alignment distance: insertions, deletions, substitutions and adjacent swaps each count one. */
function editDistance(a: string, b: string): number {
  const rows: number[][] = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let best = Math.min(rows[i - 1]![j]! + 1, rows[i]![j - 1]! + 1, rows[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) best = Math.min(best, rows[i - 2]![j - 2]! + 1);
      rows[i]![j] = best;
    }
  }
  return rows[a.length]![b.length]!;
}

function misspelled(a: string, b: string): boolean {
  if (dateWord(a) || dateWord(b)) return false;
  const longer = Math.max(a.length, b.length);
  if (longer < 4) return false;
  return editDistance(a, b) <= (longer >= 7 ? 2 : 1);
}

function pairs(a: string, b: string): boolean {
  return (dateWord(a) && dateWord(b)) || (PRONOUNS_AND_ARTICLES.has(a) && PRONOUNS_AND_ARTICLES.has(b)) || misspelled(a, b);
}

/** What is left of `words` once each word of `other` has taken one copy of itself away. */
function leftOver(words: readonly string[], other: readonly string[]): string[] {
  const pool = [...other];
  const left: string[] = [];
  for (const word of words) {
    const at = pool.indexOf(word);
    if (at >= 0) pool.splice(at, 1);
    else left.push(word);
  }
  return left;
}

/** Every word in `from` takes a distinct partner in `to` (both lists are short: at most MAX_DIFFERING). */
function allPaired(from: readonly string[], to: readonly string[]): boolean {
  if (from.length === 0) return to.length === 0;
  const [first, ...rest] = from;
  return to.some((candidate, index) => pairs(first!, candidate) && allPaired(rest, [...to.slice(0, index), ...to.slice(index + 1)]));
}

/**
 * Two sentences, each already lowercased with its punctuation turned to single spaces (as `accountReplaced` reads
 * them), are the same sentence with a typo or a date changed.
 */
export function closeSentence(before: string, after: string): boolean {
  if (before === after) return true;
  if (before.replace(/\s+/g, "") === after.replace(/\s+/g, "")) return true;
  const a = before.split(/\s+/).filter(Boolean);
  const b = after.split(/\s+/).filter(Boolean);
  const leftA = leftOver(a, b);
  const leftB = leftOver(b, a);
  if (leftA.length > MAX_DIFFERING || leftB.length > MAX_DIFFERING || leftA.length !== leftB.length) return false;
  return allPaired(leftA, leftB);
}
