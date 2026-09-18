import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/server";
import { salonForStoreCode } from "./store-codes";
import type { GoogleListingState } from "./types";

/**
 * WHAT THE ANCHOR SETUP SCREEN READS.
 *
 * The screen's job is to let somebody establish each listing's starting point
 * without touching a Google review id, a database or a terminal — so this
 * module's job is to hand it everything that decision needs in the words the
 * person uses: the salon, the store code, whether it is counting, who the
 * anchor is, and what is sitting in history waiting.
 *
 * IT READS. It does not write. Setting an anchor goes through `applyAnchors`,
 * which both doors — the machine credential and the admin screen — share, so
 * the rule about never silently replacing one lives in a single place.
 */

/** One listing's setup state, as the screen shows it. */
export interface AnchorSetupRow {
  storeCode: string;
  /** The salon name from `salon_directory`, or Google's label if it has none. */
  locationName: string;
  /** The ASK Sunny salon number. NOT the store code — see `store-codes.ts`. */
  salonNumber: string | null;
  district: string | null;
  listingState: GoogleListingState;

  /** True when this listing is counting reviews into reporting periods. */
  trackingActive: boolean;
  /** The reviewer whose review is the boundary. Shown instead of the id. */
  anchorReviewer: string | null;
  /** Google's own wording for when that review arrived. */
  anchorRelativeDate: string | null;
  anchorSetAt: string | null;

  /** Held and counted nowhere. What a baseline would leave as history. */
  historicalReviews: number;
  heldReviews: number;
  /** Assigned to some reporting period. */
  countedReviews: number;
}

/** One candidate for "the last review already counted", as the picker shows it. */
export interface AnchorCandidate {
  /**
   * Google's review id. Carried so the screen can submit it, and deliberately
   * NOT rendered: the person picks a reviewer and a comment, not a number.
   */
  externalReviewId: string;
  reviewerName: string;
  rating: number;
  /** Trimmed for the picker. The full text is on the dashboard. */
  commentPreview: string | null;
  relativeDateText: string | null;
  hasOwnerResponse: boolean;
  /**
   * Whether picking this one can promote the reviews above it.
   *
   * Promotion compares FEED POSITION within one sync run, because Google's
   * bucketed wording cannot separate two reviews from the same Tuesday. A
   * candidate from an older run is still a valid boundary — it still stops the
   * next sync counting below it — but nothing already held will be promoted by
   * choosing it, and the screen says so rather than letting somebody expect
   * otherwise.
   */
  inLatestFeed: boolean;
  /** How many held reviews sat above it in that same run. */
  promotesAbove: number;
}

interface DirectoryRow {
  store_code: string;
  salon_number: string | null;
  location_name: string | null;
  district: string | null;
  google_location_label: string;
  listing_state: string;
  counted_through_external_review_id: string | null;
  counted_through_reviewer: string | null;
  counted_through_set_at: string | null;
  historical_reviews: number;
  held_reviews: number;
}

/**
 * Every listing's setup state, in store-code order.
 *
 * ALL FIFTEEN, ALWAYS — the directory view is the row set, so a listing with no
 * reviews and no anchor is present and visibly unconfigured rather than absent.
 * A setup screen that only lists what is already set up is not a setup screen.
 */
export async function loadAnchorSetup(): Promise<AnchorSetupRow[]> {
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from("google_review_location_directory")
    .select(
      "store_code,salon_number,location_name,district,google_location_label," +
        "listing_state,counted_through_external_review_id,counted_through_reviewer," +
        "counted_through_set_at,historical_reviews,held_reviews",
    )
    .order("store_code");

  if (error) throw error;

  const rows = (data ?? []) as unknown as DirectoryRow[];

  /*
   * THE ANCHOR'S OWN RELATIVE DATE, fetched in one round trip for every
   * listing that has one. The directory view carries the reviewer's name
   * because that is what a person recognises; the date is what tells them
   * whether the boundary is where they think it is, and it lives on the review.
   */
  const anchorIds = rows
    .map((row) => row.counted_through_external_review_id)
    .filter((id): id is string => Boolean(id));

  const relativeDates = new Map<string, string | null>();
  if (anchorIds.length > 0) {
    const { data: anchors } = await supabase
      .from("google_reviews")
      .select("external_review_id,google_relative_date_text")
      .in("external_review_id", anchorIds);

    for (const anchor of (anchors ?? []) as {
      external_review_id: string;
      google_relative_date_text: string | null;
    }[]) {
      relativeDates.set(anchor.external_review_id, anchor.google_relative_date_text);
    }
  }

  return rows.map((row) => ({
    storeCode: row.store_code,
    locationName: row.location_name ?? row.google_location_label,
    /*
     * FROM THE ROSTER WHEN REPORTING HAS NOT DESCRIBED THE SALON. The mapping
     * table knows which salon a store code is even when `salon_directory` has
     * nothing to say about it, and printing the number is half the point of
     * this screen: it is the one place the two numbering systems appear side by
     * side, where somebody can see that Google's 306 is salon 0462.
     */
    salonNumber: row.salon_number ?? salonForStoreCode(row.store_code)?.salonNumber ?? null,
    district: row.district,
    listingState:
      row.listing_state === "verification_required" ? "verification_required" : "verified",
    trackingActive: row.counted_through_external_review_id !== null,
    anchorReviewer: row.counted_through_reviewer,
    anchorRelativeDate: row.counted_through_external_review_id
      ? (relativeDates.get(row.counted_through_external_review_id) ?? null)
      : null,
    anchorSetAt: row.counted_through_set_at,
    historicalReviews: row.historical_reviews ?? 0,
    heldReviews: row.held_reviews ?? 0,
    countedReviews: (row.held_reviews ?? 0) - (row.historical_reviews ?? 0),
  }));
}

