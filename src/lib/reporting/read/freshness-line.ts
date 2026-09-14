/**
 * ============================================================================
 * ONE FRESHNESS LINE, ON EVERY REPORT
 * ============================================================================
 *
 * The 14 September review asked for this format, verbatim:
 *
 *   Data through September 12, 2026 | Refreshed September 13 at 6:00 a.m. CT |
 *   15 salons included | Updated daily
 *
 * "This should replace the current row of four chips, which is harder to scan
 *  and inconsistent from tab to tab. The cadence should reflect the actual
 *  schedule for each report."
 *
 * FOUR FACTS, AND EVERY ONE IS MEASURED. The data-through date and the refresh
 * instant come from the report's own stored metadata, the salon count is
 * counted from the live rows, and the cadence is declared per report family.
 * Nothing here is a constant and nothing is a hard-coded date — the review's
 * own example dates appear nowhere in this module or its tests as values.
 *
 * ============================================================================
 * CENTRAL TIME, THROUGH THE IANA ZONE
 * ============================================================================
 *
 * "Times are displaying in UTC. Salon Performance currently reads 'Loaded Sep
 *  11, 2026, 12:50 PM UTC', which is 7:50 a.m. our time. Everything should
 *  display in Central Time. No one should have to convert it."
 *
 * `America/Chicago`, NOT a fixed offset. Central is UTC-6 in winter and UTC-5
 * in summer, so subtracting a constant is right for half the year and an hour
 * wrong for the other half — and wrong in the direction that makes a 6:00 a.m.
 * delivery read as 5:00 a.m., which is before the report exists. The zone
 * database knows when the transition is; nothing here needs to.
 *
 * A DATE IS NOT AN INSTANT, and the two are formatted differently on purpose.
 * "Data through 2026-09-12" is a calendar date the source wrote — it has no
 * time and no zone, so it is rendered from its own parts and never passed
 * through a timezone conversion that could move it a day. The refresh stamp IS
 * an instant, and is converted.
 */

/** The one timezone every user-facing timestamp is rendered in. */
export const REPORTING_TIME_ZONE = "America/Chicago";

/** How often a report family is delivered. */
export type ReportCadence = "daily" | "weekly" | "monthly";

export const CADENCE_LABEL: Readonly<Record<ReportCadence, string>> = {
  daily: "Updated daily",
  weekly: "Updated weekly",
  monthly: "Updated monthly",
};

