import "server-only";

import { businessToday, shiftDays } from "@/lib/business-date";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import {
  districtRollups,
  locationRollups,
  summariseReviews,
  weeklyTrend,
  type LocationBacklogRow,
  type LocationDirectoryRow,
  type LocationPeriodRow,
} from "./aggregate";
import { ratingDistribution } from "./rating-distribution";
import {
  currentWeekStart,
  monthStart,
  recentWeekStarts,
  weekEndOf,
} from "./reporting-week";
import {
  ratingBounds,
  WEEK_ALL,
  WEEK_CURRENT,
  type ReviewFilters,
} from "./filters";
import {
  buildReviewTimeline,
  EMPTY_REVIEW_TIMELINE,
  type ReviewTimeline,
  type TimelineRecord,
} from "./timeline";
import type {
  DashboardReview,
  DistrictRollup,
  LocationRollup,
  RatingDistribution,
  ReviewSummary,
  WeeklyTrendPoint,
} from "./types";

/**
 * GOOGLE REVIEW READS — server side, under the secret key, and nowhere else.
 *
 * `import "server-only"` makes a client component importing this file a BUILD
 * failure, which is the structural half of the posture
 * `20260916001000_reporting_tables_server_only.sql` records: the browser roles
 * hold no grant on any of these relations and no policy admits them, so the
 * publishable key that ships in every bundle cannot read a review from
 * PostgREST directly. There is one door and it is this one.
 *
 * ============================================================================
 * EVERY WEEKLY FIGURE READS A REPORTING PERIOD, NEVER A FIRST-SEEN DATE
 * ============================================================================
 *
 * `google_review_location_periods` joins `google_review_periods`, so a review
 * with no period cannot appear in it — a backlog imported this morning is
 * absent from the input to every "this week" number rather than filtered out of
 * it by a predicate somebody could forget. The backlog has its own view, its
 * own tile and its own drill-down, and the two are never added together.
 *
 * WHAT IS AGGREGATED IN SQL AND WHAT IS NOT. The counts come from the rollup
 * views, so a twelve-week trend is tens of rows rather than every review in the
 * estate. The FEED is the only query that reads whole reviews, it is bounded,
 * and it applies exactly the filters the tiles link to — which is what makes
 * "click the 37 and see the 37" true rather than approximately true.
 */

/** How many reviews one page of the feed holds. */
export const FEED_PAGE_SIZE = 100;

/** How much history the trend and the leaderboard read. */
export const TREND_WEEKS = 12;

/**
 * THE CEILING ON THE OVER-TIME CHART'S READ.
 *
 * The chart needs three date columns per review rather than whole records, so
 * this is a narrow read even at the limit — but it is still a read of every
 * matching review, and an unbounded one is how a page that was fine at eighty
 * records becomes a timeout at eighty thousand. When the ceiling is reached the
 * MOST RECENT reviews are the ones kept, and the chart says it is showing a
 * window rather than quietly drawing a partial past as if it were complete.
 */
export const TIMELINE_LIMIT = 5000;

export interface ReviewsSnapshot {
  /** True when this deployment holds no Google review at all yet. */
  empty: boolean;
  summary: ReviewSummary;
  trend: WeeklyTrendPoint[];
  locations: LocationRollup[];
  districts: DistrictRollup[];
  /** Every district that has at least one listing, for the filter bar. */
  districtOptions: string[];
  /** The fifteen listings, for the filter bar. */
  locationOptions: { storeCode: string; label: string; district: string | null }[];
  /** Listings Google currently marks as needing verification. */
  verificationRequired: { storeCode: string; label: string }[];
  /**
   * Listings with no reporting anchor, and therefore counting nothing. The
   * dashboard has to be able to say this out loud, because the alternative is a
   * salon that looks quiet when it is actually unmeasured.
   */
  awaitingAnchor: { storeCode: string; label: string; historical: number }[];
  weekStarts: string[];
  currentWeek: string;
  previousWeek: string;
  lastSyncAt: string | null;
}

export interface ReviewFeed {
  reviews: DashboardReview[];
  /** Matching rows in the database, which may exceed what is returned. */
  total: number;
  truncated: boolean;
}

/* ------------------------------------------------------------ the rows --- */

