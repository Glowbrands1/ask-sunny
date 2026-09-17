import "server-only";

import { businessToday, shiftDays } from "@/lib/business-date";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import {
  districtRollups,
  locationRollups,
  summariseReviews,
  weeklyTrend,
  type LocationDirectoryRow,
  type LocationWeekRow,
} from "./aggregate";
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
import type {
  DashboardReview,
  DistrictRollup,
  LocationRollup,
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
 * WHAT IS AGGREGATED IN SQL AND WHAT IS NOT. The counts come from the two
 * rollup views, so a twelve-week trend is tens of rows rather than every review
 * in the estate. The FEED is the only query that reads whole reviews, it is
 * bounded, and it applies exactly the filters the tiles link to — which is what
 * makes "click the 37 and see the 37" true rather than approximately true.
 */

/** How many reviews one page of the feed holds. */
export const FEED_PAGE_SIZE = 100;

/** How much history the trend and the leaderboard read. */
export const TREND_WEEKS = 12;

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
  first_seen_at: string;
  last_seen_at: string;
  has_owner_response: boolean;
  owner_response_text: string | null;
  owner_response_date_text: string | null;
  response_status: string;
  eligible_for_weekly_count: boolean;
  reporting_week_start: string;
  reporting_week_end: string;
  parser_version: string;
}

const ENRICHED_COLUMNS =
  "id,source,external_review_id,store_code,salon_number,location_name,district," +
  "google_location_label,website_url,listing_state,reviewer_name,rating,review_text," +
  "google_relative_date_text,google_absolute_date,first_seen_at,last_seen_at," +
  "has_owner_response,owner_response_text,owner_response_date_text,response_status," +
  "eligible_for_weekly_count,reporting_week_start,reporting_week_end,parser_version";

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
    listingState: row.listing_state === "verification_required"
      ? "verification_required"
      : "verified",
    reviewerName: row.reviewer_name,
    rating: row.rating,
    reviewText: row.review_text,
    relativeDateText: row.google_relative_date_text,
    googleAbsoluteDate: row.google_absolute_date,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    hasOwnerResponse: row.has_owner_response,
    ownerResponseText: row.owner_response_text,
    ownerResponseDateText: row.owner_response_date_text,
    responseStatus: row.response_status === "responded" ? "responded" : "needs_response",
    eligibleForWeeklyCount: row.eligible_for_weekly_count,
    reportingWeekStart: row.reporting_week_start,
    reportingWeekEnd: row.reporting_week_end,
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

  const current = currentWeekStart(today);
  const previous = shiftDays(current, -7);
  const weekStarts = recentWeekStarts(TREND_WEEKS, today);
  const earliest = weekStarts[0];

  const [directoryResult, weekResult, monthResult, syncResult] = await Promise.all([
    supabase
      .from("google_review_location_directory")
      .select(
        "location_id,store_code,salon_number,location_name,district,region," +
          "google_location_label,website_url,listing_state,is_active",
      )
      .order("store_code"),

    /*
     * THE WHOLE TREND WINDOW, not just the selected week: the twelve-week chart
     * and the "versus last week" line both read these rows, and they are counts
     * rather than reviews, so the payload is the number of listings times
     * twelve at most.
     */
    supabase
      .from("google_review_location_weeks")
      .select(
        "location_id,store_code,reporting_week_start,all_reviews,qualifying_reviews," +
          "critical_reviews,unanswered,critical_unanswered," +
          "rating_1,rating_2,rating_3,rating_4,rating_5,rating_sum,last_seen_at",
      )
      .gte("reporting_week_start", earliest),

    /*
     * MONTH TO DATE IS COUNTED DIRECTLY, because reporting weeks run Sunday to
     * Saturday and straddle month boundaries — no sum of whole weeks is a
     * month-to-date figure. `head: true` so only the count crosses the wire.
     */
    monthToDateCount(filters, today),

    supabase
      .from("google_review_sync_runs")
      .select("started_at")
      .order("started_at", { ascending: false })
      .limit(1),
  ]);

  if (directoryResult.error) throw directoryResult.error;
  if (weekResult.error) throw weekResult.error;

  const directoryAll = (directoryResult.data ?? []) as unknown as LocationDirectoryRow[];
  const weekRowsAll = (weekResult.data ?? []) as unknown as LocationWeekRow[];

  /*
   * THE FILTER IS APPLIED TO THE DIRECTORY FIRST, and the week rows are then
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
  const weekRows = weekRowsAll.filter((row) => visible.has(row.location_id));

  const locations = locationRollups(directory, weekRows, {
    currentWeekStart: current,
    previousWeekStart: previous,
  });

  return {
    /* Emptiness is judged on the WHOLE estate, not on the filtered slice: a
       district with no reviews yet is a real answer, not an unconfigured app. */
    empty: weekRowsAll.length === 0,
    summary: summariseReviews(weekRows, {
      currentWeekStart: current,
      previousWeekStart: previous,
      monthToDate: monthResult,
    }),
    trend: weeklyTrend(weekRows, weekStarts),
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
    weekStarts,
    currentWeek: current,
    previousWeek: previous,
    lastSyncAt:
      syncResult.error || !syncResult.data?.length
        ? null
        : (syncResult.data[0] as { started_at: string }).started_at,
  };
}

