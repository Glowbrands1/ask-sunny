/**
 * ============================================================================
 * DATES IN EVERY SHAPE A MANAGER TYPES — NEVER DROPPED SILENTLY
 * (DATE_READER_WIDE_ENABLED, default off; the same flag in both apps)
 * ============================================================================
 *
 * Pau (26 Oct 2026): "Please prioritize how apps read dates and map them in
 * the form even if they have different formats." QA-6 probed main's readers
 * with today = 2026-10-26 and found these shapes read as nothing, in every
 * role (incident, prior, follow-up, last day, notice, resignation, "change the
 * date to"), with no question asked — in a list they simply vanished:
 *
 *   "2 october", "2nd of october", "16 october", "october second", "2-Oct",
 *   "Oct-2", "10-2", "10.2", "on 1002", "the 2nd", "25 jun".
 *
 * This module reads them, as ordinary date tokens with the index and end of
 * the words they came from. `datesInText` (`form-date-answer.ts`) appends them
 * to its own matches when the flag is on, so EVERY reader built on it — the
 * incident and form dates, the prior steps, the exit dates (`exit-facts.ts`
 * reads `datesInText` too), the date edits, the draft's list of the manager's
 * dates — sees them, and every rule that filters those tokens (the incident-
 * only filter, the prior and follow-up cues) applies to them unchanged.
 *
 * YEARS. A typed year is kept. With none, a day still ahead this year is last
 * year's (an incident, a prior step, a last day has already happened, as the
 * late-opening and exit readers read a yearless "10-20"), unless the words
 * before it look ahead — "follow up 11-2", "by 11/2". "The 2nd" names no
 * month, so it is the most recent 2nd that is not in the future.
 *
 * WHAT IS NOT READ, ON PURPOSE. A dashed or dotted pair followed by a unit is
 * a range or a quantity ("10-12 hours", "3.5 hours", "$3.25"). A bare weekday
 * ("Friday") names no week. "1002" alone could be a time or a count: it is a
 * date only after "on". "The 2nd time" is not a date. "Today", "yesterday" and
 * weekdays are not added here: the form's date defaults to today by design,
 * and the exit form reads relative days itself (`exit-facts.ts`). Anything that looks like
 * a date and still cannot be read safely is returned by `unreadDateTokens`,
 * so the manager is asked ONCE — never handed a guess, never ignored.
 *
 * Pure and browser-safe; it reads no flag (its callers do).
 */

export interface WideDate {
  /** `YYYY-MM-DD`. */
  iso: string;
  /** Offset of the first character of the words. */
  index: number;
  /** Offset just past them. */
  end: number;
}

const MONTHS: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

const MONTH = "(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec)";

const ORDINAL_WORDS = [
  "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth",
  "eleventh", "twelfth", "thirteenth", "fourteenth", "fifteenth", "sixteenth", "seventeenth", "eighteenth",
  "nineteenth", "twentieth", "twenty-first", "twenty-second", "twenty-third", "twenty-fourth", "twenty-fifth",
  "twenty-sixth", "twenty-seventh", "twenty-eighth", "twenty-ninth", "thirtieth", "thirty-first",
];
/** "twenty first" and "twenty-first" are the same day. */
const ORDINAL = `(${ORDINAL_WORDS.map((word) => word.replace("-", "[\\s-]")).join("|")})`;