interface EnrichedRow {
  id: string;
  source: string;
  external_review_id: string;
  store_code: string;
  salon_number: string | null;
  location_name: string | null;
  district: string | null;
  google_location_label: string;
  website_url: string | null;
  listing_state: string;
  reviewer_name: string;
  rating: number;
  review_text: string | null;
  google_relative_date_text: string | null;
  google_absolute_date: string | null;
  google_estimated_at: string | null;
  first_seen_at: string;
  last_seen_at: string;
  first_seen_week: string;
  has_owner_response: boolean;
  owner_response_text: string | null;
  owner_response_date_text: string | null;
  response_status: string;
  eligible_for_weekly_count: boolean;
  reporting_period_id: string | null;
  reporting_assignment_status: string;
  period_start: string | null;
  period_end: string | null;
  parser_version: string;
}

const ENRICHED_COLUMNS =
  "id,source,external_review_id,store_code,salon_number,location_name,district," +
  "google_location_label,website_url,listing_state,reviewer_name,rating,review_text," +
  "google_relative_date_text,google_absolute_date,google_estimated_at," +
  "first_seen_at,last_seen_at,first_seen_week," +
  "has_owner_response,owner_response_text,owner_response_date_text,response_status," +
  "eligible_for_weekly_count,reporting_period_id,reporting_assignment_status," +
  "period_start,period_end,parser_version";

function toDashboardReview(row: EnrichedRow): DashboardReview {
  return {
    id: row.id,
    source: "google_business_profile",
    externalReviewId: row.external_review_id,
    storeCode: row.store_code,
    salonNumber: row.salon_number,
    /* The Google label only when reporting has never described the salon. */
    locationName: row.location_name ?? row.google_location_label,
    district: row.district,
    websiteUrl: row.website_url,
    listingState:
      row.listing_state === "verification_required" ? "verification_required" : "verified",
    reviewerName: row.reviewer_name,
    rating: row.rating,
    reviewText: row.review_text,
    relativeDateText: row.google_relative_date_text,
    googleAbsoluteDate: row.google_absolute_date,
    googleEstimatedAt: row.google_estimated_at,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    firstSeenWeek: row.first_seen_week,
    hasOwnerResponse: row.has_owner_response,
    ownerResponseText: row.owner_response_text,
    ownerResponseDateText: row.owner_response_date_text,
    responseStatus: row.response_status === "responded" ? "responded" : "needs_response",
    eligibleForWeeklyCount: row.eligible_for_weekly_count,
    reportingPeriodId: row.reporting_period_id,
    reportingAssignmentStatus:
      row.reporting_assignment_status === "anchor_assigned" ? "anchor_assigned" : "historical",
    periodStart: row.period_start,
    periodEnd: row.period_end,
    parserVersion: row.parser_version,
  };
}

/* ------------------------------------------------------- the snapshot ---- */

/**
 * Every figure on the page, plus the filter bar's options.
 *
 * THE DISTRICT AND LISTING FILTERS NARROW THE AGGREGATES TOO, not only the
 * feed. A page filtered to one district that still showed the chain's weekly
 * total above a district's list of reviews would be inviting somebody to quote
 * the wrong number in a meeting.
 */