/** How much of a comment the picker shows before it becomes a wall of text. */
const PREVIEW_LENGTH = 160;

/** The most candidates one picker will list. A boundary is near the top. */
export const MAX_ANCHOR_CANDIDATES = 60;

/**
 * The held reviews for one listing, newest first, as candidates for the anchor.
 *
 * ORDERED THE WAY GOOGLE SHOWED THEM. The most recent sync's own feed order is
 * the only exact ordering this system has, so reviews from that run come first
 * in their page order; anything held from an earlier run follows, ordered by the
 * approximate date derived from Google's wording. The distinction is carried
 * into `inLatestFeed` rather than hidden, because it decides whether picking a
 * candidate promotes anything.
 *
 * HISTORICAL ONLY. A review already counted in a period is not a candidate:
 * choosing it could only either do nothing or promote reviews around an
 * already-settled boundary, and neither is a thing anybody means to ask for.
 */
export async function loadAnchorCandidates(storeCode: string): Promise<AnchorCandidate[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("google_reviews_enriched")
    .select(
      "external_review_id,reviewer_name,rating,review_text,google_relative_date_text," +
        "has_owner_response,feed_position,feed_run_id,google_estimated_at,first_seen_at",
    )
    .eq("store_code", storeCode)
    .is("reporting_period_id", null)
    .order("first_seen_at", { ascending: false })
    .limit(MAX_ANCHOR_CANDIDATES);

  if (error) throw error;

  const rows = (data ?? []) as unknown as {
    external_review_id: string;
    reviewer_name: string;
    rating: number;
    review_text: string | null;
    google_relative_date_text: string | null;
    has_owner_response: boolean;
    feed_position: number | null;
    feed_run_id: string | null;
    google_estimated_at: string | null;
    first_seen_at: string;
  }[];

  /*
   * WHICH RUN IS THE LATEST. The rows arrive newest-first by first-seen, so the
   * first row carrying a run id belongs to the most recent sync that saw any of
   * them — which is the run whose positions can be compared.
   */
  const latestRun = rows.find((row) => row.feed_run_id !== null)?.feed_run_id ?? null;

  const inRun = rows.filter(
    (row) => latestRun !== null && row.feed_run_id === latestRun && row.feed_position !== null,
  );
  const rest = rows.filter((row) => !inRun.includes(row));

  inRun.sort((a, b) => (a.feed_position as number) - (b.feed_position as number));
  rest.sort((a, b) => {
    const left = Date.parse(a.google_estimated_at ?? a.first_seen_at);
    const right = Date.parse(b.google_estimated_at ?? b.first_seen_at);
    return right - left;
  });

  return [...inRun, ...rest].map((row, index) => {
    const inLatestFeed = inRun.includes(row);
    return {
      externalReviewId: row.external_review_id,
      reviewerName: row.reviewer_name,
      rating: row.rating,
      commentPreview: row.review_text
        ? row.review_text.length > PREVIEW_LENGTH
          ? `${row.review_text.slice(0, PREVIEW_LENGTH).trimEnd()}…`
          : row.review_text
        : null,
      relativeDateText: row.google_relative_date_text,
      hasOwnerResponse: row.has_owner_response,
      inLatestFeed,
      /*
       * How many held reviews sat above it in the same run — which is exactly
       * how many the anchor would promote. Zero for a candidate outside the
       * latest run, and zero for the top of the page, both of which are true.
       */
      promotesAbove: inLatestFeed ? index : 0,
    };
  });
}
