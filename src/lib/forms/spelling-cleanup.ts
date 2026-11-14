import { PRODUCTION_SALONS } from "@/data/salons";

import { accountNames } from "./account-names";
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
  const spoken = spokenDays(source, input.today);
  for (const date of writtenDates) {
    if (givenDays.has(date.iso) || spoken(date.iso, sourceDates)) continue;
    reasons.push(`date ${written.slice(date.index, date.end)} was not given`);
  }

  // Other numbers, with the dates taken out of both texts.
  const givenNumbers = new Set(numbersIn(withoutPages(withoutSpans(source, sourceDates))));
  for (const value of numbersIn(withoutPages(withoutSpans(written, writtenDates)))) {
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

  // QA's bar (the sibling gate's #772 probe, 14 Nov 2026; ported): a salon name or a roster name, typed in any case, is a name.
  // A known name the manager typed ("manuel", "Kearny") that the writer turned into another word, or a near miss the
  // writer turned into a known name ("kearny" → "kearney"), is a changed name.
  const known = knownNameWords(input.names ?? []);
  const sourceWords = wordCounts(source);
  const writtenWords = wordCounts(written);
  for (const [word, count] of sourceWords) {
    // A word one letter from a known name, or two from a long one ("kerny" for "kearney"; Gate-Sunny-2, #983), is that name.
    const isName = known.has(word) || [...known].some((name) => name.length >= 4 && word.length >= 4 && word[0] === name[0] && editDistance(word, name) <= (name.length >= 6 && word.length >= 5 ? 2 : 1));
    if (!isName || (writtenWords.get(word) ?? 0) >= count) continue;
    // Said once: a name the capitalised-word check above already caught is not reported again.
    if (reasons.some((reason) => reason.toLowerCase().startsWith(`name ${word} `))) continue;
    const became = [...writtenWords.keys()].find((other) => other !== word && !sourceWords.has(other) && other[0] === word[0] && editDistance(other, word) <= 2);
    if (became) reasons.push(`name ${word} was written ${became}`);
  }
  return [...new Set(reasons)];
}

/** Whether the cleaned text keeps every name, date, number and quote it was given. */
export function cleanupKeepsFacts(input: Parameters<typeof cleanupChanges>[0]): boolean {
  return cleanupChanges(input).length === 0;
}

/*
 * THE SAME DAY IN THE MANAGER'S WORDS (Gate-Sunny-3, 13 Nov 2026). The app writes out dates the manager gave in other
 * words, on purpose ("late on the 2nd" is drafted "on October 2, 2026"; "last tuesday" becomes its date), and a form's
 * prior rows and year are given too. A written date is the manager's when the source names that day in any of these
 * ways: its day of the month as an ordinal or after "on" ("the 2nd", "on the 15"), a yearless dashed date ("10-15"),
 * its weekday ("last tuesday",
 * "on fri"), "today" / "yesterday" / "tonight" / "this morning" for those days, or the same month and day with another
 * year (a corrected year). A date none of these name is still a changed date.
 */
const ORDINAL_DAY = /\b(?:the\s+|on\s+(?:the\s+)?)?(\d{1,2})(?:st|nd|rd|th)\b|\bon\s+the\s+(\d{1,2})\b/gi;
const WEEKDAY_WORD = /\b(sun|mon|tue|wed|thu|fri|sat)[a-z]*\b/gi;
const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const DASHED_DAY = /(?<![\d/-])(\d{1,2})-(\d{1,2})(?![\d/-])/g;
const SAME_DAY_WORD = /\b(?:today|tonight|this\s+(?:morning|afternoon|evening))\b/i;
const YESTERDAY_WORD = /\b(?:yesterday|yesturday|last\s+night)\b/i;

