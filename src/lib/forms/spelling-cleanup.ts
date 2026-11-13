import { editDistance } from "./employee-match";
import { datesInText } from "./form-date-answer";

/**
 * ============================================================================
 * SPELLING CLEANUP ON THE FORM, NEVER ON A FACT (SPELLING_CLEANUP_ENABLED)
 * ============================================================================
 *
 * Pau, via QA (13 Nov 2026). The model already reads "sanitaion" as sanitation; the typo reached the form because the
 * form-filling step is told to keep the manager's words, and a Corrective Action draft or a later edit had no rule to
 * mend them. Coaching drafts already clean up as they write (`coaching-framing.ts`, LANGUAGE_CLEANUP_RULES). With the
 * flag on, the Corrective Action draft and the chat's form edits (Step B's patch) carry the same rule:
 *
 *   use the manager's words and meaning, but fix spelling, spacing and capitals; never add facts, soften, or reword.
 *
 * HARD LIMITS, CHECKED IN CODE (`cleanupKeepsFacts`): spelling cleanup never changes a name, a date, a number or a quote.
 * What the model wrote is compared with what it was given (the manager's words, the form as it stands, the employee):
 *
 *   - every date written is a date given (read as dates, so "11/2" written "November 2, 2026" is the same day);
 *   - every other number written is a number given ("10-minute" keeps its 10);
 *   - every quoted span written is in the source exactly as typed;
 *   - no capitalised word written is a near miss of a name given ("Talmadge" written "Talmage" is a changed name);
 *     the same word with its capital mended is fine.
 *
 * When any check fails, the caller falls back to the manager's own text: it asks again without the cleanup rule (the
 * copy-as-given behaviour from before the flag). Off, nothing here runs. Pure.
 */

export const SPELLING_CLEANUP_RULES: readonly string[] = [
  "SPELLING, SPACING AND CAPITALS. Use the manager's words and meaning, but fix their spelling, spacing and capitals as you write (\"not doing th e10 minute sanitaion\" is written \"not doing the 10-minute sanitation\"). Never add a fact, soften or strengthen anything, or reword what the manager said.",
  "Never change a name, a date, a number or anything in quotation marks: keep each exactly as the manager typed it (a name exactly as the form's EMPLOYEE line spells it).",
];

/** Why a cleaned text cannot stand; empty when it keeps every name, date, number and quote. */
export function cleanupChanges(input: {
  /** Everything the writer was given: the manager's words, the form as it stands, the employee's name. */
  readonly source: string;
  /** What the writer returned, every field joined. */
  readonly written: string;
  /** The business day, `YYYY-MM-DD`, for reading a date with no year. */
  readonly today: string;
  /** Names the form already holds (the employee), which count as given. */
  readonly names?: readonly string[];
}): string[] {
  const reasons: string[] = [];
  const source = input.source ?? "";
  const written = input.written ?? "";
  if (!written.trim()) return reasons;

  // Dates, as days.
  const sourceDates = datesInText(source, input.today);
  const writtenDates = datesInText(written, input.today);
  const givenDays = new Set(sourceDates.map((date) => date.iso));
  for (const date of writtenDates) {
    if (!givenDays.has(date.iso)) reasons.push(`date ${written.slice(date.index, date.end)} was not given`);
  }

  // Other numbers, with the dates taken out of both texts.
  const givenNumbers = new Set(numbersIn(withoutSpans(source, sourceDates)));
  for (const value of numbersIn(withoutSpans(written, writtenDates))) {
    if (!givenNumbers.has(value)) reasons.push(`number ${value} was not given`);
  }

  // Quoted spans, exactly.
  for (const quote of quotesIn(written)) {
    if (!source.includes(quote)) reasons.push(`quote "${quote}" is not as typed`);
  }

  // Names: a capitalised written word that is a near miss of a given name word, not the same word.
  const nameWords = givenNameWords(source, input.names ?? []);
  for (const word of capitalisedWords(written)) {
    const key = word.toLowerCase();
    if (nameWords.has(key)) continue;
    for (const given of nameWords) {
      if (given.length >= 4 && key.length >= 4 && key[0] === given[0] && editDistance(key, given) <= 2) {
        reasons.push(`name ${given} was written ${word}`);
        break;
      }
    }
  }
  return [...new Set(reasons)];
}

/** Whether the cleaned text keeps every name, date, number and quote it was given. */
export function cleanupKeepsFacts(input: Parameters<typeof cleanupChanges>[0]): boolean {
  return cleanupChanges(input).length === 0;
}

function withoutSpans(text: string, spans: readonly { index: number; end: number }[]): string {
  let out = "";
  let at = 0;
  for (const span of [...spans].sort((a, b) => a.index - b.index)) {
    if (span.index < at) continue;
    out += `${text.slice(at, span.index)} `;
    at = span.end;
  }
  return out + text.slice(at);
}

/** Each run of digits, as a number ("$25.00" is 25, "10-minute" is 10, "030" is 30). */
function numbersIn(text: string): string[] {
  return [...text.matchAll(/\d+(?:[.,]\d+)*/g)].map((match) => {
    const value = Number(match[0].replace(/,/g, ""));
    return Number.isFinite(value) ? String(value) : match[0];
  });
}

const QUOTE = /["“]([^"“”\n]{3,}?)["”]/g;

function quotesIn(text: string): string[] {
  return [...text.matchAll(QUOTE)].map((match) => match[1]!.trim()).filter((quote) => quote.split(/\s+/).length >= 2);
}

/** Words that open a sentence or a labelled line are capitalised by grammar, not because they name someone. */
function capitalisedWords(text: string): string[] {
  const words: string[] = [];
  for (const match of text.matchAll(/[A-Z][a-z'’]+/g)) {
    const before = text.slice(0, match.index).replace(/[ \t]+$/, "");
    if (before === "" || /[.!?:\n]$/.test(before) || /(?:^|\n)\s*[-•*]$/.test(before)) continue;
    words.push(match[0]);
  }
  return words;
}

/** The name words given: the form's names, and every capitalised word the manager wrote mid-sentence. */
function givenNameWords(source: string, names: readonly string[]): Set<string> {
  const words = new Set<string>();
  for (const name of names) for (const word of name.split(/\s+/)) if (word.length > 1) words.add(word.toLowerCase());
  for (const word of capitalisedWords(source)) words.add(word.toLowerCase());
  return words;
}
