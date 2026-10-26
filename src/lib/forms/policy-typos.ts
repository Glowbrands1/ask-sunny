import { policyNameTyposEnabled } from "@/lib/config/chat-quality-flags";

/**
 * ============================================================================
 * A POLICY NAME, MISSPELLED, IS STILL THAT POLICY (POLICY_NAME_TYPOS_ENABLED)
 * ============================================================================
 *
 * QA item 8, 25 Oct 2026: "attendence" was answered "Woven does not see a
 * section for 'attendence', so I won't cite one", and "verbl warning" was not
 * read. A manager typing fast misspells the words a policy is named by.
 *
 * Each word of the text that is one slip (a letter added, dropped, changed,
 * or two swapped) from a word a policy is named by is read as that word, two
 * slips for a long word. A slip never changes the first letter, the word must
 * be four letters or more, and a real word that happens to be one slip away
 * ("warming", "herbal") is left alone. Everything else is returned exactly as
 * written. Off, the text is returned as given.
 */

/** The words managers name a policy, an offense or a warning level by. */
const VOCABULARY = [
  "attendance", "tardiness", "tardy", "absenteeism", "absence", "standards", "conduct", "opening", "harassment",
  "insubordination", "insubordinate", "acknowledgement", "acknowledgment", "acknowledgements", "acknowledgments",
  "cleaning", "sanitize", "uniform", "smoking", "verbal", "written", "warning", "corrective", "coaching",
  "violating", "violation", "violated", "disrespectful", "policy", "policies", "dress",
];

/** Real words one slip from a vocabulary word, which are not misspellings of it. */
const REAL_WORDS = new Set([
  "warming", "warping", "herbal", "verbals", "police", "polices", "opened", "openings", "cleanings", "standard",
  "conducts", "policys", "absences", "attendant", "attendants", "violent", "violets", "clearing", "cleansing",
  "opining", "uniforms", "warnings", "verbalize",
]);

const KNOWN = new Set(VOCABULARY);

/** Optimal string alignment distance, capped: insertions, deletions, substitutions, transpositions. */
function slips(a: string, b: string, cap: number): number {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  const rows: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j += 1) rows[0]![j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    let best = Infinity;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(rows[i - 1]![j]! + 1, rows[i]![j - 1]! + 1, rows[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) value = Math.min(value, rows[i - 2]![j - 2]! + 1);
      rows[i]![j] = value;
      best = Math.min(best, value);
    }
    if (best > cap) return cap + 1;
  }
  return rows[a.length]![b.length]!;
}

/** Two spellings of one word: "acknowledgement" and "acknowledgment", "violating" and "violation". */
function sameName(a: string, b: string): boolean {
  return a.slice(0, 6) === b.slice(0, 6);
}

/** The vocabulary word this word misspells, or null. */
export function policyWordFor(word: string): string | null {
  const lower = word.toLowerCase();
  if (lower.length < 4 || KNOWN.has(lower) || REAL_WORDS.has(lower) || !/^[a-z]+$/.test(lower)) return null;
  // A vocabulary word with an ending ("uniforms", "warnings", "cleaned") is not a slip.
  if (VOCABULARY.some((known) => lower.startsWith(known) && /^(?:s|es|ed|d|ing|ly)$/.test(lower.slice(known.length)))) return null;
  let found: string | null = null;
  let nearest = Infinity;
  let tied = false;
  for (const known of VOCABULARY) {
    if (known[0] !== lower[0]) continue;
    const cap = known.length >= 9 ? 2 : 1;
    const distance = slips(lower, known, cap);
    if (distance > cap) continue;
    if (distance < nearest) {
      nearest = distance;
      found = known;
      tied = false;
    } else if (distance === nearest && !sameName(found!, known)) {
      tied = true;
    }
  }
  // Two different words equally near: the slip is ambiguous, and nothing is corrected.
  return tied ? null : found;
}

/** The text with each misspelled policy word read as the word it misspells. Off, the text as given. */
export function correctPolicyTypos(text: string): string {
  if (!policyNameTyposEnabled() || !text) return text;
  return text.replace(/[A-Za-z]+/g, (word) => {
    const fixed = policyWordFor(word);
    if (!fixed) return word;
    return word === word.toUpperCase() && word.length > 1
      ? fixed.toUpperCase()
      : word[0] === word[0]!.toUpperCase()
        ? fixed[0]!.toUpperCase() + fixed.slice(1)
        : fixed;
  });
}