export async function loadReviewsSnapshot(
  filters: Pick<ReviewFilters, "district" | "storeCode">,
  today: string = businessToday(),
): Promise<ReviewsSnapshot> {
  const supabase = getSupabaseAdmin();

  const currentStart = currentWeekStart(today);
  const previousStart = shiftDays(currentStart, -7);
  const weekStarts = recentWeekStarts(TREND_WEEKS, today);
  const earliest = weekStarts[0];

  const [periodResult, directoryResult, syncResult] = await Promise.all([
    /*
     * THE PERIODS THEMSELVES, which exist only once something has been counted
     * into them — `google_review_current_period` creates one lazily at the
     * first sync of the week. A week with no row is drawn as a zero column
     * rather than left out, so a quiet fortnight does not compress the axis.
     */
    supabase
      .from("google_review_periods")
      .select("id,period_start,period_end,status")
      .gte("period_start", earliest)
      .order("period_start"),

    supabase
      .from("google_review_location_directory")
      .select(
        "location_id,store_code,salon_number,location_name,district,region," +
          "google_location_label,website_url,listing_state,is_active," +
          "counted_through_external_review_id,counted_through_reviewer," +
          "historical_reviews,held_reviews",
      )
      .order("store_code"),

    supabase
      .from("google_review_sync_runs")
      .select("started_at")
      .order("started_at", { ascending: false })
      .limit(1),
  ]);

  if (periodResult.error) throw periodResult.error;
  if (directoryResult.error) throw directoryResult.error;

  const periods = (periodResult.data ?? []) as unknown as {
    id: string;
    period_start: string;
  }[];
  const periodIdByStart = new Map(periods.map((period) => [period.period_start, period.id]));

  const [countResult, backlogResult] = await Promise.all([
    periods.length === 0
      ? Promise.resolve({ data: [], error: null })
      : supabase
          .from("google_review_location_periods")
          .select(
            "location_id,store_code,reporting_period_id,period_start,all_reviews," +
              "qualifying_reviews,critical_reviews,unanswered,critical_unanswered," +
              "rating_1,rating_2,rating_3,rating_4,rating_5,rating_sum",
          )
          .in(
            "reporting_period_id",
            periods.map((period) => period.id),
          ),

    supabase
      .from("google_review_location_backlog")
      .select(
        "location_id,store_code,historical_reviews,historical_qualifying," +
          "historical_unanswered,historical_critical_unanswered,rating_sum",
      ),
  ]);

  if (countResult.error) throw countResult.error;
  if (backlogResult.error) throw backlogResult.error;

  const directoryAll = (directoryResult.data ?? []) as unknown as LocationDirectoryRow[];
  const periodRowsAll = (countResult.data ?? []) as unknown as LocationPeriodRow[];
  const backlogAll = (backlogResult.data ?? []) as unknown as LocationBacklogRow[];

  /*
   * THE FILTER IS APPLIED TO THE DIRECTORY FIRST, and the counts are then
   * narrowed to the listings that survived. Filtering the counts on their own
   * would leave a district's leaderboard listing salons from every other
   * district with zeros beside them.
   */
  const directory = directoryAll.filter((entry) => {
    if (filters.district && entry.district !== filters.district) return false;
    if (filters.storeCode && entry.store_code !== filters.storeCode) return false;
    return true;
  });
  const visible = new Set(directory.map((entry) => entry.location_id));
  const periodRows = periodRowsAll.filter((row) => visible.has(row.location_id));
  const backlog = backlogAll.filter((row) => visible.has(row.location_id));

  const currentPeriodId = periodIdByStart.get(currentStart) ?? null;
  const previousPeriodId = periodIdByStart.get(previousStart) ?? null;

  /*
   * MONTH TO DATE, OVER PERIODS RATHER THAN OVER DAYS. Reporting weeks straddle
   * month boundaries, so there is no honest "reviews counted between the 1st
   * and today" — what there is, and what the caption says, is the reporting
   * weeks that BEGAN this month. Computed from rows already in hand rather than
   * by a second round trip.
   */
  const firstOfMonth = monthStart(today);
  const monthToDate = periodRows
    .filter((row) => row.period_start >= firstOfMonth)
    .reduce((total, row) => total + row.all_reviews, 0);

  const locations = locationRollups(directory, periodRows, backlog, {
    currentPeriodId,
    previousPeriodId,
  });

  return {
    /* Emptiness is judged on the WHOLE estate, not on the filtered slice: a
       district with no reviews yet is a real answer, not an unconfigured app. */
    empty: periodRowsAll.length === 0 && backlogAll.length === 0,
    summary: summariseReviews(periodRows, backlog, directory, {
      currentPeriodId,
      currentPeriodStart: currentStart,
      previousPeriodId,
      monthToDate,
    }),
    trend: weeklyTrend(
      periodRows,
      weekStarts.map((periodStart) => ({
        /* A week with no period row matches no count, which draws a zero. */
        id: periodIdByStart.get(periodStart) ?? `absent:${periodStart}`,
        periodStart,
      })),
    ),
    locations,
    districts: districtRollups(locations),
    districtOptions: [
      ...new Set(
        directoryAll
          .map((entry) => entry.district)
          .filter((district): district is string => Boolean(district)),
      ),
    ].sort(),
    locationOptions: directoryAll.map((entry) => ({
      storeCode: entry.store_code,
      label: entry.location_name ?? entry.google_location_label,
      district: entry.district,
    })),
    verificationRequired: directoryAll
      .filter((entry) => entry.listing_state === "verification_required")
      .map((entry) => ({
        storeCode: entry.store_code,
        label: entry.location_name ?? entry.google_location_label,
      })),
    awaitingAnchor: directoryAll
      .filter((entry) => entry.counted_through_external_review_id === null)
      .map((entry) => ({
        storeCode: entry.store_code,
        label: entry.location_name ?? entry.google_location_label,
        historical: entry.historical_reviews ?? 0,
      })),
    weekStarts,
    currentWeek: currentStart,
    previousWeek: previousStart,
    lastSyncAt:
      syncResult.error || !syncResult.data?.length
        ? null
        : (syncResult.data[0] as { started_at: string }).started_at,
  };
}

