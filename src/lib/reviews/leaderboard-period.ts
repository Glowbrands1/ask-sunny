import {
  WEEK_LAST_SIX_MONTHS,
  WEEK_LAST_THREE_MONTHS,
  WEEK_MONTH,
  WEEK_YEAR_TO_DATE,
} from "./filters";
import type { ReviewGoalContext } from "./goal";
import type { MonthlyProgress } from "./monthly-progress";
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
 * L3 / L6 / YTD are the Month by month table's own totals (`monthly-progress.ts`),
 * never recounted here. A closed window has no pace: a salon has met it or it
 * has not, so those periods are "Goal met" or "Below goal".
 *
 * Pure: no database. It reshapes the rollups so the board's ranking, bar and
 * summary read the chosen figure through the same functions as the month.
 */

export type LeaderboardPeriod = "month" | "l3" | "l6" | "ytd";

export const LEADERBOARD_PERIODS: readonly { key: LeaderboardPeriod; week: string; label: string }[] = [
  { key: "month", week: WEEK_MONTH, label: "This month to date" },
  { key: "l3", week: WEEK_LAST_THREE_MONTHS, label: "L3 · last 3 full months" },
  { key: "l6", week: WEEK_LAST_SIX_MONTHS, label: "L6 · last 6 full months" },
  { key: "ytd", week: WEEK_YEAR_TO_DATE, label: "YTD · year to date" },
];

/** The board's period for a `week` URL value. Anything that is not L3, L6 or YTD is the month. */
export function leaderboardPeriodOf(week: string): LeaderboardPeriod {
  return LEADERBOARD_PERIODS.find((entry) => entry.week === week)?.key ?? "month";
}

export function leaderboardPeriodWeek(period: LeaderboardPeriod): string {
  return LEADERBOARD_PERIODS.find((entry) => entry.key === period)!.week;
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
  /** `yyyy-mm` of the first and last month covered, for the caption; null for this month. */
  monthKeys: string[];
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
    return { period, locations, goal, months: 1, paced: true, monthKeys: [] };
  }
  if (!monthly) return null;

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
  };
}
