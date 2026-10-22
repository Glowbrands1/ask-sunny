import { monthStart as monthStartOf } from "./reporting-week";
import type { LocationRollup } from "./types";

/**
 * ============================================================================
 * THE MONTHLY GOOGLE REVIEW GOAL
 * ============================================================================
 *
 * TEN QUALIFYING REVIEWS PER SALON PER CALENDAR MONTH. The business set this
 * (Gwen Harlan, October 2026), which is what lets the dashboard draw a
 * target and a meter at last: the earlier screens refused to, because no goal
 * had been agreed and a progress bar against an invented number is a figure a
 * manager ends up quoting.
 *
 * ONE APP-WIDE DEFAULT, NO SCHEMA. The figure is the same for every salon, so
 * it is a constant here with a server-side override in the environment rather
 * than a column nobody would ever set differently. A per-salon goal would arrive
 * as data and replace `target` below; nothing that reads the context would
 * change.
 *
 * ============================================================================
 * WHAT COUNTS TOWARD IT
 * ============================================================================
 *
 * EXACTLY WHAT COUNTS TOWARD THE WEEKLY NUMBER, over a different window. A
 * qualifying review is a 3-, 4- or 5-star review (`eligible_for_weekly_count`,
 * generated in the database from the rating) that has been COUNTED INTO A
 * REPORTING PERIOD — from 1 October 2026, the week Google says it was posted;
 * before then, only once it was proven to sit above its listing's anchor.
 * 1- and 2-star reviews and the imported backlog never count.
 *
 * A LISTING WITH NO ANCHOR IS "NOT COUNTING". `counted_through_external_review_id`
 * is null, so nothing about it has been measured; it stays on screen, it is
 * never ranked, and it is left out of every aggregate that compares against
 * the goal. A zero beside it would read as a bad month rather than as no data.
 *
 * Client-safe: no database client, no secret, no `server-only` import.
 */

export const DEFAULT_MONTHLY_REVIEW_GOAL = 10;

/** The server-side override. A positive whole number; anything else is ignored. */
export const MONTHLY_REVIEW_GOAL_ENV = "GOOGLE_REVIEWS_MONTHLY_GOAL";

/** The configured goal, or the default when the override is absent or malformed. */
export function monthlyReviewGoal(raw: string | undefined | null): number {
  const value = raw?.trim() ?? "";
  if (!/^\d{1,4}$/.test(value)) return DEFAULT_MONTHLY_REVIEW_GOAL;
  const goal = Number(value);
  return goal >= 1 ? goal : DEFAULT_MONTHLY_REVIEW_GOAL;
}

/* ============================================================ the month == */

/**
 * Everything the screen needs to know about where the month is.
 *
 * Built once on the server from the Central reporting date and handed to the
 * page, so every tile, row and caption reads the same "today".
 */
export interface ReviewGoalContext {
  /** Qualifying reviews each salon is asked for this month. */
  target: number;
  /** `yyyy-mm-01`, Central. */
  monthStart: string;
  /** The reporting date, Central. Month to date runs through the end of it. */
  today: string;
  dayOfMonth: number;
  daysInMonth: number;
  /** Whole days of the month already finished before today began. */
  daysElapsed: number;
  /**
   * HOW MANY A SALON NEEDS BY NOW TO FINISH THE MONTH ON TARGET.
   *
   * A straight line from zero on the 1st to the target at the end of the last
   * day, read at the close of the most recent finished day and rounded up. Read
   * at the close of YESTERDAY rather than of today so the meter never calls a
   * salon behind on the morning of the 1st, or for a review it still has the
   * rest of today to earn.
   *
   * IT IS A PACE, NOT AN ACHIEVEMENT. "On pace" says the month is on course;
   * only reaching `target` is "Goal met", and the two are never the same chip.
   */
  paceTarget: number;
}

export function daysInMonthOf(date: string): number {
  const [year, month] = date.split("-").map(Number);
  /* Day 0 of the next month is the last day of this one. */
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function paceTargetFor(target: number, daysElapsed: number, daysInMonth: number): number {
  if (daysInMonth <= 0) return 0;
  const elapsed = Math.min(Math.max(daysElapsed, 0), daysInMonth);
  return Math.ceil((target * elapsed) / daysInMonth);
}

export function goalContext(today: string, target: number): ReviewGoalContext {
  const dayOfMonth = Number(today.slice(8, 10));
  const daysInMonth = daysInMonthOf(today);
  const daysElapsed = dayOfMonth - 1;
  return {
    target,
    monthStart: monthStartOf(today),
    today,
    dayOfMonth,
    daysInMonth,
    daysElapsed,
    paceTarget: paceTargetFor(target, daysElapsed, daysInMonth),
  };
}

/*
 * LABELS FOR A PERSON. `timeZone: "UTC"` because the inputs are calendar dates
 * already decided in Central — the same reasoning as `formatWeekRange`.
 */
const SHORT_DATE = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});
const MONTH_NAME = new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC" });

