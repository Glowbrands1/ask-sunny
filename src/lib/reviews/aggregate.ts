import { formatWeekRange } from "./reporting-week";
import type {
  DistrictRollup,
  GoogleListingState,
  LocationRollup,
  ReviewSummary,
  WeeklyTrendPoint,
} from "./types";

/**
 * THE DASHBOARD'S ARITHMETIC, IN ONE PLACE AND WITH NO DATABASE IN SIGHT.
 *
 * Everything here is a pure function over rows the rollup views already
 * grouped. That is deliberate, and it is what makes the page's numbers
 * testable: `aggregate.test.ts` can assert "a 2-star review raises All New and
 * not Qualifying" without a Supabase client, a fixture database or a network.
 *
 * ============================================================================
 * THE ROWS THAT ARRIVE HERE HOLD ONLY COUNTED REVIEWS
 * ============================================================================
 *
 * `google_review_location_periods` joins `google_review_periods`, so a review
 * with no reporting period cannot appear in it at all. That is the structural
 * half of the correction: a backlog imported today is not filtered out of these
 * figures by a predicate somebody could forget — it is absent from the input.
 *
 * The backlog is counted separately, arrives as `LocationBacklogRow`, and is
 * shown under its own heading. The two are never added together.
 *
 * ONE OTHER RULE RUNS THROUGH ALL OF IT. Sums are re-aggregated; averages never
 * are. Every district and chain figure is a roll-up of per-listing rows, and
 * averaging fifteen averages gives the wrong answer the moment two salons have
 * different review counts. The views publish `rating_sum` for exactly this
 * reason and the division happens once, here, at the level being reported.
 */

/** One row of `public.google_review_location_periods`. */
export interface LocationPeriodRow {
  location_id: string;
  store_code: string;
  reporting_period_id: string;
  period_start: string;
  all_reviews: number;
  qualifying_reviews: number;
  critical_reviews: number;
  unanswered: number;
  critical_unanswered: number;
  rating_1: number;
  rating_2: number;
  rating_3: number;
  rating_4: number;
  rating_5: number;
  rating_sum: number;
}

/** One row of `public.google_review_location_backlog`. */
export interface LocationBacklogRow {
  location_id: string;
  store_code: string;
  historical_reviews: number;
  historical_qualifying: number;
  historical_unanswered: number;
  historical_critical_unanswered: number;
  rating_sum: number;
}

/** One row of `public.google_review_location_directory`. */
export interface LocationDirectoryRow {
  location_id: string;
  store_code: string;
  salon_number: string | null;
  location_name: string | null;
  district: string | null;
  region: string | null;
  google_location_label: string;
  website_url: string | null;
  listing_state: GoogleListingState;
  is_active: boolean;
  counted_through_external_review_id: string | null;
  counted_through_reviewer: string | null;
  historical_reviews: number;
  held_reviews: number;
}

/**
 * The name to print for a listing.
 *
 * `salon_directory` is the authority and normally answers. When it does not —
 * a salon that reporting has never described — the GOOGLE label is used rather
 * than a placeholder, because "Sun Tan City - KS Manhattan" is a true thing
 * Google says about the listing and "Unknown salon" is not information.
 */
export function displayName(entry: LocationDirectoryRow): string {
  return entry.location_name ?? entry.google_location_label;
}

function sum<T>(rows: T[], pick: (row: T) => number): number {
  return rows.reduce((total, row) => total + (pick(row) || 0), 0);
}

/** An average, or null when there is nothing to average. Never 0 for "none". */
function averageOf(count: number, ratingSum: number): number | null {
  if (count === 0) return null;
  return ratingSum / count;
}

/**
 * The headline figures.
 *
 * `monthToDate` is passed in rather than derived: reporting periods run Sunday
 * to Saturday and straddle month boundaries, so no sum of whole periods is a
 * month-to-date figure. It is counted directly by the read layer and handed
 * here so that this stays a pure function.
 *
 * `backlog` never touches a "this week" figure. It exists so the page can state
 * how much it is holding and counting nowhere, which is the honest thing to
 * show after a first import.
 */
