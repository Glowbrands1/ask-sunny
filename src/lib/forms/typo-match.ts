/**
 * ============================================================================
 * A TYPO IS READ AS THE ONE WORD IT CAN ONLY BE
 * ============================================================================
 *
 * Plain code, no model (QA, 27 Oct 2026; the same file in both apps). A typed
 * word is read as a word from a known list only when that is the only list
 * word it could be:
 *
 *   it is at least 5 letters long and starts with the same letter;
 *   it is one edit away (two for words of 9 letters or more) — an edit is a
 *   letter dropped, added, changed, or two neighbours swapped;
 *   exactly ONE list word is that close. Two at the same distance is a tie,
 *   and a tie is never guessed.
 *
 * A word that is already on the list, a list word with an ending ("noticed",
 * "mondays"), a number, or a word the caller protects (an employee's name) is
 * left as it is.
 */

/** Edits between two words, a swap of neighbours counting as one. */
export function editDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const d: number[][] = Array.from({ length: rows }, (_, i) => Array.from({ length: cols }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i]![j] = Math.min(d[i]![j]!, d[i - 2]![j - 2]! + 1);
    }
  }
  return d[a.length]![b.length]!;
}

const ENDINGS = ["s", "es", "d", "ed", "ing", "er", "ers", "ly"];

function inflects(word: string, candidate: string): boolean {
  return ENDINGS.some((ending) => word === candidate + ending || candidate === word + ending);
}

function allowed(word: string): number {
  return word.length >= 9 ? 2 : 1;
}

/** The one list word `typed` can only be, or null (not close, already a list word, or a tie). */
export function onlyMatch(typed: string, list: readonly string[], protect: (word: string) => boolean = () => false): string | null {
  const word = typed.toLowerCase();
  if (word.length < 5 || /\d/.test(word) || protect(word)) return null;
  if (list.includes(word)) return null;
  let best: string | null = null;
  let bestDistance = Infinity;
  let tied = false;
  for (const candidate of list) {
    if (candidate[0] !== word[0]) continue;
    // "noticed" is not a typo of "notice", nor "mondays" of "monday": an ending is a word, not a slip.
    if (inflects(word, candidate)) return null;
    const distance = editDistance(word, candidate);
    if (distance > allowed(candidate)) continue;
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
      tied = false;
    } else if (distance === bestDistance && candidate !== best) {
      tied = true;
    }
  }
  return best && !tied ? best : null;
}

export interface CorrectedText {
  /** The text with each typo read as its list word. */
  readonly text: string;
  /** The offset in the original text of a character in `text`. */
  readonly original: (index: number) => number;
}

/** `text` with every word that can only be one list word read as that word. */
export function correctedText(text: string, list: readonly string[], protect?: (word: string) => boolean): CorrectedText {
  const pieces: { from: number; written: string }[] = [];
  let last = 0;
  let out = "";
  const starts: number[] = [];
  for (const match of text.matchAll(/[A-Za-z]+/g)) {
    const at = match.index!;
    const gap = text.slice(last, at);
    for (let i = 0; i < gap.length; i += 1) starts.push(last + i);
    out += gap;
    const fixed = onlyMatch(match[0], list, protect);
    const written = fixed ?? match[0];
    for (let i = 0; i < written.length; i += 1) starts.push(fixed ? at + Math.min(i, match[0].length - 1) : at + i);
    out += written;
    pieces.push({ from: at, written });
    last = at + match[0].length;
  }
  const tail = text.slice(last);
  for (let i = 0; i < tail.length; i += 1) starts.push(last + i);
  out += tail;
  return {
    text: out,
    original: (index) => (index >= starts.length ? text.length : starts[index]!),
  };
}
