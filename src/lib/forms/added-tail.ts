/**
 * ADD_NOT_REPEATED_ENABLED (ported from Ask Bubbles: QA's live round 15 there, 10 Nov 2026): after "make it about being late on 11/5/26", "add
 * that she was reminded of the policy" saved Details of Coaching with the whole Observed/Expectation/Going Forward block
 * TWICE, then the new line. The reader returned the field's whole text (run onto one line) and the new sentence, as an
 * "add": it did not read as the field's own text, so all of it was added after the old text.
 *
 * An "add" that repeats the field's text word for word (line breaks, spacing and punctuation aside) adds only what comes
 * after it; with `sentences` (ADD_NOT_REPEATED_SENTENCES_ENABLED), so does one whose leading sentences the field already
 * holds (`afterKnownSentences`). Null when neither, or
 * when it adds nothing. Pure.
 */
const WORD = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu;

function words(text: string): string[] {
  return (text.match(WORD) ?? []).map((word) => word.toLowerCase());
}

/**
 * Ported from Ask Bubbles (QA's live r15b there, 10 Nov 2026, 08:36Z): the reader's add repeated only the field's FIRST sentence, with its heading
 * ("Observed: … was late to work on October 23, 2026. … was also on her phone."), so it was not a repeat of the whole field
 * and the late sentence was saved twice. The add's leading sentences (and headings) that the field already holds, word for
 * word, are dropped too: at least one whole sentence of three words or more, and something must remain.
 */
function afterKnownSentences(old: string, value: string): string | null {
  const known = ` ${words(old).join(" ")} `;
  const found = [...value.matchAll(WORD)];
  /*
   * QA's gate (10 Nov 2026, nov7-refusal-bub-phone-trace; this app's #768): the reader returned the WHOLE field with the new line inserted
   * inside it ("Observed: … deadline. / Also observed: … / Expectation: / …"). That is the field as it should read, and the
   * path without this rule saves it so. Dropping only its leading sentences added the rest, the old Expectation with it, a
   * second time. An add that holds every word of the field, in order, around one insertion is left as it is.
   */
  if (holdsFieldAroundInsertion(words(old), found.map((match) => match[0].toLowerCase()))) return null;

  let start = 0;
  let kept = -1;
  let sentence = false;
  for (let index = 0; index < found.length; index += 1) {
    const match = found[index]!;
    const next = found[index + 1];
    const gap = value.slice(match.index! + match[0].length, next ? next.index : value.length);
    // A sentence, a heading or a line ends after this word ("…2026. ", "Observed: ", a line break, the end).
    if (next && !/[.!?:]\s|\n/.test(gap) && !/[.!?:]$/.test(gap)) continue;
    const unit = found.slice(start, index + 1).map((word) => word[0].toLowerCase());
    if (!known.includes(` ${unit.join(" ")} `)) break;
    if (unit.length >= 3) sentence = true;
    kept = index;
    start = index + 1;
  }
  if (!sentence || kept < 0 || kept + 1 >= found.length) return null;
  const last = found[kept]!;
  const tail = value.slice(last.index! + last[0].length).replace(/^[\s.,;:!?)\]"'’]+/u, "").trim();
  return tail === "" ? null : tail;
}

/** The value is the field's words in order, with new words inserted at one place (not at its end). */
function holdsFieldAroundInsertion(before: readonly string[], after: readonly string[]): boolean {
  if (after.length <= before.length) return false;
  let prefix = 0;
  while (prefix < before.length && before[prefix] === after[prefix]) prefix += 1;
  let suffix = 0;
  while (suffix < before.length - prefix && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix += 1;
  return prefix + suffix === before.length && suffix > 0;
}

export function addedTail(old: string, value: string, options: { readonly sentences?: boolean } = {}): string | null {
  const before = words(old);
  if (before.length === 0) return null;
  const found = [...value.matchAll(WORD)];
  const whole = found.length > before.length && before.every((word, index) => found[index]![0].toLowerCase() === word);
  if (!whole) return options.sentences ? afterKnownSentences(old, value) : null;
  const last = found[before.length - 1]!;
  const tail = value.slice(last.index! + last[0].length).replace(/^[\s.,;:!?)\]"'’]+/u, "").trim();
  return tail === "" ? null : tail;
}