function spokenDays(source: string, today: string): (iso: string, sourceDates: readonly { iso: string }[]) => boolean {
  const ordinals = new Set<number>();
  for (const match of source.matchAll(ORDINAL_DAY)) ordinals.add(Number(match[1] ?? match[2]));
  const weekdays = new Set<number>();
  for (const match of source.matchAll(WEEKDAY_WORD)) weekdays.add(WEEKDAYS.indexOf(match[1]!.toLowerCase()));
  // A yearless dashed date ("late on 10-5 and 10-15"), month then day, as managers type it (Gate-Sunny-3, 13 Nov 2026).
  const dashed = new Set<string>();
  for (const match of source.matchAll(DASHED_DAY)) {
    const month = Number(match[1]);
    const day = Number(match[2]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) dashed.add(`${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
  }
  const sameDay = SAME_DAY_WORD.test(source);
  const yesterday = YESTERDAY_WORD.test(source);
  const validToday = /^\d{4}-\d{2}-\d{2}$/.test(today);
  return (iso, sourceDates) => {
    const [year, month, day] = iso.split("-").map(Number) as [number, number, number];
    if (ordinals.has(day)) return true;
    if (weekdays.has(new Date(Date.UTC(year, month - 1, day)).getUTCDay())) return true;
    if (validToday && sameDay && iso === today) return true;
    if (validToday && yesterday && iso === dayBefore(today)) return true;
    if (dashed.has(iso.slice(5))) return true;
    return sourceDates.some((given) => given.iso.slice(5) === iso.slice(5));
  };
}

function dayBefore(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day - 1)).toISOString().slice(0, 10);
}

/*
 * A policy page ("JBA Policy Manual p.14", "p. 12", "page 3") is the app's citation, from the knowledge base, not a
 * number the manager gave (Gate-Sunny-3, 13 Nov 2026: nov7-s34's revision cites Attendance at p.14). The policy-citation
 * guards check pages; this check leaves them alone.
 */
const PAGE = /\b(?:p|pg|page|pages)\.?\s*\d+(?:\s*[-–]\s*\d+)?/gi;

function withoutPages(text: string): string {
  return text.replace(PAGE, " ");
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

// A quote may be left open to the end of its line (Gate-Sunny-2, #983: ‘i read the polcy); an apostrophe between two
// letters ("isn't") is part of a single-quoted span, not its end.
const QUOTE = /["“]([^"“”\n]{3,}?)(?:["”]|$)/gm;
// QA's bar (14 Nov 2026): a single-quoted span is a quote too ('that is not my registr'); an apostrophe in a word is not.
const SINGLE_QUOTE = /(?<![A-Za-z0-9])['‘]((?:[^'‘’\n]|(?<=[A-Za-z])['’](?=[A-Za-z])){3,}?)(?:['’](?![A-Za-z0-9])|$)/gm;

function quotesIn(text: string): string[] {
  return [...text.matchAll(QUOTE), ...text.matchAll(SINGLE_QUOTE)]
    // A quote left open has no closing mark to end it: the full stop a writer adds after it is not part of it.
    .map((match) => (/["”'’]$/.test(match[0]) ? match[1]!.trim() : match[1]!.trim().replace(/[.!?,;:]+$/, "")))
    .filter((quote) => quote.split(/\s+/).length >= 2);
}

/** Salon name words and the turn's roster name words (`account-names.ts`), with the form's names: all names. */
function knownNameWords(names: readonly string[]): Set<string> {
  const words = new Set<string>(accountNames());
  for (const name of names) for (const word of name.toLowerCase().split(/[^a-z'’-]+/)) if (word.length >= 2) words.add(word);
  for (const salon of PRODUCTION_SALONS) for (const word of salon.name.toLowerCase().split(/[^a-z]+/)) if (word.length >= 4) words.add(word);
  return words;
}

function wordCounts(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const match of text.toLowerCase().matchAll(/[a-z]+/g)) counts.set(match[0], (counts.get(match[0]) ?? 0) + 1);
  return counts;
}

/** Words that open a sentence or a labelled line are capitalised by grammar, not because they name someone. */
function capitalisedWords(text: string): string[] {
  const words: string[] = [];
  for (const match of text.matchAll(/[A-Z][a-z'’]+/g)) {
    const before = text.slice(0, match.index).replace(/[ \t]+$/, "");
    if (before === "" || /[.!?:\n]$/.test(before) || /(?:^|\n)\s*[-•*]$/.test(before)) continue;
    // A possessive is the same name ("Holloway's", "Sela’s"; Gate-Sunny-3, 13 Nov 2026).
    words.push(match[0].replace(/['’]s?$/i, ""));
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

/** What a cleanup may not change; each reason `cleanupChanges` gives starts with one of these. */
export const CLEANUP_KINDS = ["name", "date", "number", "quote"] as const;
export type CleanupKind = (typeof CLEANUP_KINDS)[number];

/**
 * QA's safety ruling (13 Nov 2026, Gate-Sunny-3): the fallback is checked too. Each field of what came back from the
 * fallback is checked on its own; one that still changes a name, a date, a number or a quote gets the manager's own
 * words for that field (`own`), or, with none, is left out so the form keeps what it holds. Fields that keep every
 * fact pass through as written. Returns the values to save and the keys replaced or left out.
 */
export function withOwnWords<V>(
  values: Readonly<Record<string, V>>,
  input: {
    readonly source: string;
    readonly today: string;
    readonly names?: readonly string[];
    /** The manager's own words for a field, or null to leave the field out. */
    readonly own: (key: string) => string | null;
    /**
     * Which changes replace a field; all four when omitted. The draft route passes name and quote: a date or number the
     * fallback (main's own prompt) writes is left to the app's date and metric guards, which remove just the sentence
     * carrying it (Gate-Sunny-3, 13 Nov 2026), as they do with the flag off.
     */
    readonly kinds?: readonly CleanupKind[];
  },
): { values: Record<string, V | string>; replaced: string[] } {
  const out: Record<string, V | string> = {};
  const replaced: string[] = [];
  for (const [key, value] of Object.entries(values)) {
    const changed =
      typeof value === "string" &&
      cleanupChanges({ source: input.source, written: value, today: input.today, names: input.names }).some((reason) =>
        (input.kinds ?? CLEANUP_KINDS).some((kind) => reason.startsWith(`${kind} `)),
      );
    if (!changed) {
      out[key] = value;
      continue;
    }
    replaced.push(key);
    const own = input.own(key);
    if (own !== null) out[key] = own;
  }
  return { values: out, replaced };
}
