import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it } from "vitest";

import { __setSupabaseAdmin } from "@/lib/supabase/server";
import { loadAnchorCandidates, loadAnchorSetup, MAX_ANCHOR_CANDIDATES } from "./anchor-admin";

/**
 * ============================================================================
 * WHAT THE BASELINE SETUP SCREEN IS GIVEN TO SHOW
 * ============================================================================
 *
 * The screen's whole purpose is that somebody can establish each location's
 * starting point without a Google review id, a terminal or SQL. That is a
 * requirement on THIS module more than on the markup: if the rows arriving here
 * did not carry a reviewer's name, a salon number and a count of what is being
 * held, the screen would have nothing to show but ids.
 *
 * Every reviewer, review id and salon name below is invented. The store codes
 * are real, because they are printed on the storefronts.
 */

afterEach(() => {
  __setSupabaseAdmin(null);
});

/* ------------------------------------------------------------ the fifteen -- */

interface DirectoryFixture {
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

function directoryRow(overrides: Partial<DirectoryFixture> = {}): DirectoryFixture {
  return {
    store_code: "306",
    salon_number: "0462",
    location_name: "KS Manhattan",
    district: "District 3",
    google_location_label: "Sun Tan City Manhattan",
    listing_state: "verified",
    counted_through_external_review_id: null,
    counted_through_reviewer: null,
    counted_through_set_at: null,
    historical_reviews: 0,
    held_reviews: 0,
    ...overrides,
  };
}

/** Answers the directory read and the anchors' relative-date read, in order. */
function fakeDirectory(
  rows: DirectoryFixture[],
  relativeDates: Record<string, string | null> = {},
) {
  __setSupabaseAdmin({
    from: (table: string) => {
      if (table === "google_review_location_directory") {
        return { select: () => ({ order: async () => ({ data: rows, error: null }) }) };
      }
      return {
        select: () => ({
          in: async (_column: string, ids: string[]) => ({
            data: ids.map((external_review_id) => ({
              external_review_id,
              google_relative_date_text: relativeDates[external_review_id] ?? null,
            })),
            error: null,
          }),
        }),
      };
    },
  } as unknown as SupabaseClient);
}

describe("loadAnchorSetup", () => {
  it("says, per location, whether anything is being counted", async () => {
    fakeDirectory([
      directoryRow({ store_code: "306", held_reviews: 24, historical_reviews: 24 }),
      directoryRow({
        store_code: "143",
        location_name: "KY Bowling Green",
        salon_number: "0143",
        counted_through_external_review_id: "FIXTURE-ANCHOR-0001",
        counted_through_reviewer: "Marla Quist",
        counted_through_set_at: "2026-09-14T12:00:00.000Z",
        held_reviews: 31,
        historical_reviews: 18,
      }),
    ]);

    const rows = await loadAnchorSetup();

    expect(rows[0]).toMatchObject({
      storeCode: "306",
      trackingActive: false,
      anchorReviewer: null,
      historicalReviews: 24,
      countedReviews: 0,
    });
    expect(rows[1]).toMatchObject({
      storeCode: "143",
      trackingActive: true,
      anchorReviewer: "Marla Quist",
      historicalReviews: 18,
      /* Held minus historical — what this listing has actually counted. */
      countedReviews: 13,
    });
  });

  it("prints BOTH numbering systems, because they do not agree", async () => {
    /*
     * Google's store code 306 is ASK Sunny salon 0462. This is the one screen
     * where the two appear together, and it is how somebody confirms they are
     * anchoring the salon they think they are.
     */
    fakeDirectory([directoryRow({ store_code: "306", salon_number: null })]);

    const [row] = await loadAnchorSetup();

    expect(row.storeCode).toBe("306");
    /* Falls back to the mapping table when reporting has not described it. */
    expect(row.salonNumber).toBe("0462");
    expect(row.salonNumber).not.toBe(row.storeCode);
  });

  it("carries the anchor's own relative date so the boundary can be recognised", async () => {
    fakeDirectory(
      [
        directoryRow({
          counted_through_external_review_id: "FIXTURE-ANCHOR-0001",
          counted_through_reviewer: "Marla Quist",
        }),
      ],
      { "FIXTURE-ANCHOR-0001": "3 weeks ago" },
    );

    const [row] = await loadAnchorSetup();

    expect(row.anchorRelativeDate).toBe("3 weeks ago");
  });

  it("returns every listing, including the ones holding nothing", async () => {
    /* A setup screen that lists only what is already set up is not one. */
    fakeDirectory([
      directoryRow({ store_code: "306" }),
      directoryRow({ store_code: "143", held_reviews: 0, historical_reviews: 0 }),
    ]);

    const rows = await loadAnchorSetup();

    expect(rows).toHaveLength(2);
    expect(rows.every((row) => typeof row.locationName === "string")).toBe(true);
  });
});

/* ----------------------------------------------------------- the candidates -- */

interface ReviewFixture {
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
}

function review(overrides: Partial<ReviewFixture> = {}): ReviewFixture {
  return {
    external_review_id: "FIXTURE-REVIEW-0001",
    reviewer_name: "Tarissa Barry",
    rating: 5,
    review_text: "Clean beds and the staff remembered my name.",
    google_relative_date_text: "a week ago",
    has_owner_response: false,
    feed_position: 1,
    feed_run_id: "run-a",
    google_estimated_at: "2026-09-10T00:00:00.000Z",
    first_seen_at: "2026-09-16T00:00:00.000Z",
    ...overrides,
  };
}

function fakeReviews(rows: ReviewFixture[]) {
  const query = {
    eq: () => query,
    is: () => query,
    order: () => query,
    limit: async () => ({ data: rows, error: null }),
  } as Record<string, unknown>;

  __setSupabaseAdmin({
    from: () => ({ select: () => query }),
  } as unknown as SupabaseClient);
  return query;
}

describe("loadAnchorCandidates", () => {
  it("hands the screen a person and a comment, never an id to read out", async () => {
    fakeReviews([
      review({
        external_review_id: "FIXTURE-REVIEW-0001",
        reviewer_name: "Tarissa Barry",
        rating: 4,
        google_relative_date_text: "2 weeks ago",
        has_owner_response: true,
      }),
    ]);

    const [candidate] = await loadAnchorCandidates("306");

    /* Everything the picker renders. */
    expect(candidate.reviewerName).toBe("Tarissa Barry");
    expect(candidate.rating).toBe(4);
    expect(candidate.commentPreview).toContain("Clean beds");
    expect(candidate.relativeDateText).toBe("2 weeks ago");
    expect(candidate.hasOwnerResponse).toBe(true);

    /*
     * And the id, carried but not for display — it is what the screen submits
     * so the person never types it.
     */
    expect(candidate.externalReviewId).toBe("FIXTURE-REVIEW-0001");
  });

  it("orders by the last sync's own feed position, newest first", async () => {
    /*
     * GOOGLE'S ORDER, NOT OURS. The page is newest-first, and picking "the last
     * one we counted" only makes sense against the order the person saw. Rows
     * arrive here in first-seen order, which is not it.
     */
    fakeReviews([
      review({ external_review_id: "FIXTURE-C", feed_position: 3, reviewer_name: "Third" }),
      review({ external_review_id: "FIXTURE-A", feed_position: 1, reviewer_name: "First" }),
      review({ external_review_id: "FIXTURE-B", feed_position: 2, reviewer_name: "Second" }),
    ]);

    const candidates = await loadAnchorCandidates("306");

    expect(candidates.map((entry) => entry.reviewerName)).toEqual([
      "First",
      "Second",
      "Third",
    ]);
  });

  it("says how many reviews choosing each one would promote", async () => {
    /*
     * The number the person is actually deciding about. Picking the third
     * review down promotes the two above it — and picking the top one promotes
     * nothing, which the screen has to be able to say rather than implying a
     * count will move.
     */
    fakeReviews([
      review({ external_review_id: "FIXTURE-A", feed_position: 1 }),
      review({ external_review_id: "FIXTURE-B", feed_position: 2 }),
      review({ external_review_id: "FIXTURE-C", feed_position: 3 }),
    ]);

    const candidates = await loadAnchorCandidates("306");

    expect(candidates.map((entry) => entry.promotesAbove)).toEqual([0, 1, 2]);
    expect(candidates.every((entry) => entry.inLatestFeed)).toBe(true);
  });

  it("marks a candidate from an earlier sync as promoting nothing", async () => {
    /*
     * A boundary from an older run is still a valid boundary — it stops the
     * next sync counting below it — but its position cannot be compared with
     * what is held now, so nothing is promoted. Saying so beats letting
     * somebody expect a number to move.
     */
    fakeReviews([
      review({ external_review_id: "FIXTURE-NEW", feed_run_id: "run-b", feed_position: 1 }),
      review({
        external_review_id: "FIXTURE-OLD",
        feed_run_id: "run-a",
        feed_position: 4,
        first_seen_at: "2026-08-01T00:00:00.000Z",
        google_estimated_at: "2026-07-20T00:00:00.000Z",
      }),
    ]);

    const candidates = await loadAnchorCandidates("306");

    expect(candidates[0]).toMatchObject({ inLatestFeed: true, promotesAbove: 0 });
    expect(candidates[1]).toMatchObject({ inLatestFeed: false, promotesAbove: 0 });
  });

  it("offers a rating-only review, because that is a real boundary too", async () => {
    fakeReviews([review({ review_text: null })]);

    const [candidate] = await loadAnchorCandidates("306");

    expect(candidate.commentPreview).toBeNull();
  });

  it("trims a long comment rather than letting the picker become a wall of text", async () => {
    fakeReviews([review({ review_text: "x".repeat(400) })]);

    const [candidate] = await loadAnchorCandidates("306");

    expect(candidate.commentPreview?.length).toBeLessThan(200);
    expect(candidate.commentPreview?.endsWith("…")).toBe(true);
  });

  it("asks the database for the historical reviews only, and caps the list", async () => {
    /*
     * A review already counted in a period is not a candidate: choosing it
     * could only do nothing or disturb a settled boundary. The predicate is the
     * database's, so the screen cannot be handed one by mistake.
     */
    const calls: unknown[][] = [];
    const query: Record<string, unknown> = {};
    Object.assign(query, {
      eq: (...args: unknown[]) => {
        calls.push(["eq", ...args]);
        return query;
      },
      is: (...args: unknown[]) => {
        calls.push(["is", ...args]);
        return query;
      },
      order: (...args: unknown[]) => {
        calls.push(["order", ...args]);
        return query;
      },
      limit: async (...args: unknown[]) => {
        calls.push(["limit", ...args]);
        return { data: [], error: null };
      },
    });
    __setSupabaseAdmin({
      from: () => ({ select: () => query }),
    } as unknown as SupabaseClient);

    await loadAnchorCandidates("306");

    expect(calls).toContainEqual(["eq", "store_code", "306"]);
    expect(calls).toContainEqual(["is", "reporting_period_id", null]);
    expect(calls).toContainEqual(["limit", MAX_ANCHOR_CANDIDATES]);
  });
});
