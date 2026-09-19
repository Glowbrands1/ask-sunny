/**
 * THE GOOGLE REVIEW SHAPES, shared by the API route, the read layer and the
 * dashboard.
 *
 * Client-safe. No database client, no secret, no `server-only` import — the
 * screen renders these and the route validates into them.
 */

export type GoogleReviewSource = "google_business_profile";

export type ReviewResponseStatus = "needs_response" | "responded";

export type GoogleListingState = "verified" | "verification_required";

/**
 * WHETHER A REVIEW COUNTS TOWARD A REPORTING PERIOD AT ALL.
 *
 *   historical       Stored, shown, searchable — and counted nowhere. Every
 *                    import starts here, which is what stops a backlog landing
 *                    in the week somebody happened to press Sync.
 *   anchor_assigned  Proven to sit above its listing's anchor, and therefore
 *                    assigned to the period that was open at the time.
 */
export type ReviewAssignmentStatus = "historical" | "anchor_assigned";

/**
 * ONE REVIEW AS THE EXTENSION REPORTS IT.
 *
 * Everything here is UNTRUSTED. It was read out of a page Google renders and
 * posted by a browser extension, so every field is validated at the route and
 * again in the database. What the extension may NOT send is as important as
 * what it may: there is no field for a salon id, a district, a reporting week
 * or an eligibility flag, because all four are decided on the server. The
 * extension reports what Google showed; it does not get to say what it means.
 */
export interface IncomingGoogleReview {
  /** Google's own review id, from `data-lid`. The deduplication key. */
  externalReviewId: string;
  /** Google's store code as rendered. Never a salon number — see `store-codes.ts`. */
  storeCode: string;
  reviewerName: string;
  rating: number;
  /** Null or absent means "rating only", which is a real and common case. */
  reviewText?: string | null;
  /** "7 hours ago", "2 days ago" — preserved verbatim, never converted. */
  relativeDateText?: string | null;
  /**
   * GOOGLE'S OWN PUBLICATION INSTANT, when the source can supply one.
   *
   * The Business Profile page renders relative wording, so the Brave transport
   * leaves this null and `relativeDateText` carries what Google showed. The
   * Apify transport returns a real ISO timestamp, and for those reviews this is
   * the canonical Google review date — persisted to `google_absolute_date`,
   * shown in the detail panel, and used to order a backlog on screen.
   *
   * IT IS STILL NOT THE REPORTING PERIOD KEY, and `first_seen_at` still is not
   * the review date. Which period a review counts in is decided by its position
   * against the listing's anchor, for the reasons in `period-assignment.ts`.
   */
  googleAbsoluteDate?: string | null;
  hasOwnerResponse?: boolean;
  ownerResponseText?: string | null;
  ownerResponseDateText?: string | null;
  /**
   * Where this review sat in its listing's run on the page — 0 is the top.
   *
   * THE ONLY ORDERING SIGNAL THIS SYSTEM HAS, and what the reporting period
   * rests on: a review counts when it sat above the listing's anchor. Null
   * means the caller did not say, and a listing whose positions are unknown
   * counts nothing rather than guessing.
   */
  feedPosition?: number | null;
  /**
   * The Google place the SOURCE said this came from, for audit only.
   *
   * IT DOES NOT DECIDE THE SALON. `storeCode` does, resolved through the
   * verified mapping before this record was built. Storing what the source
   * claimed lets a later mismatch be seen; letting it route would mean a
   * scraped identifier could file reviews against any salon it named.
   */
  reportedPlaceId?: string | null;
}

/** What one accepted sync did, as the route answers and the popup displays. */
export interface ReviewSyncResult {
  runId: string | null;
  received: number;
  created: number;
  updated: number;
  /** Seen before and unchanged. "Already synced" in the extension's wording. */
  duplicates: number;
  /** Reviews for a business that is not one of the fifteen. Not an error. */
  ignoredNonStc: number;
  /** Refused on shape: a bad id, a rating outside 1-5, a missing name. */
  invalid: number;
  /**
   * THE TWO FIGURES THAT DECIDE WHETHER A NUMBER MOVED.
   *
   * `created` says how many rows are new; these say how many of them the
   * business will count. A first sync of a backlog reports a large `created`
   * and a `countedIntoPeriod` of zero, which is exactly right and is what the
   * extension shows the manager.
   */
  countedIntoPeriod: number;
  storedAsHistorical: number;
  /** Listings that counted nothing for a reason, and what to do about it. */
  storeFindings: { storeCode: string; finding: string; reviews: number }[];
  /** Refusal CODES only. Never a reviewer name and never review text. */
  problems: { code: string; storeCode?: string }[];
}

/** One review as the dashboard reads it, from `google_reviews_enriched`. */
export interface DashboardReview {
  id: string;
  source: GoogleReviewSource;
  externalReviewId: string;
  storeCode: string;
  salonNumber: string | null;
  locationName: string;
  district: string | null;
  websiteUrl: string | null;
  listingState: GoogleListingState;
  reviewerName: string;
  rating: number;
  /** Null means Google carried a rating and no words. */
  reviewText: string | null;
  relativeDateText: string | null;
  googleAbsoluteDate: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  hasOwnerResponse: boolean;
  ownerResponseText: string | null;
  ownerResponseDateText: string | null;
  responseStatus: ReviewResponseStatus;
  /** Generated in the database from the rating. 3, 4 and 5 count. */
  eligibleForWeeklyCount: boolean;