export function summariseReviews(
  periodRows: LocationPeriodRow[],
  backlog: LocationBacklogRow[],
  directory: LocationDirectoryRow[],
  options: {
    currentPeriodId: string | null;
    currentPeriodStart: string;
    previousPeriodId: string | null;
    monthToDate: number;
  },
): ReviewSummary {
  const current = options.currentPeriodId
    ? periodRows.filter((row) => row.reporting_period_id === options.currentPeriodId)
    : [];
  const previous = options.previousPeriodId
    ? periodRows.filter((row) => row.reporting_period_id === options.previousPeriodId)
    : [];

  const countedTotal = sum(periodRows, (row) => row.all_reviews);
  const backlogTotal = sum(backlog, (row) => row.historical_reviews);

  return {
    periodId: options.currentPeriodId,
    weekStart: options.currentPeriodStart,
    weekEnd: weekEnd(options.currentPeriodStart),

    qualifyingThisWeek: sum(current, (row) => row.qualifying_reviews),
    allNewThisWeek: sum(current, (row) => row.all_reviews),

    /*
     * NEEDING ATTENTION AND UNANSWERED ARE NOT SCOPED TO A PERIOD, and that is
     * the point of those two measures. A 1-star review from nine days ago that
     * still has no reply is the most urgent thing on the page, and a 2-star
     * sitting in the imported backlog is a real customer who is still waiting.
     * Filtering either out because of which period it counts in would hide
     * exactly the work these tiles exist to surface.
     */
    criticalNeedingAttention:
      sum(periodRows, (row) => row.critical_unanswered) +
      sum(backlog, (row) => row.historical_critical_unanswered),
    unanswered:
      sum(periodRows, (row) => row.unanswered) +
      sum(backlog, (row) => row.historical_unanswered),

    /* Across every review held, counted or not — the reputation figure. */
    averageRating: averageOf(
      countedTotal + backlogTotal,
      sum(periodRows, (row) => row.rating_sum) + sum(backlog, (row) => row.rating_sum),
    ),

    /*
     * THE SAME DIVISION, OVER THE OPEN PERIOD'S ROWS ALONE.
     *
     * Over `all_reviews` rather than `qualifying_reviews`: the question is what
     * the week's reviewers gave, and dropping the 1s and 2s from the divisor
     * would report a rating no customer produced. The backlog is absent because
     * it belongs to no period — the same rule every other weekly figure here
     * follows.
     */
    averageRatingThisWeek: averageOf(
      sum(current, (row) => row.all_reviews),
      sum(current, (row) => row.rating_sum),
    ),

    byRating: [
      sum(periodRows, (row) => row.rating_1),
      sum(periodRows, (row) => row.rating_2),
      sum(periodRows, (row) => row.rating_3),
      sum(periodRows, (row) => row.rating_4),
      sum(periodRows, (row) => row.rating_5),
    ],

    monthToDate: options.monthToDate,
    qualifyingLastWeek: sum(previous, (row) => row.qualifying_reviews),
    allNewLastWeek: sum(previous, (row) => row.all_reviews),

    totalReviews: countedTotal + backlogTotal,
    historicalReviews: backlogTotal,
    listingsWithoutAnchor: directory.filter(
      (entry) => entry.counted_through_external_review_id === null,
    ).length,
  };
}

/**
 * The twelve-period trend.
 *
 * DRIVEN BY THE PERIOD LIST, NOT BY THE DATA. A week in which nothing was
 * counted is a zero column rather than a gap — a chart that silently omits
 * empty weeks compresses the x-axis and makes a quiet fortnight look like
 * steady volume.
 */
export function weeklyTrend(
  periodRows: LocationPeriodRow[],
  periods: { id: string; periodStart: string }[],
): WeeklyTrendPoint[] {
  return periods.map((period) => {
    const rows = periodRows.filter((row) => row.reporting_period_id === period.id);
    return {
      weekStart: period.periodStart,
      label: formatWeekRange(period.periodStart),
      all: sum(rows, (row) => row.all_reviews),
      qualifying: sum(rows, (row) => row.qualifying_reviews),
      critical: sum(rows, (row) => row.critical_reviews),
      unanswered: sum(rows, (row) => row.unanswered),
    };
  });
}