/** A unit after a dashed or dotted pair makes it a range or a quantity, not a date. */
const UNIT_AFTER =
  /^\s*(?:-|to\s+\d)?\s*(?:min|mins|minutes?|hrs?|hours?|days?|weeks?|months?|years?|yrs?|people|times|x\b|%|am\b|pm\b|a\.m|p\.m|dollars?|bucks|cents?|stars?|points?|pts|lbs?|pounds|miles|percent|o'?clock)/i;

/** "the 2nd time", "the 3rd shift": an ordinal that counts something, not a day. */
const COUNTED_AFTER =
  /^\s*(?:time|times|shift|shifts|floor|week|weeks|day|place|warning|quarter|year|grade|person|row|one|ones|attempt|offen[cs]e|occurrence|step|level|write|call|incident|month|period|round|try)\b/i;

function calendarIso(year: number, month: number, day: number): string | null {
  if (!Number.isInteger(year) || month < 1 || month > 12 || day < 1) return null;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day > daysInMonth) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function typedYear(year: string | undefined, currentYear: number): number {
  if (year === undefined) return currentYear;
  return year.length === 2 ? 2000 + Number(year) : Number(year);
}

/** Words before a date that look ahead: a follow-up, a deadline, a next step. */
const AHEAD_BEFORE = /\b(?:follow[\s-]?up|follow[\s-]?ing\s+up|re-?evaluate|check[\s-]?in|next|by|due|until|till|starting|effective|will|meet|review)\b[^.;!?\n]{0,24}$/i;

/** The most recent day `day` of a month that is not after `today`. */
function mostRecentDay(day: number, today: string): string | null {
  let year = Number(today.slice(0, 4));
  let month = Number(today.slice(5, 7));
  for (let step = 0; step < 13; step += 1) {
    const iso = calendarIso(year, month, day);
    if (iso && iso <= today) return iso;
    month -= 1;
    if (month === 0) [year, month] = [year - 1, 12];
  }
  return null;
}

interface Taken {
  index: number;
  end: number;
}

const overlaps = (spans: readonly Taken[], index: number, end: number) =>
  spans.some((span) => index < span.end && end > span.index);

/**
 * The dates in `text` that the shapes in `datesInText` do not read, skipping
 * any that overlap a span in `taken` (what was already read). In order.
 */
export function wideDatesInText(text: string, today: string, taken: readonly Taken[] = []): WideDate[] {
  const currentYear = Number(/^(\d{4})-/.exec(today ?? "")?.[1]);
  if (!text || !Number.isFinite(currentYear)) return [];
  const spans: Taken[] = [...taken];
  const found: WideDate[] = [];
  const add = (pattern: RegExp, read: (match: RegExpMatchArray) => string | null, skip?: (match: RegExpMatchArray, end: number) => boolean) => {
    for (const match of text.matchAll(pattern)) {
      const index = match.index ?? 0;
      const end = index + match[0].length;
      if (overlaps(spans, index, end)) continue;
      if (skip?.(match, end)) continue;
      const iso = read(match);
      if (!iso) continue;
      found.push({ iso, index, end });
      spans.push({ index, end });
    }
  };
  const month = (word: string) => MONTHS[word.toLowerCase().replace(/\.$/, "")]!;
  /*
   * A typed year is kept. With none, a day still ahead this year is last
   * year's — an incident, a prior step, a last day has happened — unless the
   * words before it look ahead ("follow up 11-2", "by 11/2").
   */
  const dated = (match: RegExpMatchArray, monthNumber: number, day: number, year: string | undefined) => {
    if (year !== undefined) return calendarIso(typedYear(year, currentYear), monthNumber, day);
    const iso = calendarIso(currentYear, monthNumber, day);
    if (!iso || iso <= today || AHEAD_BEFORE.test(text.slice(0, match.index ?? 0))) return iso;
    return calendarIso(currentYear - 1, monthNumber, day);
  };

  // "2 october", "2nd of october", "16 Oct", "2nd of october 2026".
  add(
    new RegExp(String.raw`(?<![\d$.,/-])(\d{1,2})(?:st|nd|rd|th)?(?:\s+of)?\s+${MONTH}\b(?:\.?,?\s+(\d{4})\b)?`, "gi"),
    (m) => dated(m, month(m[2]!), Number(m[1]), m[3]),
  );
  // "october second", "Oct twenty-first", "the second of october".
  add(new RegExp(String.raw`\b${MONTH}\.?\s+(?:the\s+)?${ORDINAL}\b(?:,?\s+(\d{4})\b)?`, "gi"), (m) =>
    dated(m, month(m[1]!), ORDINAL_WORDS.indexOf(m[2]!.toLowerCase().replace(/\s/, "-")) + 1, m[3]),
  );
  add(new RegExp(String.raw`\b(?:the\s+)?${ORDINAL}\s+of\s+${MONTH}\b(?:\.?,?\s+(\d{4})\b)?`, "gi"), (m) =>
    dated(m, month(m[2]!), ORDINAL_WORDS.indexOf(m[1]!.toLowerCase().replace(/\s/, "-")) + 1, m[3]),
  );
  // "2-Oct", "Oct-2", "2-Oct-26".
  add(new RegExp(String.raw`(?<![\d-])(\d{1,2})-${MONTH}\b(?:-(\d{4}|\d{2})\b)?`, "gi"), (m) =>
    dated(m, month(m[2]!), Number(m[1]), m[3]),
  );
  add(new RegExp(String.raw`\b${MONTH}-(\d{1,2})\b(?!-\d)(?:-(\d{4}|\d{2})\b)?`, "gi"), (m) =>
    dated(m, month(m[1]!), Number(m[2]), m[3]),
  );
  // "10-2": a yearless dashed month-day, unless a unit makes it a range.
  add(
    /(?<![\d/.$-])(\d{1,2})-(\d{1,2})(?![\d/-]|\.\d)/g,
    (m) => dated(m, Number(m[1]), Number(m[2]), undefined),
    (_m, end) => UNIT_AFTER.test(text.slice(end, end + 14)),
  );
  // "10.2": a yearless dotted month-day, never money and never a quantity.
  add(
    /(?<![\d.$\w])(\d{1,2})\.(\d{1,2})(?![\d]|\.\d)/g,
    (m) => dated(m, Number(m[1]), Number(m[2]), undefined),
    (_m, end) => UNIT_AFTER.test(text.slice(end, end + 14)),
  );
  // "on 1002": four digits are a date only after "on".
  add(
    /\bon\s+(\d{2})(\d{2})\b/gi,
    (m) => dated(m, Number(m[1]), Number(m[2]), undefined),
    (_m, end) => UNIT_AFTER.test(text.slice(end, end + 14)),
  );
  // "the 2nd": the most recent 2nd that is not in the future.
  add(
    /\bthe\s+(\d{1,2})(?:st|nd|rd|th)\b/gi,
    (m) => mostRecentDay(Number(m[1]), today),
    (_m, end) => COUNTED_AFTER.test(text.slice(end, end + 16)) || /^\s+of\b/i.test(text.slice(end, end + 6)),
  );
  return found.sort((left, right) => left.index - right.index);
}

/**
 * Words that look like a date but are not one any reader can place —
 * "13/45", "10.45.26", "on 1340", "32 october", "october 45", "the 45th" —
 * as typed, in order, skipping any span in `read`. The chat asks about them
 * ONCE (`unreadDateQuestion`), instead of dropping them.
 */
export function unreadDateTokens(text: string, read: readonly Taken[]): string[] {
  if (!text) return [];
  const spans: Taken[] = [...read];
  const out: string[] = [];
  const look = (pattern: RegExp, skip?: (end: number) => boolean) => {
    for (const match of text.matchAll(pattern)) {
      const index = match.index ?? 0;
      const end = index + match[0].length;
      if (overlaps(spans, index, end) || skip?.(end)) continue;
      out.push(match[0].trim());
      spans.push({ index, end });
    }
  };
  const unit = (end: number) => UNIT_AFTER.test(text.slice(end, end + 14));
  look(/(?<![\d$.\w/-])\d{1,2}[/.-]\d{1,2}(?:[/.-]\d{2,4})?(?![\d/.-]*\d)/g, unit);
  look(/\bon\s+\d{3,4}\b/gi, unit);
  look(new RegExp(String.raw`(?<![\d$])\b\d{1,2}(?:st|nd|rd|th)?(?:\s+of)?\s+${MONTH}\b`, "gi"));
  look(new RegExp(String.raw`\b${MONTH}\.?\s+\d{1,2}(?:st|nd|rd|th)?\b`, "gi"));
  look(/\bthe\s+\d{1,2}(?:st|nd|rd|th)\b/gi, (end) => COUNTED_AFTER.test(text.slice(end, end + 16)));
  // "change the date to 1002", "her last day was 1002": four digits where a date belongs, but not after "on".
  for (const match of text.matchAll(/\b(?:was|is|to|be|date|day)\s+((?:0[1-9]|1[0-2])\d{2})\b/gi)) {
    const index = (match.index ?? 0) + match[0].length - match[1]!.length;
    const end = index + match[1]!.length;
    if (overlaps(spans, index, end) || unit(end)) continue;
    out.push(match[1]!);
    spans.push({ index, end });
  }
  return out;
}

/** The one question for a date that could not be read. */
export function unreadDateQuestion(typed: string): string {
  return `I couldn't read the date "${typed}" — which date did you mean?`;
}

/**
 * In a "change the date to …" turn, a date its own clause gives to an earlier
 * step or another line — "verbal was 9/15", "written on 9/20", "coaching
 * 9/1", "follow up 11/2" — is that step's, never the form's.
 */
const STEP_IN_CLAUSE =
  /\b(?:verbal|written|coach(?:ing|ed)?|warning|write[\s-]?up|follow[\s-]?up|prior|previous|ca|c\/a|corrective)\b(?:\s+(?:warning|action|step|one|ca|was|were|is|on|dated|from|given|done|signed|held))*\s*[:-]?\s*$/i;

export function stepCuedInDateChange(text: string, index: number): boolean {
  const before = text.slice(0, index);
  const clauseStart = Math.max(before.lastIndexOf(","), before.lastIndexOf(";"), before.lastIndexOf("."), before.lastIndexOf("\n"), before.search(/\band\s+(?:her|his|the)?\s*(?:verbal|written|coach)/i));
  return STEP_IN_CLAUSE.test(before.slice(clauseStart + 1));
}

/*
 * A DOT INSIDE A DATE IS NOT THE END OF A SENTENCE (QA's live date run,
 * 26 Oct 2026): "late on 10.5.26" became What happened "late on 10", and
 * "late on oct. 5" became "late on oct". A sentence splitter masks these dots
 * first and restores them in every piece.
 */
const DATE_DOT_MARK = "\u2024";
const DOTTED_DATE = /(?<![\d.$])\d{1,2}\.\d{1,2}(?:\.\d{2,4})?(?![\d]|\.\d)/g;
const MONTH_ABBREVIATION_DOT = /\b(?:jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\.(?=\s*\d)/gi;

/** `text` with the dots of dotted dates and abbreviated months masked. */
export function protectDateDots(text: string): string {
  return (text ?? "")
    .replace(DOTTED_DATE, (match) => match.replace(/\./g, DATE_DOT_MARK))
    .replace(MONTH_ABBREVIATION_DOT, (match) => match.replace(".", DATE_DOT_MARK));
}

/** The masked dots back. */
export function restoreDateDots(text: string): string {
  return (text ?? "").replace(new RegExp(DATE_DOT_MARK, "g"), ".");
}
