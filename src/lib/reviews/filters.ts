import { ALLOWED_STORE_CODES } from "./store-codes";
import { ISO_DATE_PATTERN } from "./reporting-week";

/**
 * THE GOOGLE REVIEWS FILTERS, AND THE URL THEY LIVE IN.
 *
 * Held in the query string rather than in React state, for the reasons the
 * analytics filters already record and one more that is specific to this page:
 *
 *   A FILTERED VIEW IS A LINK. "Here are the four reviews waiting on your
 *   district" is something a DM can be sent.
 *
 *   THE PAGE IS SERVER-RENDERED, so the filters have to arrive with the
 *   request rather than being applied after hydration.
 *
 *   EVERY DASHBOARD NUMBER IS A LINK INTO THIS SAME FEED. "Qualifying this week
 *   = 37" is an anchor carrying `?week=current&qualifying=yes`, and clicking it
 *   shows exactly those 37 records. That only works if the feed's state is
 *   expressible as a URL — which is why drill-down and filtering are one
 *   mechanism here rather than two.
 *
 * Client-safe. No database client, no secret, no server-only import.
 */

export const RATING_FILTERS = [
  { key: "all", label: "All ratings" },
  { key: "1", label: "1 star" },
  { key: "2", label: "2 stars" },
  { key: "3", label: "3 stars" },
  { key: "4", label: "4 stars" },
  { key: "5", label: "5 stars" },
  { key: "1-2", label: "1–2 stars" },
  { key: "3-5", label: "3–5 stars" },
] as const;

export type RatingFilter = (typeof RATING_FILTERS)[number]["key"];

export const STATUS_FILTERS = [
  { key: "all", label: "All" },
  { key: "needs_response", label: "Needs response" },
  { key: "responded", label: "Responded" },
] as const;

export type StatusFilter = (typeof STATUS_FILTERS)[number]["key"];

export const QUALIFYING_FILTERS = [
  { key: "all", label: "All reviews" },
  { key: "yes", label: "Counts toward weekly" },
  { key: "no", label: "Does not count" },
] as const;

export type QualifyingFilter = (typeof QUALIFYING_FILTERS)[number]["key"];

/**
 * `current` is resolved against the business date at read time rather than
 * frozen into the link, so a URL shared on Friday still means "this week" when
 * it is opened on Monday. A specific `yyyy-mm-dd` names one week for good.
 */
export const WEEK_ALL = "all";
export const WEEK_CURRENT = "current";

export interface ReviewFilters {
  /** `current`, `all`, or the `yyyy-mm-dd` Sunday of one reporting week. */
  week: string;
  district: string | null;
  /** One of the fifteen Google store codes. Location and store code are one filter. */
  storeCode: string | null;
  rating: RatingFilter;
  status: StatusFilter;
  qualifying: QualifyingFilter;
  /** A custom window over first-seen. Both ends or neither. */
  from: string | null;
  to: string | null;
  /** Reviewer name, review comment, or location name. */
  search: string | null;
  /** The review whose detail panel is open, by id. Not a filter on the feed. */
  openReviewId: string | null;
}

export const EMPTY_REVIEW_FILTERS: ReviewFilters = {
  week: WEEK_ALL,
  district: null,
  storeCode: null,
  rating: "all",
  status: "all",
  qualifying: "all",
  from: null,
  to: null,
  search: null,
  openReviewId: null,
};

/** True when anything is narrowing the feed. What Reset clears. */
export function hasActiveReviewFilters(filters: ReviewFilters): boolean {
  return (
    filters.week !== WEEK_ALL ||
    filters.district !== null ||
    filters.storeCode !== null ||
    filters.rating !== "all" ||
    filters.status !== "all" ||
    filters.qualifying !== "all" ||
    filters.from !== null ||
    filters.to !== null ||
    (filters.search?.length ?? 0) > 0
  );
}

const UUID =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/** The longest search string accepted. Longer is truncated, not refused. */
export const SEARCH_LIMIT = 120;

