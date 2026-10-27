import { relativeDateReaderEnabled } from "@/lib/config/chat-quality-flags";
import { shiftDays, weekdayOf } from "@/lib/business-date";

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

export function relativeDates(text: string, today: string): FoundDate[] {
  if (!relativeDateReaderEnabled() || !text || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return [];
  const out: FoundDate[] = [];
  const push = (iso: string, index: number, length: number) => out.push({ iso, index, end: index + length });
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
  return out;
}
