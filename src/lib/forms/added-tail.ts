/**
 * ADD_NOT_REPEATED_ENABLED (ported from Ask Bubbles: QA's live round 15 there, 10 Nov 2026): after "make it about being late on 11/5/26", "add
 * that she was reminded of the policy" saved Details of Coaching with the whole Observed/Expectation/Going Forward block
 * TWICE, then the new line. The reader returned the field's whole text (run onto one line) and the new sentence, as an
 * "add": it did not read as the field's own text, so all of it was added after the old text.
 *
 * An "add" that repeats the field's text word for word (line breaks, spacing and punctuation aside) adds only what comes
 * after it. Null when the value does not start with the field's text, or adds nothing. Pure.
 */
const WORD = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu;

function words(text: string): string[] {
  return (text.match(WORD) ?? []).map((word) => word.toLowerCase());
}

export function addedTail(old: string, value: string): string | null {
  const before = words(old);
  if (before.length === 0) return null;
  const found = [...value.matchAll(WORD)];
  if (found.length <= before.length) return null;
  for (let index = 0; index < before.length; index += 1) {
    if (found[index]![0].toLowerCase() !== before[index]) return null;
  }
  const last = found[before.length - 1]!;
  const tail = value.slice(last.index! + last[0].length).replace(/^[\s.,;:!?)\]"'’]+/u, "").trim();
  return tail === "" ? null : tail;
}