/* ------------------------------------------------------------ the feed --- */

/**
 * ONE PREDICATE, TWO READS.
 *
 * The feed and the over-time chart have to narrow the review records the same
 * way: a page filtered to KS Lawrence and 2 stars must not draw a chart of the
 * whole estate above a list of one salon's complaints. Writing the predicate
 * twice is how that drifts, so it is written once, here, and both callers pass
 * their own column list.
 *
 * WHAT IS NOT IN IT is as deliberate as what is. The REPORTING filters — the
 * week, the assignment and the custom first-seen window — belong to the feed
 * alone and are applied by `loadReviewFeed` after this. A time series narrowed
 * to one reporting week is one column, and a time series narrowed to "counted
 * in a period" would draw nothing at all on an estate whose baselines have not
 * been set. Neither is a chart; both would look like one.
 */
function scopeReviewQuery(
  columns: string,
  filters: Pick<
    ReviewFilters,
    "district" | "storeCode" | "rating" | "status" | "qualifying" | "search"
  >,
  /*
   * `head` ASKS FOR THE COUNT AND NONE OF THE ROWS. PostgREST answers a HEAD
   * request with the matched count in the content range and an empty body,
   * which is what lets the rating distribution be EXACT at any size: it is five
   * counts rather than a read of every review that a ceiling would then have to
   * trim, and a trimmed read is a distribution that quietly stops adding up.
   */
  options: { head?: boolean } = {},
) {
  let query = getSupabaseAdmin()
    .from("google_reviews_enriched")
    .select(columns, { count: "exact", head: options.head ?? false });

  if (filters.district) query = query.eq("district", filters.district);
  if (filters.storeCode) query = query.eq("store_code", filters.storeCode);

  const bounds = ratingBounds(filters.rating);
  if (bounds) query = query.gte("rating", bounds.min).lte("rating", bounds.max);

  if (filters.status !== "all") query = query.eq("response_status", filters.status);

  if (filters.qualifying !== "all") {
    query = query.eq("eligible_for_weekly_count", filters.qualifying === "yes");
  }

  if (filters.search) {
    /*
     * REVIEWER NAME, COMMENT, OR LOCATION NAME — the three things somebody
     * searches for. `%` and `,` are stripped rather than escaped: a comma ends
     * a PostgREST `or` term and a percent is a wildcard, and both are noise in
     * a name or a phrase rather than something a searcher meant.
     */
    const term = filters.search.replace(/[%,()]/g, " ").trim();
    if (term.length > 0) {
      query = query.or(
        `reviewer_name.ilike.%${term}%,review_text.ilike.%${term}%,location_name.ilike.%${term}%`,
      );
    }
  }

  return query;
}

/**
 * The individual reviews behind the numbers.
 *
 * THE SAME FILTER VOCABULARY THE TILES LINK WITH. Every drill-down on the page
 * is a link into this function's arguments, so the list a number opens is
 * produced by the same predicate that produced the number — not by a second
 * query written to resemble it.
 *
 * `week` FILTERS ON THE ASSIGNED PERIOD. A historical review has a null
 * `period_start`, so it is excluded from `week=current` by the comparison
 * itself rather than by a rule somebody has to remember.
 */
export async function loadReviewFeed(
  filters: ReviewFilters,
  today: string = businessToday(),
): Promise<ReviewFeed> {
  let query = scopeReviewQuery(ENRICHED_COLUMNS, filters);

  if (filters.week === WEEK_CURRENT) {
    query = query.eq("period_start", currentWeekStart(today));
  } else if (filters.week !== WEEK_ALL) {
    query = query.eq("period_start", filters.week);
  }

  if (filters.assignment === "counted") {
    query = query.not("reporting_period_id", "is", null);
  } else if (filters.assignment === "historical") {
    query = query.is("reporting_period_id", null);
  }

  if (filters.from && filters.to) {
    /*
     * THE CUSTOM WINDOW IS OVER FIRST-SEEN, and it is the one place that is
     * still true — it is an "when did we import this" question, asked from the
     * detail view and from the month tile, and it is captioned as such. It has
     * no bearing on which period a review counts in.
     */
    query = query
      .gte("first_seen_at", `${filters.from}T00:00:00Z`)
      .lt("first_seen_at", `${shiftDays(filters.to, 1)}T00:00:00Z`);
  }

  const { data, error, count } = await query
    /*
     * THE QUEUE ORDER, NOT THE CALENDAR ORDER. Unanswered before answered, then
     * the lower rating, then the older review — because a 2-star sitting three
     * days is worse than a 3-star sitting two, and "newest first" buries the
     * review that has been waiting longest.
     */
    .order("response_status", { ascending: true })
    .order("rating", { ascending: true })
    .order("first_seen_at", { ascending: false })
    .limit(FEED_PAGE_SIZE);

  if (error) throw error;

  const rows = (data ?? []) as unknown as EnrichedRow[];
  const total = count ?? rows.length;

  return {
    reviews: rows.map(toDashboardReview),
    total,
    truncated: total > rows.length,
  };
}

