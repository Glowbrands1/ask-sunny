import {
  isFeedbackOutcome,
  isFeedbackRating,
  isFeedbackStatus,
  type FeedbackOutcome,
  type FeedbackRating,
  type FeedbackStatus,
} from "@/lib/feedback/types";
import { isActivitySurface, type ActivitySurface } from "./taxonomy";

/**
 * THE FEEDBACK QUEUE'S OWN FILTERS, on top of the shared analytics ones.
 *
 * SEPARATE FROM `AnalyticsFilters` DELIBERATELY. Those five — date, district,
 * salon, role, leader — narrow every panel on every tab, and putting `status`
 * or `rating` beside them would mean the filter bar offered "3 stars" while the
 * By Location table was on screen, which narrows nothing and explains nothing.
 * These are read only by the Feedback view.
 *
 * SAME URL, THOUGH, and the same reasons the shared ones live there: a queue
 * filtered to "pending, 1 star, Spa Engagement" is a link somebody can send,
 * the page is server-rendered so the filters have to arrive with the request,
 * and moving between tabs must not silently drop what was narrowed.
 *
 * Client-safe. No database client, no secret, no server-only import.
 */

export interface FeedbackFilters {
  status: FeedbackStatus | null;
  outcome: FeedbackOutcome | null;
  rating: FeedbackRating | null;
  surface: ActivitySurface | null;
  /** Free text over the comment. */
  search: string;
  /**
   * Show what has been hidden.
   *
   * OFF BY DEFAULT AND ITS OWN FILTER, never implied by another. Reviewing
   * hidden items is a deliberate act — the point of hiding was to take a
   * comment out of the ordinary view — so it is never reached by narrowing to
   * something else.
   */
  includeHidden: boolean;
  page: number;
}

export const EMPTY_FEEDBACK_FILTERS: FeedbackFilters = {
  status: null,
  outcome: null,
  rating: null,
  surface: null,
  search: "",
  includeHidden: false,
  page: 1,
};

/** Comments per page. Enough to work a queue, small enough to render fast. */
export const FEEDBACK_PAGE_SIZE = 25;

/** A search term longer than this is a paste, not a search. */
const SEARCH_MAX = 120;

function first(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

/**
 * Read the queue's filters out of a request's search params.
 *
 * EVERY VALUE IS VALIDATED INTO ITS OWN TYPE OR DROPPED, the same rule the
 * shared filters follow and for the same reason: each one is passed to a
 * database function as a typed argument, and a junk value must come back as
 * "no filter" rather than as an error page from Postgres.
 *
 * A malformed filter is ignored rather than reported. The filter bar shows what
 * is actually in force, so a dropped value is visible there.
 */
export function parseFeedbackFilters(
  params: Record<string, string | string[] | undefined>,
): FeedbackFilters {
  const statusRaw = first(params.status);
  const outcomeRaw = first(params.outcome);
  const surfaceRaw = first(params.surface);
  const searchRaw = first(params.q);
  const pageRaw = Number(first(params.page));

  /* A rating arrives as text and is compared as a number. */
  const ratingRaw = Number(first(params.stars));

  return {
    status: isFeedbackStatus(statusRaw) ? statusRaw : null,
    outcome: isFeedbackOutcome(outcomeRaw) ? outcomeRaw : null,
    rating: isFeedbackRating(ratingRaw) ? ratingRaw : null,
    surface: isActivitySurface(surfaceRaw) ? surfaceRaw : null,
    search: searchRaw ? searchRaw.slice(0, SEARCH_MAX) : "",
    /* Exactly "1", so a stray `?hidden=maybe` is off rather than on. */
    includeHidden: first(params.hidden) === "1",
    /*
     * A PAGE IS AT LEAST ONE. `Number("")` is 0 and `Number("x")` is NaN, and
     * both would become an offset of -25 without this — which Postgres refuses,
     * turning a mistyped URL into an error page.
     */
    page: Number.isFinite(pageRaw) && pageRaw >= 1 ? Math.floor(pageRaw) : 1,
  };
}

/** The inverse, omitting everything unset. */
export function serializeFeedbackFilters(filters: FeedbackFilters): string {
  const params = new URLSearchParams();
  if (filters.status) params.set("status", filters.status);
  if (filters.outcome) params.set("outcome", filters.outcome);
  if (filters.rating) params.set("stars", String(filters.rating));
  if (filters.surface) params.set("surface", filters.surface);
  if (filters.search.trim()) params.set("q", filters.search.trim());
  if (filters.includeHidden) params.set("hidden", "1");
  /* Page 1 is the default, so it is never written into the URL. */
  if (filters.page > 1) params.set("page", String(filters.page));
  return params.toString();
}

export function hasActiveFeedbackFilters(filters: FeedbackFilters): boolean {
  return (
    filters.status !== null ||
    filters.outcome !== null ||
    filters.rating !== null ||
    filters.surface !== null ||
    filters.search.trim().length > 0 ||
    filters.includeHidden
  );
}