  /**
   * THE REPORTING PERIOD, OR NULL.
   *
   * Null is not a missing value — it is the answer "this review counts toward
   * nothing", which is where every import starts and where anything whose
   * position could not be proven stays.
   */
  reportingPeriodId: string | null;
  reportingAssignmentStatus: ReviewAssignmentStatus;
  periodStart: string | null;
  periodEnd: string | null;

  /**
   * The week ASK Sunny first saw it. AUDIT METADATA — it decides nothing, and
   * it is shown in the detail panel beside first/last seen rather than
   * anywhere a number is computed.
   */
  firstSeenWeek: string;
  /** Approximate, derived from Google's relative text. Never a period key. */
  googleEstimatedAt: string | null;
  parserVersion: string;
}

/** A location's totals for the leaderboard and the location drill-down. */
export interface LocationRollup {
  storeCode: string;
  locationName: string;
  district: string | null;
  salonNumber: string | null;
  listingState: GoogleListingState;
  /**
   * THE LISTING'S REPORTING ANCHOR. Null means nothing is being counted for
   * this salon yet, which the leaderboard has to be able to say out loud.
   */
  anchorReviewId: string | null;
  anchorReviewer: string | null;
  /** Held reviews assigned to no period. Imported backlog, counted nowhere. */
  historical: number;
  /** Reviews assigned to the current reporting period, all ratings. */
  reviewsThisWeek: number;
  /** Of those, the 3-, 4- and 5-star ones. */
  qualifyingThisWeek: number;
  lastWeek: number;
  unanswered: number;
  criticalOpen: number;
  averageRating: number | null;
  total: number;
}

/** A district's totals, rolled up from the locations inside it. */
export interface DistrictRollup {
  district: string;
  locations: number;
  reviewsThisWeek: number;
  qualifyingThisWeek: number;
  unanswered: number;
  averageRating: number | null;
  total: number;
}

/**
 * ============================================================================
 * HOW THE SYNCED GOOGLE REVIEWS SPLIT BY STAR RATING
 * ============================================================================
 *
 * AN ANALYTICS DISTRIBUTION OVER THE REVIEW RECORDS, and deliberately not a
 * reporting figure. It is built from the same stored reviews the over-time
 * chart is built from — `google_reviews_enriched` — so it is true the moment a
 * review is stored, and it answers "what are customers giving us" rather than
 * "what did the week count".
 *
 * NOTHING ABOUT WEEKLY QUALIFICATION DECIDES MEMBERSHIP. Not the baseline, not
 * the anchor, not `reporting_period_id` and not `eligible_for_weekly_count`:
 * every review the filters admit is in exactly one of the five buckets. That is
 * the whole of the correction — the card used to be summed from
 * `google_review_location_periods`, which holds only reviews that were proven
 * to sit above their listing's baseline, so an estate with no baselines set
 * showed five zeroes beside a chart drawing hundreds of real reviews.
 *
 * `total` IS THE SUM OF THE FIVE BUCKETS, computed in one place so the heading
 * and the rows cannot disagree. See `ratingDistribution` in `aggregate.ts`.
 */
export interface RatingDistribution {
  /** Index 0 is 1 star, index 4 is 5 stars. */
  counts: [number, number, number, number, number];
  /** The sum of the five buckets, and the figure the card's heading prints. */
  total: number;
}

/** One column of the twelve-period trend. */
export interface WeeklyTrendPoint {
  weekStart: string;
  label: string;
  /** Every review ASSIGNED to that period, 1-5 stars. Never the backlog. */
  all: number;
  /** The 3-, 4- and 5-star subset: the official weekly number. */
  qualifying: number;
  /** 1- and 2-star reviews in that period. Stored, shown, not counted. */
  critical: number;
  /** Still without an owner response right now. */
  unanswered: number;
}

/** The headline figures, each one traceable to the reviews behind it. */
export interface ReviewSummary {
  /** The open reporting period. Every "this week" figure below is its. */
  periodId: string | null;
  weekStart: string;
  weekEnd: string;
  qualifyingThisWeek: number;
  allNewThisWeek: number;
  criticalNeedingAttention: number;
  unanswered: number;
  averageRating: number | null;
  /** Index 0 is 1 star, index 4 is 5 stars. Over the window, not all time. */
  byRating: [number, number, number, number, number];
  monthToDate: number;
  qualifyingLastWeek: number;
  allNewLastWeek: number;
  /** Reviews held in total, counted and historical alike. */
  totalReviews: number;
  /**
   * HELD AND COUNTED NOWHERE. Shown separately and never folded into a weekly
   * figure — the whole point of the correction.
   */
  historicalReviews: number;
  /** Listings with no anchor at all, so nothing is being counted for them. */
  listingsWithoutAnchor: number;
}
