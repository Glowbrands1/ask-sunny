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
 * ONE RULE RUNS THROUGH ALL OF IT. Sums are re-aggregated; averages never are.
 * Every district figure and every chain figure on this page is a roll-up of
 * per-listing rows, and averaging fifteen averages gives the wrong answer the
 * moment two salons have different review counts. The views publish
 * `rating_sum` for exactly this reason and the division happens once, here, at
 * the level being reported.
 */

/** One row of `public.google_review_location_weeks`. */
export interface LocationWeekRow {
  location_id: string;
  store_code: string;
  reporting_week_start: string;
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
  last_seen_at: string | null;
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

function sum(rows: LocationWeekRow[], pick: (row: LocationWeekRow) => number): number {
  return rows.reduce((total, row) => total + (pick(row) || 0), 0);
}

/** An average, or null when there is nothing to average. Never 0 for "none". */
function averageRating(rows: LocationWeekRow[]): number | null {
  const count = sum(rows, (row) => row.all_reviews);
  if (count === 0) return null;
  return sum(rows, (row) => row.rating_sum) / count;
}

/**
 * The headline figures.
 *
 * `monthToDate` is passed in rather than derived: reporting weeks run Sunday to
 * Saturday and straddle month boundaries, so no sum of whole weeks is a
 * month-to-date figure. It is counted directly against `first_seen_at` by the
 * read layer and handed here so that this stays a pure function.
 */
export function summariseReviews(
  weekRows: LocationWeekRow[],
  options: {
    currentWeekStart: string;
    previousWeekStart: string;
    monthToDate: number;
  },
): ReviewSummary {
  const current = weekRows.filter(
    (row) => row.reporting_week_start === options.currentWeekStart,
  );
  const previous = weekRows.filter(
    (row) => row.reporting_week_start === options.previousWeekStart,
  );

  return {
    weekStart: options.currentWeekStart,
    weekEnd: weekEnd(options.currentWeekStart),

    qualifyingThisWeek: sum(current, (row) => row.qualifying_reviews),
    allNewThisWeek: sum(current, (row) => row.all_reviews),

    /*
     * NEEDING ATTENTION IS NOT SCOPED TO THIS WEEK, and that is the point of
     * the tile. A 1-star review from nine days ago that still has no reply is
     * the most urgent thing on the page; filtering it out because the week
     * rolled over on Sunday would hide exactly the work this measure exists to
     * surface.
     */
    criticalNeedingAttention: sum(weekRows, (row) => row.critical_unanswered),
    unanswered: sum(weekRows, (row) => row.unanswered),

    /* Across every review held, not just this week's — the reputation figure. */
    averageRating: averageRating(weekRows),

    byRating: [
      sum(weekRows, (row) => row.rating_1),
      sum(weekRows, (row) => row.rating_2),
      sum(weekRows, (row) => row.rating_3),
      sum(weekRows, (row) => row.rating_4),
      sum(weekRows, (row) => row.rating_5),
    ],

    monthToDate: options.monthToDate,
    qualifyingLastWeek: sum(previous, (row) => row.qualifying_reviews),
    allNewLastWeek: sum(previous, (row) => row.all_reviews),
    totalReviews: sum(weekRows, (row) => row.all_reviews),
  };
}

/**
 * The twelve-week trend.
 *
 * DRIVEN BY THE WEEK LIST, NOT BY THE DATA. A week in which nothing was
 * ingested is a zero column rather than a gap — a chart that silently omits
 * empty weeks compresses the x-axis and makes a quiet fortnight look like
 * steady volume.
 */
export function weeklyTrend(
  weekRows: LocationWeekRow[],
  weekStarts: string[],
): WeeklyTrendPoint[] {
  return weekStarts.map((weekStart) => {
    const rows = weekRows.filter((row) => row.reporting_week_start === weekStart);
    return {
      weekStart,
      label: formatWeekRange(weekStart),
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
 * EVERY LISTING APPEARS, including one with no reviews at all. The row set
 * comes from the directory rather than from the review table, so a salon that
 * had a silent week is visible with a zero instead of vanishing from the page.
 */
export function locationRollups(
  directory: LocationDirectoryRow[],
  weekRows: LocationWeekRow[],
  options: { currentWeekStart: string; previousWeekStart: string },
): LocationRollup[] {
  return directory.map((entry) => {
    const rows = weekRows.filter((row) => row.location_id === entry.location_id);
    const current = rows.filter(
      (row) => row.reporting_week_start === options.currentWeekStart,
    );
    const previous = rows.filter(
      (row) => row.reporting_week_start === options.previousWeekStart,
    );

    return {
      storeCode: entry.store_code,
      locationName: displayName(entry),
      district: entry.district,
      salonNumber: entry.salon_number,
      listingState: entry.listing_state,
      reviewsThisWeek: sum(current, (row) => row.all_reviews),
      qualifyingThisWeek: sum(current, (row) => row.qualifying_reviews),
      lastWeek: sum(previous, (row) => row.all_reviews),
      unanswered: sum(rows, (row) => row.unanswered),
      criticalOpen: sum(rows, (row) => row.critical_unanswered),
      averageRating: averageRating(rows),
      total: sum(rows, (row) => row.all_reviews),
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