export interface FreshnessFacts {
  /**
   * The last date the figures cover, as `yyyy-mm-dd`.
   *
   * A CALENDAR DATE, not an instant. Null when the report did not record one,
   * which is a real state and reads as "not recorded" rather than as today.
   */
  readonly dataThrough: string | null;
  /** ISO instant the delivery was ingested. Null when not recorded. */
  readonly refreshedAt: string | null;
  /** Salons the figures actually cover. Counted, never asserted. */
  readonly salonCount: number | null;
  readonly cadence: ReportCadence;
  /**
   * Set when the reader sees fewer salons than the report holds because of
   * their own assignment, so the count can say whose salons it is counting
   * rather than implying the delivery only carried that many.
   */
  readonly scopeLabel?: string | null;
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/**
 * `2026-09-12` -> `September 12, 2026`.
 *
 * FROM THE PARTS, NOT THROUGH A DATE OBJECT. `new Date("2026-09-12")` is
 * midnight UTC, and rendering that in Central Time gives 11 September — the
 * report's own data-through date, moved back a day, on every page that shows
 * it. A calendar date has no zone and must not acquire one.
 */
export function formatDataThrough(date: string | null): string | null {
  if (!date) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  if (!match) return null;
  const [, year, month, day] = match;
  const monthName = MONTHS[Number(month) - 1];
  if (!monthName) return null;
  return `${monthName} ${Number(day)}, ${year}`;
}

/**
 * An ISO instant -> `September 13 at 6:00 a.m. CT`.
 *
 * The year is omitted deliberately: this answers "how recently", and a reader
 * checking freshness is reading the month and the hour. The data-through date
 * beside it carries the year for both.
 */
export function formatRefreshedAt(instant: string | null): string | null {
  if (!instant) return null;
  const date = new Date(instant);
  if (Number.isNaN(date.getTime())) return null;

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: REPORTING_TIME_ZONE,
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(date);

  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";

  /*
   * `a.m.` rather than `AM`, which is the form the review wrote and the form a
   * manager reads. `Intl` gives "AM"/"PM" (or a narrow "am"), so it is
   * normalised here rather than assumed.
   */
  const meridiem = value("dayPeriod").toLowerCase().replace(/\./g, "") === "pm"
    ? "p.m."
    : "a.m.";

  return `${value("month")} ${value("day")} at ${value("hour")}:${value("minute")} ${meridiem} CT`;
}

/** `15 salons included`, or a scoped equivalent. */
export function formatSalonCount(
  salonCount: number | null,
  scopeLabel?: string | null,
): string | null {
  if (salonCount === null || !Number.isFinite(salonCount) || salonCount < 0) return null;
  const salons = `${salonCount} ${salonCount === 1 ? "salon" : "salons"}`;
  /*
   * A RESTRICTED READER IS TOLD WHOSE SALONS THESE ARE. "1 salon included" on
   * a fifteen-salon delivery reads as a broken report; "MO Kansas City Wornall
   * · 1 salon" reads as an assignment, which is what it is.
   */
  return scopeLabel ? `${scopeLabel} · ${salons}` : `${salons} included`;
}

/**
 * The whole line, assembled from whatever is actually known.
 *
 * A SEGMENT WITH NOTHING BEHIND IT IS OMITTED RATHER THAN FILLED. "Refreshed —"
 * or "Data through unknown" is worse than a shorter line: it draws the eye to a
 * gap and says nothing about it. The cadence is always present, because it is
 * declared rather than measured and is the segment that tells a manager whether
 * August data on a monthly report is stale or simply current.
 */
export function freshnessSegments(facts: FreshnessFacts): string[] {
  const dataThrough = formatDataThrough(facts.dataThrough);
  const refreshed = formatRefreshedAt(facts.refreshedAt);
  const salons = formatSalonCount(facts.salonCount, facts.scopeLabel ?? null);

  return [
    dataThrough ? `Data through ${dataThrough}` : null,
    refreshed ? `Refreshed ${refreshed}` : null,
    salons,
    CADENCE_LABEL[facts.cadence],
  ].filter((segment): segment is string => segment !== null);
}

/** The line as one string, for a prompt, a test or a plain-text surface. */
export function freshnessLine(facts: FreshnessFacts): string {
  return freshnessSegments(facts).join(" | ");
}

/**
 * ============================================================================
 * IS THIS THE MOST RECENTLY COMPLETED MONTH, OR IS IT STALE?
 * ============================================================================
 *
 * THE REVIEW, on Bed Usage: "Clearly identify whether the data is current
 * through the most recently completed month so managers do not assume it is
 * outdated." And, on cadence generally: "Right now, there is no way for a
 * manager to know whether August data on Bed Usage is stale or whether August
 * is simply the most recently released report. That distinction matters."
 *
 * A DATE ALONE CANNOT ANSWER IT. "Data through 31 August" read on 14 September
 * is either perfectly current (the August report, delivered in early September)
 * or a month late (September's has not arrived), and the difference is not in
 * the date — it is in the relationship between the date and today.
 *
 * SO THIS COMPARES, AND SAYS WHICH. Three answers and no fourth: the period
 * ends on the last day of the most recently completed month (current), it ends
 * earlier than that (a delivery is missing), or the question does not apply.
 *
 * NOTHING IS INFERRED ABOUT WHY. A missing delivery is reported as a missing
 * delivery; this does not guess whether the source is late, the mailbox is
 * blocked or the month is simply not published yet, because the report has no
 * way to know and a wrong guess sends somebody to the wrong person.
 */
export type MonthlyCurrency =
  /** Covers the most recently completed month. As current as monthly gets. */
  | "current"
  /** Covers an earlier month; at least one delivery has not arrived. */
  | "behind"
  /** Not a completed-month question — a partial month, or an unusable date. */
  | "not_applicable";

export interface MonthlyCurrencyReading {
  readonly state: MonthlyCurrency;
  /** One sentence for the reader. Null when there is nothing to say. */
  readonly note: string | null;
  /** How many whole months behind, when it is behind. */
  readonly monthsBehind: number;
}

/** The last day of the month before `today`. Both are `yyyy-mm-dd`. */
function lastCompletedMonthEnd(today: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(today.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  // The month before this one, and its own last day.
  const priorMonth = month === 1 ? 12 : month - 1;
  const priorYear = month === 1 ? year - 1 : year;
  // Day 0 of the NEXT month is the last day of this one.
  const day = new Date(Date.UTC(priorYear, priorMonth, 0)).getUTCDate();
  return { year: priorYear, month: priorMonth, day };
}

export function monthlyCurrency(
  /** The period's last day, `yyyy-mm-dd`. */
  dataThrough: string | null,
  /** Today's business date, `yyyy-mm-dd`. Passed in, never read from a clock. */
  today: string,
): MonthlyCurrencyReading {
  const none: MonthlyCurrencyReading = {
    state: "not_applicable",
    note: null,
    monthsBehind: 0,
  };

  const period = /^(\d{4})-(\d{2})-(\d{2})$/.exec((dataThrough ?? "").trim());
  const completed = lastCompletedMonthEnd(today);
  if (!period || !completed) return none;

  const periodYear = Number(period[1]);
  const periodMonth = Number(period[2]);
  const periodDay = Number(period[3]);

  /*
   * A PARTIAL MONTH IS NOT A LATE ONE. A month-to-date window ending on the
   * 12th is exactly what it says it is, and calling it "behind" would report a
   * working report as broken.
   */
  const lastDayOfPeriodMonth = new Date(Date.UTC(periodYear, periodMonth, 0)).getUTCDate();
  if (periodDay !== lastDayOfPeriodMonth) return none;

  const monthsBehind =
    (completed.year - periodYear) * 12 + (completed.month - periodMonth);

  if (monthsBehind <= 0) {
    return {
      state: "current",
      note: "This is the most recently completed month, so it is as current as a monthly report gets.",
      monthsBehind: 0,
    };
  }

  return {
    state: "behind",
    note: `The most recently completed month is ${MONTHS[completed.month - 1]} ${completed.year}, so ${
      monthsBehind === 1 ? "one delivery has" : `${monthsBehind} deliveries have`
    } not arrived. These figures are not the newest month.`,
    monthsBehind,
  };
}
