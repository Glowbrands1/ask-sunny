import { formatWeekRange } from "./reporting-week";
import type { ReviewsSnapshot } from "./queries";

/**
 * ============================================================================
 * THE OVERVIEW'S GOOGLE REVIEWS BLOCK — DERIVED, NEVER RE-QUERIED
 * ============================================================================
 *
 * The yellow "This week" bar on the home page used to sum `DEMO_REVIEW_METRICS`
 * — 189 reviews gained, 4.63 average, 15 salons, a 230 goal — under a note
 * saying so. Every figure it now shows comes from the SAME SNAPSHOT the Google
 * Reviews tab renders: `loadReviewsSnapshot()`, the same rollup views, the same
 * Sunday-to-Saturday reporting period, the same directory of listings.
 *
 * THIS MODULE HOLDS NO QUERY AND NO DATABASE CLIENT. It is a pure projection of
 * that snapshot onto the five figures the bar has room for, which is what makes
 * it testable without Supabase and what stops the home page from growing a
 * second idea of what a week counted. `weekly-block-read.ts` is the thin
 * server-side half that fetches the snapshot and calls this.
 *
 * ============================================================================
 * WHICH FIGURE IS "REVIEWS GAINED", AND WHY IT IS THE QUALIFYING ONE
 * ============================================================================
 *
 * The tab's headline tile is "Qualifying reviews gained" — the 3-, 4- and
 * 5-star reviews counted into the open period — because that is the business's
 * official weekly number and 1- and 2-star reviews never raise it. The Overview
 * shows the same measure with the same week-over-week comparison the tile
 * already makes (`qualifyingThisWeek` against `qualifyingLastWeek`), so the two
 * surfaces cannot state different totals for one week. `allNew` travels with it
 * so the caption can say how many arrived in total.
 *
 * Client-safe: no database client, no secret, no `server-only` import. The
 * `ReviewsSnapshot` import is TYPE ONLY and is erased at compile time.
 */

/**
 * THE WEEKLY TARGET, PER SALON, FROM CONFIGURATION — AND NOWHERE ELSE.
 *
 * The 230 on the seeded bar was `14 × 15 + 20`, summed from invented per-salon
 * goals in `data/demo/reviews.ts`. Nothing in Supabase holds a review goal, and
 * `docs/google-reviews-phase-1.md` §6 settled what to do about that: a meter
 * against a number nobody agreed to is a figure a manager quotes in a meeting,
 * so the goal is not invented here either.
 *
 * What it is instead is CONFIGURED, in one place, as one number: the weekly
 * target for a single salon. The block multiplies it by the salons the reviews
 * system actually holds, so the estate target moves with the estate rather than
 * being frozen at whatever the roster was the day somebody typed a total.
 *
 * UNSET IS A REAL STATE AND IS SHOWN AS ONE. No goal means no meter and no
 * percentage — the count, the rating and the comparison are all still real.
 */
export const WEEKLY_GOAL_PER_SALON_ENV = "GOOGLE_REVIEWS_WEEKLY_GOAL_PER_SALON";

/**
 * The configured per-salon weekly target, or null when there is none.
 *
 * A VALUE THAT DOES NOT PARSE IS TREATED AS UNSET rather than as zero or as a
 * default. Both of the alternatives are a number the deployment did not choose,
 * and one of them would divide by itself.
 *
 * Zero IS accepted and means "no target this week", which is a thing an
 * operator can legitimately say; it draws no meter, exactly like unset.
 */
export function weeklyGoalPerSalon(
  env: Record<string, string | undefined> = process.env,
): number | null {
  const raw = env[WEEKLY_GOAL_PER_SALON_ENV]?.trim();
  if (!raw) return null;
  if (!/^\d+$/.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

/** The estate's target: the per-salon figure across the salons in view. */
export function weeklyGoalFor(salonCount: number, perSalon: number | null): number | null {
  if (perSalon === null) return null;
  return perSalon * salonCount;
}

/** The part of the snapshot this block reads. Nothing else is consulted. */
export type ReviewsWeekSnapshot = Pick<
  ReviewsSnapshot,
  "summary" | "locations" | "empty" | "currentWeek" | "previousWeek"
>;

/** The five figures the bar draws, with the period they were measured over. */
export interface ReviewsWeekFigures {
  readonly status: "ready";
  /** 3–5★ counted into the open reporting period. The official weekly number. */
  readonly gained: number;
  /** Every review counted into that period, 1–5★. For the caption only. */
  readonly allNew: number;
  /**
   * THE WEEK-OVER-WEEK CHANGE, ON THE COMPARISON THE TAB ALREADY MAKES.
   *
   * `qualifyingThisWeek − qualifyingLastWeek`: the open reporting period against
   * the one before it, Sunday to Saturday in the business timezone. Both week
   * boundaries are named on the block so the comparison is checkable.
   */
  readonly vsLastWeek: number;
  /** The average star of the reviews counted into this period. Null when none. */
  readonly averageRating: number | null;
  /** Listings the reviews system holds — the tab's own salon count. */
  readonly salonCount: number;
  /** The configured target across those salons, or null when unconfigured. */
  readonly goal: number | null;
  /** The per-salon half of it, for the caption. Null when unconfigured. */
  readonly goalPerSalon: number | null;
  /** `Sep 20 – Sep 26`, the open period. */
  readonly weekLabel: string;
  /** `Sep 13 – Sep 19`, the period `vsLastWeek` compares against. */
  readonly previousWeekLabel: string;
}

export type ReviewsWeekBlock =
  | ReviewsWeekFigures
  /** Nothing to report on: no reviews held, or this runtime cannot read them. */
  | { readonly status: "no_data"; readonly reason: string }
  /** A read failed. The block says so; it never falls back to a figure. */
  | { readonly status: "error"; readonly message: string };

/**
 * The snapshot, as the Overview's bar needs it.
 *
 * AN ESTATE HOLDING NO REVIEW AT ALL IS `no_data`, not a row of zeroes. Zero
 * gained, zero average and zero salons would read as a catastrophic week rather
 * than as an integration that has never run — the same distinction the
 * Performance Overview card draws between "not ingested" and a real zero.
 *
 * A WEEK THAT COUNTED NOTHING ON AN ESTATE THAT HOLDS REVIEWS IS `ready` WITH A
 * ZERO, because that is a true and useful answer: the reviews are there, this
 * period counted none of them yet, and the caption says so.
 */
export function deriveReviewsWeekBlock(
  snapshot: ReviewsWeekSnapshot,
  options: { goalPerSalon?: number | null } = {},
): ReviewsWeekBlock {
  if (snapshot.empty) {
    return {
      status: "no_data",
      reason: "No Google review has been synced into Ask Sunny yet.",
    };
  }

  const { summary } = snapshot;
  const salonCount = snapshot.locations.length;
  const goalPerSalon =
    options.goalPerSalon === undefined ? weeklyGoalPerSalon() : options.goalPerSalon;

  return {
    status: "ready",
    gained: summary.qualifyingThisWeek,
    allNew: summary.allNewThisWeek,
    vsLastWeek: summary.qualifyingThisWeek - summary.qualifyingLastWeek,
    averageRating: summary.averageRatingThisWeek,
    salonCount,
    goal: weeklyGoalFor(salonCount, goalPerSalon),
    goalPerSalon,
    weekLabel: formatWeekRange(snapshot.currentWeek),
    previousWeekLabel: formatWeekRange(snapshot.previousWeek),
  };
}
