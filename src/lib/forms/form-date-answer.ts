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
    /*
     * "10-05-2026" and "10-5-26": U.S. month-day-year with dashes. The YEAR IS
     * REQUIRED, unlike the slashed form, because "10-12" on its own is far more
     * often a range ("10-12 hours") than a date.
     */
    String.raw`(?<![\d-])(\d{1,2})-(\d{1,2})-(\d{4}|\d{2})(?![\d-])`,
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

/**
 * A date that names an EARLIER STEP, not this form — "got a verbal warning on
 * september 21", "was coached on 9/2", "previous corrective action 8/15".
 * Production: "create ca for paulyne co she was late today, got verbal warning
 * on september 21" dated the new Corrective Action Form September 21, the day
 * of the PRIOR warning. Read within the date's own clause, and only with a
 * past-tense or "previous/prior/already" marker, so "give her a written
 * warning on 10/2" — an instruction about this form — is not affected.
 */
const PRIOR_STEP_BEFORE =
  /\b(?:got|gotten|received|was given|were given|been given|given|had|issued|gave|was|were|previous(?:ly)?|prior|already|last time)\b[^.;\n]{0,40}\b(?:warn(?:ing|ings|ed)|write[- ]?ups?|written up|coach(?:ed|ing)?|corrective actions?|disciplin\w*)\b[^.;\n]{0,20}$/i;

function isOtherDate(text: string, index: number): boolean {
  const before = text.slice(0, index);
  return FOLLOW_UP_BEFORE.test(before) || PRIOR_STEP_BEFORE.test(before);
}

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

/** A calendar date found in text, with where it sits. */
export interface DateInText {
  /** `YYYY-MM-DD`. */
  iso: string;
  /** Offset of the first character of the match. */
  index: number;
  /** Offset just past the match. */
  end: number;
}

/**
 * EVERY real calendar date in the text, in order, in the shapes listed at the
 * top of this file.
 *
 * The one reader of those shapes. `extractFormDate` takes the first that is not
 * a follow-up; the exit form's reader (`exit-facts.ts`) decides which of them is
 * the last day worked and which the notice dates. Two copies of this pattern is
 * how "9/11" would come to mean September on one form and nothing on another.
 *
 * `today` is the business day (`YYYY-MM-DD`) and supplies the year when the
 * manager gave none. Anything that is not a real day ("13/40", "Feb 30") is
 * skipped rather than reported.
 */
export function datesInText(text: string, today: string): DateInText[] {
  const currentYear = Number(/^(\d{4})-/.exec(today)?.[1]);
  if (!Number.isFinite(currentYear)) return [];

  const found: DateInText[] = [];
  DATE_IN_TEXT.lastIndex = 0;
  for (const match of (text ?? "").matchAll(DATE_IN_TEXT)) {
    const [, isoY, isoM, isoD, slashM, slashD, slashY, dashM, dashD, dashY, name, nameD, nameY] =
      match;
    // The slashed and the dashed U.S. shapes read the same way.
    const numM = slashM ?? dashM;
    const numD = slashD ?? dashD;
    const numY = slashY ?? dashY;
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

    if (iso !== null) {
      const index = match.index ?? 0;
      found.push({ iso, index, end: index + match[0].length });
    }
  }
  return found;
}

/**
 * The first incident date in the manager's words, as `YYYY-MM-DD`, or null.
 *
 * `today` is the business day (`YYYY-MM-DD`) and supplies the year when the
 * manager gave none. A date marked as a follow-up or as an earlier step (see
 * `PRIOR_STEP_BEFORE`) is skipped, and so is anything that is not a real day
 * ("13/40", "Feb 30").
 */
export function extractFormDate(text: string, today: string): string | null {
  for (const found of datesInText(text, today)) {
    if (isOtherDate(text, found.index)) continue;
    return found.iso;
  }
  return null;
}

/**
 * The dates that are not follow-ups, with where each was found — for a caller
 * that tells dates apart by the words in front of them ("effective oct 5"
 * versus the form's own date). `extractFormDate` is this list's first entry.
 */
export function listFormDates(text: string, today: string): { iso: string; index: number }[] {
  return datesInText(text, today)
    .filter((found) => !isOtherDate(text, found.index))
    .map(({ iso, index }) => ({ iso, index }));
}