/** "October". */
export function formatGoalMonth(context: Pick<ReviewGoalContext, "monthStart">): string {
  return MONTH_NAME.format(new Date(`${context.monthStart}T00:00:00Z`));
}

/** "Oct 1 – Oct 12": the window every month-to-date figure covers. */
export function formatMonthToDate(context: Pick<ReviewGoalContext, "monthStart" | "today">): string {
  const start = SHORT_DATE.format(new Date(`${context.monthStart}T00:00:00Z`));
  const end = SHORT_DATE.format(new Date(`${context.today}T00:00:00Z`));
  return start === end ? start : `${start} – ${end}`;
}

/* ======================================================= month to date === */

/**
 * ============================================================================
 * QUALIFYING REVIEWS THIS CALENDAR MONTH, PER LISTING
 * ============================================================================
 *
 * FROM THE 1ST, CENTRAL, THROUGH TODAY, by the instant each counted review
 * counts AT — `counted_at` in `google_reviews_enriched`:
 *
 *   - when Google says it was POSTED, for a review counted by posted date
 *     (every listing from 1 October 2026 — see
 *     `20261020001100_google_review_count_by_posted_date.sql`). This is the
 *     figure a manager can check against their own Google listing;
 *   - when it was FIRST SEEN, for a review the anchor counted before then.
 *     First seen is the floor of when that sync ran, so such a review keeps
 *     the month it was always credited to and no figure already shown moves.
 *
 * The read layer selects the counted, qualifying reviews in that window and
 * hands their rows here. They are de-duplicated on the review id — Google's id
 * is already the key upstream, so this only guards a read that repeats a row —
 * and counted per store code, which is unique per listing.
 *
 * 1- and 2-star reviews and history counted nowhere never reach this function:
 * the read filters on `eligible_for_weekly_count` and a non-null period.
 */
export function monthToDateByStore(
  rows: readonly { id: string; store_code: string }[],
): Map<string, number> {
  const byStore = new Map<string, number>();
  for (const row of new Map(rows.map((entry) => [entry.id, entry])).values()) {
    byStore.set(row.store_code, (byStore.get(row.store_code) ?? 0) + 1);
  }
  return byStore;
}

/* ===================================================== status and rank === */

export type GoalStatus = "met" | "on_pace" | "behind_pace" | "not_counting";

export function isCounting(location: Pick<LocationRollup, "anchorReviewId">): boolean {
  return location.anchorReviewId !== null;
}

export function goalStatus(
  location: Pick<LocationRollup, "anchorReviewId" | "qualifyingMonthToDate">,
  context: Pick<ReviewGoalContext, "target" | "paceTarget">,
): GoalStatus {
  if (!isCounting(location)) return "not_counting";
  if (location.qualifyingMonthToDate >= context.target) return "met";
  if (location.qualifyingMonthToDate >= context.paceTarget) return "on_pace";
  return "behind_pace";
}

export const GOAL_STATUS_LABEL: Record<GoalStatus, string> = {
  met: "Goal met",
  on_pace: "On pace",
  behind_pace: "Behind pace",
  not_counting: "Not counting",
};

export interface GoalProgress {
  /** Of the target, unrounded above 100: 12 of 10 is 120. */
  percent: number;
  /** The same figure capped at 100, for the width of a bar. */
  barPercent: number;
  remaining: number;
  over: number;
}

export function goalProgress(monthToDate: number, target: number): GoalProgress {
  const percent = target > 0 ? Math.round((monthToDate / target) * 100) : 0;
  return {
    percent,
    barPercent: Math.min(100, Math.max(0, percent)),
    remaining: Math.max(0, target - monthToDate),
    over: Math.max(0, monthToDate - target),
  };
}

export type RankMetric = "month" | "week";

export interface RankedLocation {
  location: LocationRollup;
  /** Competition rank (1, 2, 2, 4). Null for a listing that is not counting. */
  rank: number | null;
  tied: boolean;
}