function first(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

/**
 * Reads the filters out of a request's search params.
 *
 * EVERY VALUE IS VALIDATED INTO ITS OWN TYPE OR DROPPED, because each one
 * reaches a database query as a typed argument. A hand-edited URL must come
 * back as "no filter" rather than as an error page from Postgres, and an
 * unvalidated string must never reach a query.
 *
 * A malformed filter is silently ignored rather than reported: the filter bar
 * shows what is actually in force, so a dropped value is visible there, and an
 * error screen for a mistyped URL helps nobody.
 */
export function parseReviewFilters(
  params: Record<string, string | string[] | undefined>,
): ReviewFilters {
  const weekRaw = first(params.week);
  const week =
    weekRaw === WEEK_CURRENT || (weekRaw && ISO_DATE_PATTERN.test(weekRaw))
      ? weekRaw
      : WEEK_ALL;

  const fromRaw = first(params.from);
  const toRaw = first(params.to);
  const from = fromRaw && ISO_DATE_PATTERN.test(fromRaw) ? fromRaw : null;
  const to = toRaw && ISO_DATE_PATTERN.test(toRaw) ? toRaw : null;

  const ratingRaw = first(params.rating);
  const statusRaw = first(params.status);
  const qualifyingRaw = first(params.qualifying);
  const storeRaw = first(params.store);
  const districtRaw = first(params.district);
  const searchRaw = first(params.q);
  const reviewRaw = first(params.review);

  return {
    week,
    district: districtRaw && districtRaw.trim() !== "" ? districtRaw.trim().slice(0, 120) : null,
    /*
     * ONLY A CODE THIS SYSTEM INGESTS. A filter naming a store we hold no
     * reviews for would silently show an empty feed and read as "no reviews
     * this week" rather than as a mistyped URL.
     */
    storeCode: storeRaw && ALLOWED_STORE_CODES.includes(storeRaw) ? storeRaw : null,
    rating: RATING_FILTERS.some((entry) => entry.key === ratingRaw)
      ? (ratingRaw as RatingFilter)
      : "all",
    status: STATUS_FILTERS.some((entry) => entry.key === statusRaw)
      ? (statusRaw as StatusFilter)
      : "all",
    qualifying: QUALIFYING_FILTERS.some((entry) => entry.key === qualifyingRaw)
      ? (qualifyingRaw as QualifyingFilter)
      : "all",
    /* BOTH ENDS OR NEITHER: one end of a window is not a window. */
    from: from && to ? from : null,
    to: from && to ? to : null,
    search: searchRaw && searchRaw.trim() !== "" ? searchRaw.trim().slice(0, SEARCH_LIMIT) : null,
    openReviewId: reviewRaw && UUID.test(reviewRaw) ? reviewRaw : null,
  };
}

/** The inverse: filters back into a query string, omitting everything unset. */
export function serializeReviewFilters(filters: Partial<ReviewFilters>): string {
  const params = new URLSearchParams();
  if (filters.week && filters.week !== WEEK_ALL) params.set("week", filters.week);
  if (filters.district) params.set("district", filters.district);
  if (filters.storeCode) params.set("store", filters.storeCode);
  if (filters.rating && filters.rating !== "all") params.set("rating", filters.rating);
  if (filters.status && filters.status !== "all") params.set("status", filters.status);
  if (filters.qualifying && filters.qualifying !== "all") {
    params.set("qualifying", filters.qualifying);
  }
  if (filters.from && filters.to) {
    params.set("from", filters.from);
    params.set("to", filters.to);
  }
  if (filters.search) params.set("q", filters.search);
  if (filters.openReviewId) params.set("review", filters.openReviewId);
  return params.toString();
}

/**
 * A link to the reviews page carrying a set of filters.
 *
 * Used by every clickable figure on the page, which is how "click the number
 * and see the reviews behind it" is implemented: a drill-down is a link to this
 * same feed with the same filter vocabulary, not a separate view with its own
 * idea of what a week is.
 */
export function reviewsHref(filters: Partial<ReviewFilters>): string {
  const query = serializeReviewFilters(filters);
  return query ? `/reviews?${query}#review-feed` : "/reviews#review-feed";
}

/** The inclusive rating bounds a rating filter means, or null for "all". */
export function ratingBounds(rating: RatingFilter): { min: number; max: number } | null {
  if (rating === "all") return null;
  if (rating === "1-2") return { min: 1, max: 2 };
  if (rating === "3-5") return { min: 3, max: 5 };
  const exact = Number(rating);
  return { min: exact, max: exact };
}