async function monthToDateCount(
  filters: Pick<ReviewFilters, "district" | "storeCode">,
  today: string,
): Promise<number> {
  let query = getSupabaseAdmin()
    .from("google_reviews_enriched")
    .select("id", { count: "exact", head: true })
    .gte("first_seen_at", `${monthStart(today)}T00:00:00Z`);

  if (filters.district) query = query.eq("district", filters.district);
  if (filters.storeCode) query = query.eq("store_code", filters.storeCode);

  const { count, error } = await query;
  /*
   * A FAILED COUNT READS AS ZERO RATHER THAN FAILING THE PAGE. It is one tile
   * of twelve, and a dashboard that refuses to render because a
   * month-to-date figure timed out is worse than a dashboard missing it.
   */
  if (error) return 0;
  return count ?? 0;
}

/* ------------------------------------------------------------ the feed --- */

/**
 * The individual reviews behind the numbers.
 *
 * THE SAME FILTER VOCABULARY THE TILES LINK WITH. Every drill-down on the page
 * is a link into this function's arguments, so the list a number opens is
 * produced by the same predicate that produced the number — not by a second
 * query written to resemble it.
 */
export async function loadReviewFeed(
  filters: ReviewFilters,
  today: string = businessToday(),
): Promise<ReviewFeed> {
  let query = getSupabaseAdmin()
    .from("google_reviews_enriched")
    .select(ENRICHED_COLUMNS, { count: "exact" });

  if (filters.week === WEEK_CURRENT) {
    query = query.eq("reporting_week_start", currentWeekStart(today));
  } else if (filters.week !== WEEK_ALL) {
    query = query.eq("reporting_week_start", filters.week);
  }

  if (filters.district) query = query.eq("district", filters.district);
  if (filters.storeCode) query = query.eq("store_code", filters.storeCode);

  const bounds = ratingBounds(filters.rating);
  if (bounds) query = query.gte("rating", bounds.min).lte("rating", bounds.max);

  if (filters.status !== "all") query = query.eq("response_status", filters.status);

  if (filters.qualifying !== "all") {
    query = query.eq("eligible_for_weekly_count", filters.qualifying === "yes");
  }

  if (filters.from && filters.to) {
    /*
     * THE WINDOW IS OVER FIRST-SEEN, which is the same clock the reporting week
     * uses. `to` is inclusive of its whole day, so a range ending today
     * includes reviews found this afternoon rather than only those found at
     * midnight.
     */
    query = query
      .gte("first_seen_at", `${filters.from}T00:00:00Z`)
      .lt("first_seen_at", `${shiftDays(filters.to, 1)}T00:00:00Z`);
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
 * The weekly anchors, for auditing one week's official number.
 *
 * The auditable replacement for "find the last reviewer we counted and count
 * everything above them": which review opened and closed the counted run, by
 * Google review id, with the reviewer names kept as the human-readable label.
 */
export async function loadWeekAnchors(weekStart: string): Promise<
  {
    storeCode: string;
    locationName: string | null;
    qualifying: number;
    openingReviewId: string;
    openingReviewer: string;
    endingReviewId: string;
    endingReviewer: string;
  }[]
> {
  const { data, error } = await getSupabaseAdmin()
    .from("google_review_week_anchors")
    .select(
      "store_code,location_name,qualifying_reviews,opening_anchor_review_id," +
        "opening_anchor_reviewer,ending_anchor_review_id,ending_anchor_reviewer",
    )
    .eq("reporting_week_start", weekStart)
    .order("store_code");

  if (error || !data) return [];

  return (
    data as unknown as {
      store_code: string;
      location_name: string | null;
      qualifying_reviews: number;
      opening_anchor_review_id: string;
      opening_anchor_reviewer: string;
      ending_anchor_review_id: string;
      ending_anchor_reviewer: string;
    }[]
  ).map((row) => ({
    storeCode: row.store_code,
    locationName: row.location_name,
    qualifying: row.qualifying_reviews,
    openingReviewId: row.opening_anchor_review_id,
    openingReviewer: row.opening_anchor_reviewer,
    endingReviewId: row.ending_anchor_review_id,
    endingReviewer: row.ending_anchor_reviewer,
  }));
}

/** Re-exported so callers do not have to know which module owns week maths. */
export { currentWeekStart, weekEndOf };