/**
 * THE LEADERBOARD ORDER.
 *
 * Counting listings by the chosen figure, highest first, with STANDARD
 * COMPETITION RANKING — two salons on 8 are both 5th and the next is 7th, so a
 * rank never says one of two equal salons beat the other. Within a tie the
 * other figure and then the name settle the drawing order, which carries no
 * rank of its own. Listings that are not counting follow, unranked, by name.
 */
export function rankLocations(
  locations: LocationRollup[],
  metric: RankMetric,
): RankedLocation[] {
  const primary = (entry: LocationRollup) =>
    metric === "month" ? entry.qualifyingMonthToDate : entry.qualifyingThisWeek;
  const secondary = (entry: LocationRollup) =>
    metric === "month" ? entry.qualifyingThisWeek : entry.qualifyingMonthToDate;

  const counting = locations
    .filter(isCounting)
    .sort(
      (a, b) =>
        primary(b) - primary(a) ||
        secondary(b) - secondary(a) ||
        a.locationName.localeCompare(b.locationName),
    );

  const ranked = counting.map((location) => ({
    location,
    rank: 1 + counting.filter((other) => primary(other) > primary(location)).length,
    tied: counting.some((other) => other !== location && primary(other) === primary(location)),
  }));

  const uncounted = locations
    .filter((entry) => !isCounting(entry))
    .sort((a, b) => a.locationName.localeCompare(b.locationName))
    .map((location) => ({ location, rank: null, tied: false }));

  return [...ranked, ...uncounted];
}

/* ========================================================== roll-ups ==== */

export interface GoalSummary {
  /** Listings in view with an anchor — the only ones the figures below cover. */
  counting: number;
  notCounting: number;
  qualifyingThisWeek: number;
  qualifyingLastWeek: number;
  qualifyingMonthToDate: number;
  /** `target` for each counting listing. */
  combinedTarget: number;
  atGoal: number;
  onPace: number;
  behindPace: number;
  /**
   * What it would take to bring every counting listing up to target. One
   * salon's overage does not cover another's shortfall, so this is the sum of
   * each listing's own remainder rather than the combined target less the total.
   */
  stillNeeded: number;
}

export function goalSummary(
  locations: LocationRollup[],
  context: Pick<ReviewGoalContext, "target" | "paceTarget">,
): GoalSummary {
  const counting = locations.filter(isCounting);
  const statuses = counting.map((entry) => goalStatus(entry, context));
  const total = (pick: (entry: LocationRollup) => number) =>
    counting.reduce((sum, entry) => sum + pick(entry), 0);

  return {
    counting: counting.length,
    notCounting: locations.length - counting.length,
    qualifyingThisWeek: total((entry) => entry.qualifyingThisWeek),
    qualifyingLastWeek: total((entry) => entry.qualifyingLastWeek),
    qualifyingMonthToDate: total((entry) => entry.qualifyingMonthToDate),
    combinedTarget: counting.length * context.target,
    atGoal: statuses.filter((status) => status === "met").length,
    onPace: statuses.filter((status) => status === "on_pace").length,
    behindPace: statuses.filter((status) => status === "behind_pace").length,
    stillNeeded: total((entry) => goalProgress(entry.qualifyingMonthToDate, context.target).remaining),
  };
}

export interface DistrictGoalRollup {
  district: string;
  locations: number;
  counting: number;
  qualifyingThisWeek: number;
  qualifyingMonthToDate: number;
  combinedTarget: number;
  atGoal: number;
}

/**
 * The goal figures per district, from the listings inside it.
 *
 * A listing with no district is left out of the breakdown, the same judgement
 * `districtRollups` makes; the estate totals above still include it.
 */
export function districtGoalRollups(
  locations: LocationRollup[],
  context: Pick<ReviewGoalContext, "target" | "paceTarget">,
): DistrictGoalRollup[] {
  const byDistrict = new Map<string, LocationRollup[]>();
  for (const location of locations) {
    if (!location.district) continue;
    const rows = byDistrict.get(location.district) ?? [];
    rows.push(location);
    byDistrict.set(location.district, rows);
  }

  return [...byDistrict.entries()]
    .map(([district, rows]) => {
      const summary = goalSummary(rows, context);
      return {
        district,
        locations: rows.length,
        counting: summary.counting,
        qualifyingThisWeek: summary.qualifyingThisWeek,
        qualifyingMonthToDate: summary.qualifyingMonthToDate,
        combinedTarget: summary.combinedTarget,
        atGoal: summary.atGoal,
      };
    })
    .sort((a, b) => a.district.localeCompare(b.district));
}