/* -------------------------------------------------------- the timeline --- */

/** The three date columns the over-time chart places a review by. */
const TIMELINE_COLUMNS = "google_absolute_date,google_estimated_at,first_seen_at";

/**
 * HOW MANY REVIEWS ARE ARRIVING OVER TIME, from the review records themselves.
 *
 * ============================================================================
 * IT DOES NOT READ A REPORTING PERIOD, AND THAT IS THE POINT
 * ============================================================================
 *
 * The twelve-week trend reads `google_review_location_periods`, so it can only
 * draw what has been COUNTED — and a salon with no baseline counts nothing, by
 * design. That is the right way to report a weekly total and the wrong way to
 * answer "how many Google reviews are we receiving", which is a fact about the
 * records and is true the moment one is stored.
 *
 * So this reads the reviews. It is a volume figure, it depends on no baseline,
 * and `timeline.ts` documents the date precedence it places each record by.
 * Nothing here changes what counts toward a week; nothing here can.
 *
 * ORDERED NEWEST-FIRST SO THE CEILING TRIMS THE PAST, not the present. If a
 * deployment ever holds more than `TIMELINE_LIMIT` matching reviews, the window
 * that survives is the recent one, and `truncated` tells the chart to say so.
 */
export async function loadReviewTimeline(
  filters: Pick<
    ReviewFilters,
    "district" | "storeCode" | "rating" | "status" | "qualifying" | "search"
  >,
): Promise<ReviewTimeline & { truncated: boolean }> {
  const { data, error, count } = await scopeReviewQuery(TIMELINE_COLUMNS, filters)
    .order("first_seen_at", { ascending: false })
    .limit(TIMELINE_LIMIT);

  /*
   * A CHART IS NOT WORTH TAKING THE PAGE DOWN FOR. Every other figure on the
   * screen comes from a different read; a failure here draws an empty chart
   * that says nothing is plotted, rather than a 500 over the leaderboard, the
   * queue and the feed.
   */
  if (error) return { ...EMPTY_REVIEW_TIMELINE, truncated: false };

  const rows = (data ?? []) as unknown as {
    google_absolute_date: string | null;
    google_estimated_at: string | null;
    first_seen_at: string;
  }[];

  const records: TimelineRecord[] = rows.map((row) => ({
    googleAbsoluteDate: row.google_absolute_date,
    googleEstimatedAt: row.google_estimated_at,
    firstSeenAt: row.first_seen_at,
  }));

  return {
    ...buildReviewTimeline(records),
    truncated: (count ?? rows.length) > rows.length,
  };
}

/* ---------------------------------------------- the rating distribution --- */

