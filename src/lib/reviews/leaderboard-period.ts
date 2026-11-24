import {
  isMonthWeek,
  WEEK_LAST_SIX_MONTHS,
  WEEK_LAST_THREE_MONTHS,
  WEEK_MONTH,
  WEEK_YEAR_TO_DATE,
} from "./filters";
import type { ReviewGoalContext } from "./goal";
import { monthlyProgressStart, monthsBetween, type MonthlyProgress } from "./monthly-progress";
import { googleReviewsToday } from "./timezone";
import type { LocationRollup } from "./types";

/**
 * ============================================================================
 * THE SALON LEADERBOARD'S PERIOD: THIS MONTH, L3, L6 OR YTD
 * ============================================================================
 *
 * Pau, 23 Nov 2026: "they dont want week, they want per month, per 3 months
 * per 6 months and YTD pls and then let it show in the data below". The board
 * ranks by one of four windows, chosen with the toolbar's Period control (the
 * same `week` URL value the records view reads, so a figure's link and the
 * list it opens agree):
 *
 *   This month = month to date, against the monthly target, with the pace mark
 *   L3         = the last three full months, against target × 3
 *   L6         = the last six full months, against target × 6
 *   YTD        = Jan 1 to today, against target × the months so far this year
 *
 * ONE MONTH (Pau, 23 Nov 2026: "pls add the per month for both like September
 * october november"). Each full month the Month by month table shows can be
 * picked on its own, `yyyy-mm` in the URL, against the monthly target. The
 * current month is "This month to date".
 *
 * L3 / L6 / YTD and single months are the Month by month table's own figures
 * (`monthly-progress.ts`), never recounted here. A closed window has no pace: a salon has met it or it
 * has not, so those periods are "Goal met" or "Below goal".
 *
 * Pure: no database. It reshapes the rollups so the board's ranking, bar and
 * summary read the chosen figure through the same functions as the month.
 */

/** A rolling window, or one full calendar month as `yyyy-mm`. */
export type LeaderboardPeriod = "month" | "l3" | "l6" | "ytd" | `${number}-${number}`;

type RollingPeriod = "month" | "l3" | "l6" | "ytd";

export const LEADERBOARD_PERIODS: readonly { key: RollingPeriod; week: string; label: string }[] = [
  { key: "month", week: WEEK_MONTH, label: "This month to date" },
  { key: "l3", week: WEEK_LAST_THREE_MONTHS, label: "L3 · last 3 full months" },
  { key: "l6", week: WEEK_LAST_SIX_MONTHS, label: "L6 · last 6 full months" },
  { key: "ytd", week: WEEK_YEAR_TO_DATE, label: "YTD · year to date" },
];

/** True when the period is one full calendar month. */
export function isSingleMonthPeriod(period: LeaderboardPeriod): period is `${number}-${number}` {
  return isMonthWeek(period);
}

/**
 * The full months the Period control offers, newest first: every month the
 * Month by month table shows except the current one (that is This month to
 * date).
 */
export function leaderboardMonths(today: string = googleReviewsToday()): string[] {
  return monthsBetween(monthlyProgressStart(today), today).slice(0, -1).reverse();
}

const LONG_MONTH = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

/** "October 2026" for `2026-10`. */
export function formatLongMonth(month: string): string {
  return LONG_MONTH.format(new Date(`${month}-01T00:00:00Z`));
}

/**
 * The board's period for a `week` URL value. A `yyyy-mm` is that month (the
 * current month is This month to date); a weekly link or anything else is This
 * month. A month the Month by month table does not hold is reported by the view.
 */
export function leaderboardPeriodOf(
  week: string,
  today: string = googleReviewsToday(),
): LeaderboardPeriod {
  if (isMonthWeek(week)) {
    return week === today.slice(0, 7) ? "month" : (week as LeaderboardPeriod);
  }
  return LEADERBOARD_PERIODS.find((entry) => entry.week === week)?.key ?? "month";
}

export function leaderboardPeriodWeek(period: LeaderboardPeriod): string {
  if (isSingleMonthPeriod(period)) return period;
  return LEADERBOARD_PERIODS.find((entry) => entry.key === period)!.week;
}

/** "L3 · last 3 full months", or "October 2026" for one month. */
export function leaderboardPeriodLabel(period: LeaderboardPeriod): string {
  if (isSingleMonthPeriod(period)) return formatLongMonth(period);
  return LEADERBOARD_PERIODS.find((entry) => entry.key === period)!.label;
}

export interface LeaderboardPeriodView {
  period: LeaderboardPeriod;
  /** The rollups with `qualifyingMonthToDate` holding the period's figure. */
  locations: LocationRollup[];
  /** The goal over the period. Closed windows carry no pace (`paceTarget` 0). */
  goal: ReviewGoalContext;
  /** Months the period covers (1 for this month). */
  months: number;
  /** True while the period has a pace mark and an "On pace" / "Behind pace" status. */
  paced: boolean;
  /** `yyyy-mm` of every month covered, for the caption; empty for this month. */
  monthKeys: string[];
  /**
   * One month only: true when some salon's figure is the reviews Google dates
   * to that month, because the salon had not started counting for all of it.
   */
  beforeCounting: boolean;
}

/**
 * The board's figures for a period. Null when the period needs the
 * month-by-month figures and they could not be read: the caller says so rather
 * than ranking every salon on 0.
 */
export function leaderboardPeriodView(
  period: LeaderboardPeriod,
  locations: LocationRollup[],
  goal: ReviewGoalContext,
  monthly: MonthlyProgress | null,
): LeaderboardPeriodView | null {
  if (period === "month") {
    return { period, locations, goal, months: 1, paced: true, monthKeys: [], beforeCounting: false };
  }
  if (!monthly) return null;

  if (isSingleMonthPeriod(period)) {
    const index = monthly.months.indexOf(period);
    if (index < 0 || period === monthly.currentMonth) return null;
    const byCode = new Map(monthly.rows.map((row) => [row.storeCode, row]));
    return {
      period,
      locations: locations.map((location) => ({
        ...location,
        qualifyingMonthToDate: byCode.get(location.storeCode)?.months[index] ?? 0,
      })),
      goal: { ...goal, paceTarget: 0 },
      months: 1,
      paced: false,
      monthKeys: [period],
      beforeCounting: locations.some(
        (location) => byCode.get(location.storeCode)?.beforeCounting[index] === true,
      ),
    };
  }

  const monthKeys =
    period === "l3" ? monthly.l3Months : period === "l6" ? monthly.l6Months : monthly.ytdMonths;
  const byCode = new Map(monthly.rows.map((row) => [row.storeCode, row]));
  return {
    period,
    locations: locations.map((location) => ({
      ...location,
      qualifyingMonthToDate: byCode.get(location.storeCode)?.[period] ?? 0,
    })),
    goal: { ...goal, target: goal.target * monthKeys.length, paceTarget: 0 },
    months: monthKeys.length,
    paced: false,
    monthKeys,
    beforeCounting: false,
  };
}
