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
  /** Reserved for when Google ever exposes a real posting time. */
  googleAbsoluteDate?: string | null;
  hasOwnerResponse?: boolean;
  ownerResponseText?: string | null;
  ownerResponseDateText?: string | null;
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
  reportingWeekStart: string;
  reportingWeekEnd: string;
  parserVersion: string;
}

/** A location's totals for the leaderboard and the location drill-down. */
export interface LocationRollup {
  storeCode: string;
  locationName: string;
  district: string | null;
  salonNumber: string | null;
  listingState: GoogleListingState;
  /** Reviews first seen in the selected week, all ratings. */
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

/** One column of the twelve-week trend. */
export interface WeeklyTrendPoint {
  weekStart: string;
  label: string;
  /** Every review first seen that week, 1-5 stars. */
  all: number;
  /** The 3-, 4- and 5-star subset: the official weekly number. */
  qualifying: number;
  /** 1- and 2-star reviews first seen that week. Stored, shown, not counted. */
  critical: number;
  /** Still without an owner response right now. */
  unanswered: number;
}

/** The headline figures, each one traceable to the reviews behind it. */
export interface ReviewSummary {
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
  /** Reviews held in total, all weeks. */
  totalReviews: number;
}
