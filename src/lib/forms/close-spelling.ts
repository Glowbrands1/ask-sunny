/**
 * CLOSE_SPELLING_MATCH_ENABLED (Pau, via QA, 13 Nov 2026): the manager's words
 * are matched against the app's own lists (policy headings, salons) by close
 * spelling, not only exact spelling: "Care and Clening" is "Care and Cleaning".
 *
 * Only the distance between two words is measured here. Each list decides what
 * a confident match is, and a match that is not confident is asked about
 * ("Did you mean …?"), never taken. Pure.
 */

/**
 * The number of single-letter edits (insert, delete, change, or swap of two
 * neighbours) between two words, or `limit + 1` once it is past `limit`.
 */
export function editDistance(a: string, b: string, limit = 2): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let before: number[] = [];
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    let best = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) value = Math.min(value, before[j - 2]! + 1);
      current.push(value);
      best = Math.min(best, value);
    }
    if (best > limit) return limit + 1;
    before = previous;
    previous = current;
  }
  return Math.min(previous[b.length]!, limit + 1);
}

/**
 * How far a word the manager typed is from a word on the list: 1 for one
 * letter off in a word of five letters or more ("clening" / "cleaning"), 2 for
 * two letters off in a word of eight or more, otherwise null (not close). A
 * short word is never read as another: "dres" is not "dress", "cash" is not
 * "cast".
 */
export function closeWordDistance(said: string, listed: string): 1 | 2 | null {
  const shorter = Math.min(said.length, listed.length);
  if (shorter < 5) return null;
  const distance = editDistance(said, listed, 2);
  if (distance === 1) return 1;
  if (distance === 2 && shorter >= 8) return 2;
  return null;
}