/**
 * ============================================================================
 * HOW THE SYNCED REVIEWS SPLIT BY STAR — FROM THE REVIEWS, NOT FROM THE WEEKS
 * ============================================================================
 *
 * THE DEFECT THIS REPLACES. The card was summed from
 * `google_review_location_periods`, the same rollup every weekly figure reads.
 * That rollup holds a review only where it was proven to sit above its
 * listing's baseline — so on an estate whose baselines have not been set it is
 * empty, and the card drew 5★ 0, 4★ 0, 3★ 0, 2★ 0, 1★ 0 directly beneath an
 * over-time chart plotting hundreds of the very reviews it was claiming not to
 * have. Both were right about their own question. Only one of them was the
 * question the card asks.
 *
 * So this reads `google_reviews_enriched` — THE SAME RECORDS AND THE SAME
 * PREDICATE BUILDER the over-time chart reads, `scopeReviewQuery` — and every
 * stored review is in exactly one bucket. Nothing about a baseline, an anchor,
 * a reporting period or `eligible_for_weekly_count` decides membership, which
 * is the whole of the correction.
 *
 * ============================================================================
 * WHICH FILTERS IT HONOURS, AND WHY THE OTHERS WOULD BE WRONG HERE
 * ============================================================================
 *
 * LOCATION AND DISTRICT, which is exactly the pair `loadReviewsSnapshot` takes
 * and therefore exactly what every other figure on the Overview responds to.
 * Narrow the page to MO Kansas City Wornall and the distribution is Wornall's;
 * All Locations aggregates every synced review.
 *
 * NOT THE RATING FILTER. A distribution narrowed to one star is one bar, and
 * the five bars are themselves the rating control — the card would answer a
 * question by deleting it.
 *
 * NOT `qualifying` AND NOT `assignment`. Those two ask whether a review counts
 * toward a weekly total or sits in a reporting period, and admitting either
 * would put the weekly rule back into a card that exists to be free of it.
 *
 * ============================================================================
 * FIVE EXACT COUNTS, NOT A READ WITH A CEILING
 * ============================================================================
 *
 * Each bucket is a HEAD request carrying the count and no rows, so the five
 * figures are exact however many reviews the estate holds, and their sum IS the
 * total the heading prints — `ratingDistribution` derives it, so the bars and
 * the heading cannot disagree. A bounded read of whole reviews counted in
 * memory would have been one round trip and a distribution that silently stops
 * summing at the ceiling.
 */
export async function loadRatingDistribution(
  filters: Pick<ReviewFilters, "district" | "storeCode">,
): Promise<RatingDistribution> {
  const scope: Parameters<typeof scopeReviewQuery>[1] = {
    district: filters.district,
    storeCode: filters.storeCode,
    /* Stated, not omitted: these three are neutralised on purpose, above. */
    rating: "all",
    status: "all",
    qualifying: "all",
    search: null,
  };

  const buckets = await Promise.all(
    [1, 2, 3, 4, 5].map(async (rating) => {
      const { count, error } = await scopeReviewQuery("id", scope, { head: true }).eq(
        "rating",
        rating,
      );
      if (error) throw error;
      return count ?? 0;
    }),
  );

  return ratingDistribution(buckets);
}

/** One review, for the detail panel. Null when the id names nothing. */
export async function loadReviewDetail(id: string): Promise<DashboardReview | null> {
  const { data, error } = await getSupabaseAdmin()
    .from("google_reviews_enriched")
    .select(ENRICHED_COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (error || !data) return null;
  return toDashboardReview(data as unknown as EnrichedRow);
}

/**
 * The period's anchors, for auditing one week's official number.
 *
 * The auditable replacement for "find the last reviewer we counted and count
 * everything above them": per listing, what the period counted and which review
 * closed it — by Google review id, with the reviewer name kept as the
 * human-readable label.
 */
export async function loadPeriodAnchors(periodStart: string): Promise<
  {
    storeCode: string;
    locationName: string | null;
    all: number;
    qualifying: number;
    openingReviewId: string | null;
    openingReviewer: string | null;
    endingReviewId: string | null;
    endingReviewer: string | null;
    snapshotted: boolean;
  }[]
> {
  const { data, error } = await getSupabaseAdmin()
    .from("google_review_period_summary")
    .select(
      "store_code,location_name,all_reviews,qualifying_reviews," +
        "opening_review_id,opening_reviewer,ending_anchor_review_id," +
        "ending_anchor_reviewer,anchor_snapshotted",
    )
    .eq("period_start", periodStart)
    .order("store_code");

  if (error || !data) return [];

  return (
    data as unknown as {
      store_code: string;
      location_name: string | null;
      all_reviews: number;
      qualifying_reviews: number;
      opening_review_id: string | null;
      opening_reviewer: string | null;
      ending_anchor_review_id: string | null;
      ending_anchor_reviewer: string | null;
      anchor_snapshotted: boolean;
    }[]
  ).map((row) => ({
    storeCode: row.store_code,
    locationName: row.location_name,
    all: row.all_reviews,
    qualifying: row.qualifying_reviews,
    openingReviewId: row.opening_review_id,
    openingReviewer: row.opening_reviewer,
    endingReviewId: row.ending_anchor_review_id,
    endingReviewer: row.ending_anchor_reviewer,
    snapshotted: row.anchor_snapshotted,
  }));
}

/** Re-exported so callers do not have to know which module owns week maths. */
export { currentWeekStart, weekEndOf };
