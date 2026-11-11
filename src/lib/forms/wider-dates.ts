import { widerDateReaderEnabled } from "@/lib/config/chat-quality-flags";

import { relativeDates } from "./relative-dates";

/**
 * WIDER_DATE_READER_ENABLED (QA, the Madeline chain and the variation
 * report, 27 Oct 2026; same flag in both apps): "she was late on 2 october",
 * "on the 2nd of october", "on 10.2" and "on the 2nd" read as no date. With the
 * flag on, `datesInText` (form-date-answer.ts) also reads:
 *
 *   day-first month names   "2 october", "2nd of october", "the 2nd of oct"
 *   a yearless dotted date  "on 10.2", only after on / since / from / by, so
 *                           "$10.25" and "3.5 hours" are never dates
 *   a bare ordinal          "on the 2nd": this month if the day has come,
 *                           else last month, never a future day
 *
 * A date the existing reader already found is never read twice. Off, the
 * dates found are returned as they were.
 */
export interface FoundDate {
  iso: string;
  index: number;
  end: number;
}

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11,
  dec: 12, december: 12,
};
const MONTH = "january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec";
const DAY_FIRST = new RegExp(String.raw`\b(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(${MONTH})\b\.?(?:,?\s+(\d{4})\b)?`, "gi");
const DOTTED = /\b(?:on|since|from|by)\s+(\d{1,2})\.(\d{1,2})(?![\d.]*\d)/gi;
const ORDINAL = new RegExp(String.raw`\b(?:on|since|from|by)\s+the\s+(\d{1,2})(?:st|nd|rd|th)\b(?!\s+(?:of\b|${MONTH}\b|shift|time|day|week|offense|warning|ca\b))`, "gi");

function calendarIso(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function wider(text: string, today: string): FoundDate[] {
  const [year, month, day] = today.split("-").map(Number) as [number, number, number];
  const out: FoundDate[] = [];
  const push = (iso: string | null, index: number, end: number) => {
    if (iso) out.push({ iso, index, end });
  };
  for (const match of text.matchAll(DAY_FIRST)) {
    const named = MONTHS[match[2]!.toLowerCase()];
    if (named) push(calendarIso(match[3] ? Number(match[3]) : year, named, Number(match[1])), match.index!, match.index! + match[0].length);
  }
  for (const match of text.matchAll(DOTTED)) {
    const at = match.index! + match[0].search(/\d/);
    push(calendarIso(year, Number(match[1]), Number(match[2])), at, match.index! + match[0].length);
  }
  for (const match of text.matchAll(ORDINAL)) {
    const wanted = Number(match[1]);
    const back = wanted <= day ? 0 : 1;
    const m = month - back < 1 ? 12 : month - back;
    const y = month - back < 1 ? year - 1 : year;
    const at = match.index! + match[0].search(/the/i);
    push(calendarIso(y, m, wanted), at, match.index! + match[0].length);
  }
  return out;
}

export function withWiderDates<T extends FoundDate>(text: string, today: string, found: T[]): T[] {
  if (!text) return found;
  // RELATIVE_DATE_READER_ENABLED: "last tuesday", "yesterday", "today" — see `relative-dates.ts`.
  const read = [...(widerDateReaderEnabled() ? wider(text, today) : []), ...relativeDates(text, today)];
  const extra = read.filter((date) => !found.some((have) => date.index < have.end && have.index < date.end));
  if (extra.length === 0) return found;
  return [...found, ...(extra as T[])].sort((a, b) => a.index - b.index);
}
