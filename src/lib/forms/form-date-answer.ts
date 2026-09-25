/**
 * ============================================================================
 * THE DATE A MANAGER TYPED, AS THE FORM'S DATE
 * ============================================================================
 *
 * The intakes only ever asked WHETHER a date had been given (`DATE_GIVEN` in
 * `corrective-action-intake.ts` and `epp-intake.ts`). Nothing read WHICH date,
 * so a manager who answered "3. 9/11" got a form dated today — and the drafting
 * route, correctly trusting `form_date`, then rewrote the "September 11" in the
 * observation to today as well.
 *
 * This reads the date itself, in the shapes managers actually type:
 *
 *   9/11   02/21   9/11/26   09/11/2026   2026-09-11
 *   Sep 11   Sept. 11th   September 11   September 11, 2026
 *
 * NUMERIC DATES ARE U.S. MONTH/DAY. "02/21" is February 21st; "21/02" is not a
 * date and is ignored rather than flipped.
 *
 * NO YEAR IS NEEDED. A month and day take the current business year. The form's
 * Date field stays editable, so a manager writing in January about December 30
 * corrects one field rather than being stopped for a year nobody types.
 *
 * "today", "yesterday" and weekdays are deliberately NOT resolved here. "Today"
 * is already what `form_date` defaults to, and the rest were never turned into a
 * calendar date before either.
 */

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

const MONTH_NAME =
  "january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec";

/**
 * Every date shape, one alternative per shape so the match says which it was.
 * The numeric one refuses to start or end inside a longer run of digits and
 * slashes, so "1/2/3/4" and "12345/6" are not read as dates.
 */
const DATE_IN_TEXT = new RegExp(
  [
    String.raw`\b(\d{4})-(\d{2})-(\d{2})\b`,
    String.raw`(?<![\d/])(\d{1,2})\/(\d{1,2})(?:\/(\d{4}|\d{2}))?(?![\d/])`,
    String.raw`\b(${MONTH_NAME})\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b(?:,?\s+(\d{4})\b)?`,
  ].join("|"),
  "gi",
);

/**
 * A date that names the REVIEW, not the incident — "follow up the week of
 * October 5". Kept in step with `FOLLOW_UP_GIVEN` in `epp-intake.ts`.
 */
const FOLLOW_UP_BEFORE =
  /\b(?:week of|follow[- ]?up|followup|re[- ]?eval\w*|revisit|check back|check[- ]?in)\b[^.\n]{0,25}$/i;

/** A real `YYYY-MM-DD` on the calendar — no February 30th. */
export function isIsoCalendarDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  return calendarIso(Number(match[1]), Number(match[2]), Number(match[3])) === value;
}

function calendarIso(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1) return null;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day > daysInMonth) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * The first incident date in the manager's words, as `YYYY-MM-DD`, or null.
 *
 * `today` is the business day (`YYYY-MM-DD`) and supplies the year when the
 * manager gave none. A date marked as a follow-up is skipped, and so is anything
 * that is not a real day ("13/40", "Feb 30").
 */
export function extractFormDate(text: string, today: string): string | null {
  const currentYear = Number(/^(\d{4})-/.exec(today)?.[1]);
  if (!Number.isFinite(currentYear)) return null;

  DATE_IN_TEXT.lastIndex = 0;
  for (const found of (text ?? "").matchAll(DATE_IN_TEXT)) {
    if (FOLLOW_UP_BEFORE.test(text.slice(0, found.index))) continue;

    const [, isoY, isoM, isoD, numM, numD, numY, name, nameD, nameY] = found;
    let iso: string | null = null;

    if (isoY !== undefined) {
      iso = calendarIso(Number(isoY), Number(isoM), Number(isoD));
    } else if (numM !== undefined) {
      const year =
        numY === undefined ? currentYear : numY.length === 2 ? 2000 + Number(numY) : Number(numY);
      iso = calendarIso(year, Number(numM), Number(numD));
    } else if (name !== undefined) {
      const month = MONTHS[name.toLowerCase()];
      if (month !== undefined) {
        iso = calendarIso(nameY === undefined ? currentYear : Number(nameY), month, Number(nameD));
      }
    }

    if (iso !== null) return iso;
  }

  return null;
}
