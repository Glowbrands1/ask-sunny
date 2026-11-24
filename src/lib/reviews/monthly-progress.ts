import { lastFullMonthsWindow, yearStart } from "./reporting-week";
import { reviewDateOf } from "./timeline";
import { googleReviewsToday, GOOGLE_REVIEWS_TIMEZONE } from "./timezone";

/**
 * ============================================================================
 * MONTH BY MONTH: QUALIFYING REVIEWS PER SALON, WITH L3, L6 AND YTD
 * ============================================================================
 *
 * A manager asked to "pull the last three full months so we can get a broader
 * overall understanding and see progress", and then for the figures per
 * month: L3, L6 and YTD. The weekly and month-to-date tiles answer "how are we
 * doing now"; this answers "are we getting better".
 *
 * THE SAME RULE AS MONTH TO DATE, OVER MORE MONTHS. A review is in a month when
 * it COUNTS in that month: counted (a reporting period, never history),
 * qualifying (3 stars and up), and placed by `counted_at` in Central time —
 * exactly what `monthToDateByStore` sums. So this table's current-month column
 * is the goal table's month-to-date figure, and its L3 / L6 / YTD totals are
 * what the Week filter's L3 / L6 / YTD lists.
 *
 *   L3  = the last three FULL months (on Nov 19: Aug, Sep, Oct)
 *   L6  = the last six FULL months (on Nov 19: May – Oct)
 *   YTD = Jan 1 through today, the current partial month included
 *
 * The months shown run from whichever is earlier, Jan or six months back,
 * through the current month, so every total's months are on screen.
 *
 * BEFORE A SALON STARTED COUNTING (Nov 19 2026, on this table: "its 0 … also
 * backfill"). Counting rests on a reporting period, so every month before a
 * salon's `count_by_posted_date_from` (1 Oct 2026 for the estate) read 0
 * although its earlier reviews are held. For those months, and for the month
 * counting began in when it began after the 1st, the figure is the 3–5★
 * reviews Google dates to that month — by Google's own date, or its estimate
 * from "2 months ago", the order `timeline.ts` places reviews in. A review
 * Google gave no date for is left out rather than dated by when ASK Sunny saw
 * it. Those months are flagged `beforeCounting` so the table can say so.
 *
 * Pure: no database, no secret. The read layer hands it rows.
 */

export interface MonthlyProgressRow {
  storeCode: string;
  /** Qualifying reviews per month, in the order of `MonthlyProgress.months`. */
  months: number[];
  /** Per month: true when the figure is reviews Google dates to it, before the salon counted the whole month. */
  beforeCounting: boolean[];
  l3: number;
  l6: number;
  ytd: number;
}

export interface MonthlyProgress {
  /** `yyyy-mm`, oldest first, ending with the current month. */
  months: string[];
  /** The current, partial month: `months[months.length - 1]`. */
  currentMonth: string;
  /** Which `months` each total covers. */
  l3Months: string[];
  l6Months: string[];
  ytdMonths: string[];
  /** One row per store code that was asked for, in the order given. */
  rows: MonthlyProgressRow[];
  /** Every row added up. */
  total: MonthlyProgressRow;
}

/** The first day of the earliest month shown: Jan 1, or six full months back if that is earlier. */
export function monthlyProgressStart(today: string = googleReviewsToday()): string {
  const l6 = lastFullMonthsWindow(6, today).start;
  const jan = yearStart(today);
  return l6 < jan ? l6 : jan;
}

/** `yyyy-mm` of every month from `start` through `today`'s, oldest first. */
export function monthsBetween(start: string, today: string): string[] {
  const out: string[] = [];
  let year = Number(start.slice(0, 4));
  let month = Number(start.slice(5, 7));
  const end = today.slice(0, 7);
  for (;;) {
    const key = `${year}-${String(month).padStart(2, "0")}`;
    out.push(key);
    if (key >= end) break;
    month += 1;
    if (month === 13) {
      month = 1;
      year += 1;
    }
  }
  return out;
}

const CENTRAL_MONTH = new Intl.DateTimeFormat("en-CA", {
  timeZone: GOOGLE_REVIEWS_TIMEZONE,
  year: "numeric",
  month: "2-digit",
});

/** The Central `yyyy-mm` an instant falls in. */
export function centralMonthOf(instant: string): string {
  return CENTRAL_MONTH.format(new Date(instant)).slice(0, 7);
}

/**
 * Buckets counted, qualifying reviews into months per store.
 *
 * `rows` are de-duplicated on the review id, as `monthToDateByStore` does. A
 * row whose month is outside the window, or whose store was not asked for, is
 * ignored rather than counted somewhere else.
 */
