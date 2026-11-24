/**
 * ============================================================================
 * ONE DATE READER FOR EVERY STYLE (batch E, E14: Pau via QA, 14 Nov 2026)
 * ============================================================================
 *
 * The agent loop's account check, incident dates, card date and edit_form's form_date read dates here. Before this,
 * only numeric dates were seen ("6/11", "6-11-26"), so an account that wrote "9-28-26" as "September 28, 2026" was
 * flagged as leaving the date out, and "june 11" was never a date at all.
 *
 * Read: 6/11, 6-11, 06/11/2026, 6/11/26, 6.11.26 (a dotted date needs its year, or "on" before it, so "4.5 hours" is
 * never a date); June 11, Jun 11, june 11th, Sept 28, 11 June, the 11th of June; each with or without a year.
 * Weekdays and "yesterday" / "last night" are not dates here (the account check keeps them as words).
 *
 * Two dates are the same day when their month and day match, and their years too when both have one.
 */

export interface ReadDate {
  /** Where the date starts in the text, and the text as written. */
  readonly index: number;
  readonly text: string;
  readonly month: number;
  readonly day: number;
  readonly year: number | null;
}

const MONTHS: readonly (readonly string[])[] = [
  ["january", "jan"],
  ["february", "feb"],
  ["march", "mar"],
  ["april", "apr"],
  ["may"],
  ["june", "jun"],
  ["july", "jul"],
  ["august", "aug"],
  ["september", "sept", "sep"],
  ["october", "oct"],
  ["november", "nov"],
  ["december", "dec"],
];
const MONTH = MONTHS.flat().sort((a, b) => b.length - a.length).join("|");
const ORDINAL = "(?:st|nd|rd|th)?";
const YEAR = "(?:,?\\s+(\\d{4})|\\s+'(\\d{2}))?";

const PATTERNS: readonly { readonly pattern: RegExp; readonly read: (match: RegExpExecArray) => [month: number, day: number, year: string | undefined] }[] = [
  /*
   * 6/11, 6-11, 06/11/2026, 6/11/26 (one separator throughout). QA's code audit (20 Nov 2026, on d7960a5f): a number range
   * followed by a length of time ("10-15 minutes late", "2-3 hrs") is never a date; it read as 10/15, so an account with
   * another date counted two dates and asked which.
   */
  { pattern: /\b(\d{1,2})([/-])(\d{1,2})(?:\2(\d{4}|\d{2}))?(?![\d/-])(?!\s*(?:minutes?|mins?|hours?|hrs?)\b)/gi, read: (m) => [Number(m[1]), Number(m[3]), m[4]] },
  /* 6.11.26, 6.11.2026; "on 6.11". */
  { pattern: /(?<![\d$.])(\d{1,2})\.(\d{1,2})\.(\d{4}|\d{2})(?![\d.])/g, read: (m) => [Number(m[1]), Number(m[2]), m[3]] },
  { pattern: /(?<=\bon\s)(\d{1,2})\.(\d{1,2})(?![\d.])/gi, read: (m) => [Number(m[1]), Number(m[2]), undefined] },
  /* June 11, Jun. 11th, Sept 28, 2026. */
  { pattern: new RegExp(`\\b(${MONTH})\\.?\\s+(\\d{1,2})${ORDINAL}\\b${YEAR}`, "gi"), read: (m) => [monthOf(m[1]!), Number(m[2]), m[3] ?? m[4]] },
  /* 11 June, 11th of June, the 11th of June 2026. */
  { pattern: new RegExp(`\\b(?:the\\s+)?(\\d{1,2})${ORDINAL}\\s+(?:of\\s+)?(${MONTH})\\b\\.?${YEAR}`, "gi"), read: (m) => [monthOf(m[2]!), Number(m[1]), m[3] ?? m[4]] },
];

function monthOf(name: string): number {
  const lower = name.toLowerCase();
  return MONTHS.findIndex((names) => names.includes(lower)) + 1;
}

function fullYear(year: string | undefined): number | null {
  if (!year) return null;
  return year.length === 2 ? 2000 + Number(year) : Number(year);
}

/** Every date in the text, in order, each once (where two styles overlap, the first and longest reading wins). */
export function readDates(text: string): ReadDate[] {
  const found: ReadDate[] = [];
  for (const { pattern, read } of PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      const [month, day, year] = read(match as RegExpExecArray);
      if (month < 1 || month > 12 || day < 1 || day > 31) continue;
      found.push({ index: match.index!, text: match[0], month, day, year: fullYear(year) });
    }
  }
  found.sort((a, b) => a.index - b.index || b.text.length - a.text.length);
  const kept: ReadDate[] = [];
  for (const date of found) {
    const last = kept.at(-1);
    if (last && date.index < last.index + last.text.length) continue;
    kept.push(date);
  }
  return kept;
}

/** The same day, whatever the style: month and day match, and the year too when both have one. */
export function sameDate(a: Pick<ReadDate, "month" | "day" | "year">, b: Pick<ReadDate, "month" | "day" | "year">): boolean {
  return a.month === b.month && a.day === b.day && (a.year === null || b.year === null || a.year === b.year);
}

/** The text with every date taken out (for the figure and word checks, which must not see a date's numbers or month). */
export function withoutDates(text: string): string {
  let out = "";
  let at = 0;
  for (const date of readDates(text)) {
    out += `${text.slice(at, date.index)} `;
    at = date.index + date.text.length;
  }
  return out + text.slice(at);
}

/**
 * A month/day as the most recent such day not after `today`, in ISO form (the card's date field). `today` is the
 * salon's local date (E13: `context.today`), never the server's UTC clock, which is already tomorrow on an evening.
 */
export function monthDayToIso(monthDay: string, today: string): string {
  const [month, day] = monthDay.split("/").map(Number) as [number, number];
  const iso = (year: number) => `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const year = Number(today.slice(0, 4));
  return iso(year) > today ? iso(year - 1) : iso(year);
}

/** A form date as written ("2026-12-20", "12/20/2026", "December 20", "12/20"), in ISO form, or null. */
export function isoDate(value: string, today: string): string | null {
  const text = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  /*
   * QA's batch J review (15 Nov 2026): "2026-12-20T00:00", "2026/12/20", "2026-12-20T09", "2026-12-20 9am" and
   * "2026-12-20 at 9:00" were read as 12/20 of LAST year. A leading four-digit year is always the year, and whatever
   * follows the day (a time) is ignored. A format parser.
   */
  const leading = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?!\d)/.exec(text);
  if (leading) {
    const [year, month, day] = [Number(leading[1]), Number(leading[2]), Number(leading[3])];
    if (month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate()) return null;
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  const [date] = readDates(text);
  if (!date) return null;
  if (date.year !== null) return `${date.year}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`;
  return monthDayToIso(`${date.month}/${date.day}`, today);
}