/**
 * One row per listing, for the leaderboard and the location drill-down.
 *
 * EVERY LISTING APPEARS, including one with no reviews at all and one that is
 * counting nothing because it has no anchor. The row set comes from the
 * directory rather than from the review table, so a salon that had a silent
 * week is visible with a zero instead of vanishing from the page — and a salon
 * that is silently uncounted is visible as such rather than looking quiet.
 */
export function locationRollups(
  directory: LocationDirectoryRow[],
  periodRows: LocationPeriodRow[],
  backlog: LocationBacklogRow[],
  options: { currentPeriodId: string | null; previousPeriodId: string | null },
): LocationRollup[] {
  return directory.map((entry) => {
    const rows = periodRows.filter((row) => row.location_id === entry.location_id);
    const held = backlog.filter((row) => row.location_id === entry.location_id);

    const current = options.currentPeriodId
      ? rows.filter((row) => row.reporting_period_id === options.currentPeriodId)
      : [];
    const previous = options.previousPeriodId
      ? rows.filter((row) => row.reporting_period_id === options.previousPeriodId)
      : [];

    const countedTotal = sum(rows, (row) => row.all_reviews);
    const backlogTotal = sum(held, (row) => row.historical_reviews);

    return {
      storeCode: entry.store_code,
      locationName: displayName(entry),
      district: entry.district,
      salonNumber: entry.salon_number,
      listingState: entry.listing_state,
      anchorReviewId: entry.counted_through_external_review_id,
      anchorReviewer: entry.counted_through_reviewer,
      historical: backlogTotal,
      reviewsThisWeek: sum(current, (row) => row.all_reviews),
      qualifyingThisWeek: sum(current, (row) => row.qualifying_reviews),
      lastWeek: sum(previous, (row) => row.all_reviews),
      unanswered:
        sum(rows, (row) => row.unanswered) + sum(held, (row) => row.historical_unanswered),
      criticalOpen:
        sum(rows, (row) => row.critical_unanswered) +
        sum(held, (row) => row.historical_critical_unanswered),
      averageRating: averageOf(
        countedTotal + backlogTotal,
        sum(rows, (row) => row.rating_sum) + sum(held, (row) => row.rating_sum),
      ),
      /* Everything the listing holds, counted and historical alike. */
      total: countedTotal + backlogTotal,
    };
  });
}

/**
 * District totals, rolled up from the listings inside each district.
 *
 * A LISTING WITH NO DISTRICT IS LEFT OUT RATHER THAN BUCKETED. `salon_directory`
 * returns a null district for a salon reporting has never described, and
 * "Unassigned" would be a category somebody eventually tries to manage — the
 * same judgement `activity_analytics_reads.sql` already made about this exact
 * column. The chain totals above still include it, so nothing is lost; it is
 * only absent from a breakdown that has no honest place to put it.
 */
export function districtRollups(locations: LocationRollup[]): DistrictRollup[] {
  const byDistrict = new Map<string, LocationRollup[]>();
  for (const location of locations) {
    if (!location.district) continue;
    const existing = byDistrict.get(location.district);
    if (existing) existing.push(location);
    else byDistrict.set(location.district, [location]);
  }

  return [...byDistrict.entries()]
    .map(([district, rows]) => {
      const total = rows.reduce((count, row) => count + row.total, 0);
      /*
       * Re-derived from each listing's sum rather than averaging their
       * averages. `average * total` recovers the sum exactly, which is what
       * keeps a district of one busy salon and four quiet ones honest.
       */
      const ratingSum = rows.reduce(
        (score, row) => score + (row.averageRating ?? 0) * row.total,
        0,
      );
      return {
        district,
        locations: rows.length,
        reviewsThisWeek: rows.reduce((count, row) => count + row.reviewsThisWeek, 0),
        qualifyingThisWeek: rows.reduce((count, row) => count + row.qualifyingThisWeek, 0),
        unanswered: rows.reduce((count, row) => count + row.unanswered, 0),
        averageRating: total === 0 ? null : ratingSum / total,
        total,
      };
    })
    .sort((a, b) => a.district.localeCompare(b.district));
}

function weekEnd(weekStart: string): string {
  const end = new Date(`${weekStart}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 6);
  return end.toISOString().slice(0, 10);
}