/** A held 3–5★ review with the dates Google gave for it. */
export interface PostedReviewRow {
  id: string;
  store_code: string;
  google_absolute_date: string | null;
  google_estimated_at: string | null;
}

/** The first `yyyy-mm` a salon counted in full, from the instant it started counting; null when it is not counting. */
export function firstFullCountedMonth(countingFrom: string | null): string | null {
  if (!countingFrom) return null;
  const day = googleReviewsToday(new Date(countingFrom));
  if (day.endsWith("-01")) return day.slice(0, 7);
  return monthsBetween(day, shiftMonth(day, 1))[1] ?? null;
}

function shiftMonth(day: string, by: number): string {
  const index = Number(day.slice(0, 4)) * 12 + Number(day.slice(5, 7)) - 1 + by;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}-01`;
}

export function monthlyProgress(
  rows: readonly { id: string; store_code: string; counted_at: string }[],
  storeCodes: readonly string[],
  today: string = googleReviewsToday(),
  before: {
    /** Every held 3–5★ review, counted or historical. */
    posted: readonly PostedReviewRow[];
    /** Per store code, when it started counting by posted date (null: not counting). */
    countingFrom: ReadonlyMap<string, string | null>;
  } = { posted: [], countingFrom: new Map() },
): MonthlyProgress {
  const months = monthsBetween(monthlyProgressStart(today), today);
  const currentMonth = months[months.length - 1];
  const fullMonths = months.slice(0, -1);
  const l3Months = fullMonths.slice(-3);
  const l6Months = fullMonths.slice(-6);
  const ytdMonths = months.filter((month) => month.startsWith(today.slice(0, 4)));

  const index = new Map(months.map((month, position) => [month, position]));
  const counts = new Map(storeCodes.map((code) => [code, months.map(() => 0)]));

  for (const row of new Map(rows.map((entry) => [entry.id, entry])).values()) {
    const perMonth = counts.get(row.store_code);
    const position = index.get(centralMonthOf(row.counted_at));
    if (perMonth && position !== undefined) perMonth[position] += 1;
  }

  const sumOver = (perMonth: number[], subset: string[]) =>
    subset.reduce((total, month) => total + perMonth[index.get(month)!], 0);
  const toRow = (storeCode: string, perMonth: number[]): Omit<MonthlyProgressRow, "beforeCounting"> => ({
    storeCode,
    months: perMonth,
    l3: sumOver(perMonth, l3Months),
    l6: sumOver(perMonth, l6Months),
    ytd: sumOver(perMonth, ytdMonths),
  });

  /* Reviews Google dates to each month, per store: only for the months before counting. */
  const posted = new Map(storeCodes.map((code) => [code, months.map(() => 0)]));
  for (const row of new Map(before.posted.map((entry) => [entry.id, entry])).values()) {
    const perMonth = posted.get(row.store_code);
    const dated = reviewDateOf({
      googleAbsoluteDate: row.google_absolute_date,
      googleEstimatedAt: row.google_estimated_at,
      // Never dated by when ASK Sunny saw it: an empty value is skipped.
      firstSeenAt: "",
    });
    if (!perMonth || !dated || dated.source === "first_seen") continue;
    const position = index.get(dated.date.slice(0, 7));
    if (position !== undefined) perMonth[position] += 1;
  }

  const rowsOut = storeCodes.map((code) => {
    const known = before.countingFrom.has(code);
    const firstFull = firstFullCountedMonth(before.countingFrom.get(code) ?? null);
    // Not told when a store started counting: its counted figures stand for every month, as before.
    const beforeCounting = months.map((month) => known && (firstFull === null || month < firstFull));
    const perMonth = counts.get(code)!.map((count, position) =>
      beforeCounting[position] ? posted.get(code)![position] : count,
    );
    return { ...toRow(code, perMonth), beforeCounting };
  });
  const totalPerMonth = months.map((_, position) =>
    rowsOut.reduce((total, row) => total + row.months[position], 0),
  );

  return {
    months,
    currentMonth,
    l3Months,
    l6Months,
    ytdMonths,
    rows: rowsOut,
    total: {
      ...toRow("all", totalPerMonth),
      beforeCounting: months.map((_, position) => rowsOut.some((row) => row.beforeCounting[position])),
    },
  };
}

/** "Oct" or, for a January or when asked, "Jan 2026". */
export function formatProgressMonth(month: string, withYear = false): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    ...(withYear ? { year: "numeric" } : {}),
    timeZone: "UTC",
  }).format(new Date(`${month}-01T00:00:00Z`));
}
