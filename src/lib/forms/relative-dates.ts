import { dayWordTyposEnabled, relativeDateReaderEnabled, relativeDayPartWordsEnabled } from "@/lib/config/chat-quality-flags";
import { shiftDays, weekdayOf } from "@/lib/business-date";

import { correctedText } from "./typo-match";
import type { FoundDate } from "./wider-dates";

/**
 * RELATIVE_DATE_READER_ENABLED (QA, 27 Oct 2026; same flag in both apps):
 * "create a CA form for <name> at <salon>. she was late last tuesday" read as
 * no date, the card said nothing about it, and Create dated the form today.
 * With the flag on, `datesInText` (through `withWiderDates`) also reads, from
 * the business date it is given:
 *
 *   "today"                          that day
 *   "yesterday"                      the day before
 *   "last tuesday", "this past       the most recent Tuesday before today
 *   tuesday", "past tuesday"
 *   "on tuesday"                     the most recent Tuesday, today included
 *
 * A weekday followed by a date ("on monday 10/19") is left to that date, and
 * "next tuesday" is never read. Off, nothing is added.
 */
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const DAY = String.raw`(sun|mon|tues?|wed(?:nes)?|thu(?:rs?)?|fri|sat(?:ur)?)(?:day)?`;
const NO_DATE_AFTER = String.raw`(?!\s*,?\s*(?:the\s+)?\d)`;
const PAST_WEEKDAY = new RegExp(String.raw`\b(?:last|this\s+past|past)\s+${DAY}\b${NO_DATE_AFTER}`, "gi");
const ON_WEEKDAY = new RegExp(String.raw`\bon\s+${DAY}\b${NO_DATE_AFTER}`, "gi");
const DAY_WORD = /\b(today|yesterday)\b/gi;
/*
 * RELATIVE_DAY_PART_WORDS_ENABLED (QA's Sunny live check, 13 Nov 2026, 6:20 PM Central: "verbal ca for <B>, she
 * no-call no-showed tonight" gave a card with no Date; "today" worked): a part of today is today — "tonight", "this
 * morning", "this afternoon", "this evening" — and "last night" is the business day before. From the business date
 * this reader is given, never the host's clock. Off, not read.
 */
const DAY_PART_WORD = /\b(?:tonight|this\s+(?:morning|afternoon|evening)|last\s+night)\b/gi;

/** Every relative date word this reader reads, for callers that must re-read them against the real day. */
export const RELATIVE_DATE_WORD = new RegExp(
  String.raw`^(?:today|yesterday|(?:(?:last|this\s+past|past)\s+)?${DAY})$`,
  "i",
);

function weekdayIndex(word: string): number {
  const lower = word.toLowerCase();
  return WEEKDAYS.findIndex((name) => name.startsWith(lower.slice(0, 3)));
}

/** The most recent `weekday` on or before `today` (`includeToday`), else strictly before it. */
function mostRecent(today: string, weekday: number, includeToday: boolean): string {
  let back = (weekdayOf(today) - weekday + 7) % 7;
  if (back === 0 && !includeToday) back = 7;
  return shiftDays(today, -back);
}

/*
 * DAY_WORD_TYPOS_ENABLED (QA, 27 Oct 2026; same flag in both apps):
 * "yesturday", "tuesdy", "last tusday" are read as the day words they can only
 * be (`typo-match.ts`). The found date still points at what the manager typed.
 */
// "today" is left out: five letters is too short ("tsday" is one letter from it), and a form is dated today anyway.
const DAY_WORDS = [...WEEKDAYS, "yesterday"];

function readingCopy(text: string): { text: string; original: (index: number) => number } {
  if (!dayWordTyposEnabled()) return { text, original: (index) => index };
  return correctedText(text, DAY_WORDS);
}

/** True when `said` is a relative date word, typos included when that flag is on. */
export function isRelativeDateWord(said: string): boolean {
  const word = readingCopy(said).text.trim();
  // RELATIVE_DAY_PART_WORDS_ENABLED: "last night", "tonight", "this morning" are relative words too, so a caller that
  // re-reads relative words against the real day treats them alike (the sibling gate's #891 finding).
  if (relativeDayPartWordsEnabled() && DAY_PART_ONLY.test(word)) return true;
  return RELATIVE_DATE_WORD.test(word);
}

const DAY_PART_ONLY = /^(?:tonight|this\s+(?:morning|afternoon|evening)|last\s+night)$/i;

export function relativeDates(typed: string, today: string): FoundDate[] {
  if (!relativeDateReaderEnabled() || !typed || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return [];
  const copy = readingCopy(typed);
  const text = copy.text;
  const out: FoundDate[] = [];
  const push = (iso: string, index: number, length: number) =>
    out.push({ iso, index: copy.original(index), end: copy.original(index + length - 1) + 1 });
  for (const match of text.matchAll(PAST_WEEKDAY)) {
    const weekday = weekdayIndex(match[1]!);
    if (weekday >= 0) push(mostRecent(today, weekday, false), match.index!, match[0].length);
  }
  for (const match of text.matchAll(ON_WEEKDAY)) {
    const weekday = weekdayIndex(match[1]!);
    const at = match.index! + match[0].search(/\s/) + 1;
    if (weekday >= 0) push(mostRecent(today, weekday, true), at, match.index! + match[0].length - at);
  }
  for (const match of text.matchAll(DAY_WORD)) {
    push(match[1]!.toLowerCase() === "today" ? today : shiftDays(today, -1), match.index!, match[0].length);
  }
  if (relativeDayPartWordsEnabled()) {
    for (const match of text.matchAll(DAY_PART_WORD)) {
      push(/^last\s+night$/i.test(match[0]) ? shiftDays(today, -1) : today, match.index!, match[0].length);
    }
  }
  return out;
}
