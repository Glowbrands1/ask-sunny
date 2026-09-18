import { describe, expect, it } from "vitest";

import { planPeriodAssignment } from "../period-assignment";
import { normaliseApifyDataset, readPlaceFacts, readPlaceId, readRating } from "./normalise";

/**
 * ============================================================================
 * THE APIFY NORMALISER — every refusal, and every thing it refuses to guess
 * ============================================================================
 *
 * This is the layer where somebody else's dataset becomes this system's
 * reviews, so it is where the damage would be done. Each case below is a rule
 * somebody could otherwise quietly loosen:
 *
 *   A review with no stable Google id is REFUSED, not filed under a substitute.
 *   A record for a place we do not map is IGNORED, never matched by name.
 *   A listing whose records are not all dated gets NO feed positions, which
 *   makes the reporting model count nothing for it rather than guess.
 *
 * Every reviewer name, review id and place id below is invented.
 */

/** A Google place id shaped like the real thing, for a store we map. */
const PLACE_306 = "ChIJFIXTURE306Manhattan00";
const PLACE_144 = "ChIJFIXTURE144Lincoln27th";
/** A place this system has never heard of. */
const PLACE_STRANGER = "ChIJFIXTUREStrangerPlace0";

const MAPPING = new Map([
  [PLACE_306, "306"],
  [PLACE_144, "144"],
]);

function record(overrides: Record<string, unknown> = {}) {
  return {
    reviewId: "FIXTUREAPIFY0000000001",
    placeId: PLACE_306,
    reviewerName: "Tamsin Vale",
    stars: 5,
    text: "Quick, friendly, and the bed was spotless.",
    publishedAtDate: "2026-09-10T14:05:00.000Z",
    publishedAt: "a week ago",
    title: "Sun Tan City",
    address: "1234 N 3rd St, Manhattan, KS 66502",
    ...overrides,
  };
}

describe("reading a record's fields", () => {
  it("reads a place id directly, and out of a URL that carries one", () => {
    expect(readPlaceId({ placeId: PLACE_306 })).toBe(PLACE_306);
    expect(
      readPlaceId({ url: `https://maps.google.com/?cid=1&place_id=${PLACE_306}` }),
    ).toBe(PLACE_306);
  });

  it("returns null rather than inventing one", () => {
    expect(readPlaceId({})).toBeNull();
    /* A Maps URL with no place_id carries a different KIND of identifier. */
    expect(readPlaceId({ url: "https://www.google.com/maps/place/Sun+Tan+City" })).toBeNull();
  });

  it("accepts the Actor's spelling of the rating, whichever it uses", () => {
    expect(readRating({ stars: 4 })).toBe(4);
    expect(readRating({ rating: 2 })).toBe(2);
    expect(readRating({ stars: "3" })).toBe(3);
  });

  it("refuses a rating that is not a whole 1 to 5", () => {
    expect(readRating({ stars: 0 })).toBeNull();
    expect(readRating({ stars: 6 })).toBeNull();
    expect(readRating({ stars: 4.5 })).toBeNull();
    expect(readRating({})).toBeNull();
  });
});

describe("mapping a dataset onto the fifteen listings", () => {
  it("routes a review by its place id, and keeps every field the dashboard shows", () => {
    const outcome = normaliseApifyDataset([record()], MAPPING);

    expect(outcome.reviews).toHaveLength(1);
    const review = outcome.reviews[0];
    expect(review.storeCode).toBe("306");
    expect(review.externalReviewId).toBe("FIXTUREAPIFY0000000001");
    expect(review.reviewerName).toBe("Tamsin Vale");
    expect(review.rating).toBe(5);
    expect(review.reviewText).toBe("Quick, friendly, and the bed was spotless.");
    /* THE REASON THIS SOURCE IS WORTH HAVING: a real publication instant. */
    expect(review.googleAbsoluteDate).toBe("2026-09-10T14:05:00.000Z");
    /* Google's own wording is kept verbatim beside it, as it always was. */
    expect(review.relativeDateText).toBe("a week ago");
    expect(review.reportedPlaceId).toBe(PLACE_306);
  });

  it("IGNORES a place it does not map — never matches it by business name", () => {
    /*
     * "Sun Tan City" IS A FRANCHISE BRAND. This record looks exactly like one
     * of ours and is a location this business does not operate. A resolver that
     * fell back to the name would file a stranger's review against a real
     * salon, permanently, with nothing on the dashboard looking wrong.
     */
    const outcome = normaliseApifyDataset(
      [
        record({
          placeId: PLACE_STRANGER,
          reviewId: "FIXTURESTRANGER0000001",
          title: "Sun Tan City",
          address: "99 Somewhere Ave, Manhattan, KS 66502",
        }),
      ],
      MAPPING,
    );

    expect(outcome.reviews).toHaveLength(0);
    expect(outcome.unmapped).toBe(1);
    expect(outcome.invalid).toBe(0);
    expect(outcome.problems).toContainEqual({ code: "unknown_place" });
  });

  it("refuses a review with no stable Google id — the one refusal with no fallback", () => {
    const outcome = normaliseApifyDataset(
      [record({ reviewId: undefined }), record({ reviewId: "no" })],
      MAPPING,
    );

    expect(outcome.reviews).toHaveLength(0);
    expect(outcome.invalid).toBe(2);
    expect(outcome.problems.map((problem) => problem.code)).toEqual([
      "missing_review_id",
      "invalid_review_id",
    ]);
  });

  it("refuses a malformed record and a review with no reviewer, and keeps the rest", () => {
    const outcome = normaliseApifyDataset(
      [
        "not an object",
        record({ reviewId: "FIXTUREAPIFY0000000002", reviewerName: "  " }),
        record({ reviewId: "FIXTUREAPIFY0000000003" }),
      ],
      MAPPING,
    );

    /* FORTY GOOD REVIEWS ARE NOT DROPPED BECAUSE THE FORTY-FIRST WAS BAD. */
    expect(outcome.reviews).toHaveLength(1);
    expect(outcome.invalid).toBe(2);
  });

  it("stores a rating-only review, which is a real and common case", () => {
    const outcome = normaliseApifyDataset(
      [record({ text: null, reviewId: "FIXTUREAPIFY0000000004" })],
      MAPPING,
    );

    expect(outcome.reviews).toHaveLength(1);
    /* NULL, NOT AN EMPTY STRING: the dashboard prints "Rating only" for null. */
    expect(outcome.reviews[0].reviewText).toBeNull();
    expect(outcome.reviews[0].rating).toBe(5);
  });

  it("imports an owner response with its date", () => {
    const outcome = normaliseApifyDataset(
      [
        record({
          reviewId: "FIXTUREAPIFY0000000005",
          responseFromOwnerText: "Thank you — see you next visit.",
          responseFromOwnerDate: "2026-09-11T09:00:00.000Z",
        }),
      ],
      MAPPING,
    );

    expect(outcome.reviews[0].hasOwnerResponse).toBe(true);
    expect(outcome.reviews[0].ownerResponseText).toBe("Thank you — see you next visit.");
    expect(outcome.reviews[0].ownerResponseDateText).toBe("2026-09-11T09:00:00.000Z");
  });

  it("keeps the customer's own words, never Google's translation", () => {
    const outcome = normaliseApifyDataset(
      [
        record({
          reviewId: "FIXTUREAPIFY0000000006",
          text: "Muy buen servicio",
          textTranslated: "Very good service",
        }),
      ],
      MAPPING,
    );

    /* The review a salon responds to is the one the customer wrote. */
    expect(outcome.reviews[0].reviewText).toBe("Muy buen servicio");
  });

  it("collapses the same review id appearing twice in one dataset", () => {
    const outcome = normaliseApifyDataset([record(), record()], MAPPING);

    expect(outcome.reviews).toHaveLength(1);
    expect(outcome.problems).toContainEqual({
      code: "duplicate_in_dataset",
      storeCode: "306",
    });
  });
});

describe("the feed order the reporting model rests on", () => {
  it("orders each listing newest-first from Google's own timestamps", () => {
    const outcome = normaliseApifyDataset(
      [
        record({
          reviewId: "FIXTUREOLDER000000001",
          publishedAtDate: "2026-09-01T10:00:00.000Z",
        }),
        record({
          reviewId: "FIXTURENEWEST00000001",
          publishedAtDate: "2026-09-15T10:00:00.000Z",
        }),
        record({
          reviewId: "FIXTUREMIDDLE00000001",
          publishedAtDate: "2026-09-08T10:00:00.000Z",
        }),
      ],
      MAPPING,
    );

    /* 0 IS THE TOP, and the top is the newest — whatever order Apify wrote. */
    expect(
      outcome.reviews.map((review) => [review.externalReviewId, review.feedPosition]),
    ).toEqual([
      ["FIXTURENEWEST00000001", 0],
      ["FIXTUREMIDDLE00000001", 1],
      ["FIXTUREOLDER000000001", 2],
    ]);
  });

  it("indexes each listing from its own top, not from the dataset's", () => {
    const outcome = normaliseApifyDataset(
      [
        record({ reviewId: "FIXTURE306AAAAAAAAAAA" }),
        record({
          reviewId: "FIXTURE144AAAAAAAAAAA",
          placeId: PLACE_144,
          publishedAtDate: "2026-09-12T10:00:00.000Z",
        }),
        record({
          reviewId: "FIXTURE144BBBBBBBBBBB",
          placeId: PLACE_144,
          publishedAtDate: "2026-09-02T10:00:00.000Z",
        }),
      ],
      MAPPING,
    );

    const positions = Object.fromEntries(
      outcome.reviews.map((review) => [review.externalReviewId, review.feedPosition]),
    );
    expect(positions.FIXTURE306AAAAAAAAAAA).toBe(0);
    expect(positions.FIXTURE144AAAAAAAAAAA).toBe(0);
    expect(positions.FIXTURE144BBBBBBBBBBB).toBe(1);
  });

  it("gives a listing NO positions when one of its records is undated", () => {
    /*
     * A PARTIAL ORDERING IS NOT AN ORDERING. The boundary between counted and
     * uncounted could fall on either side of the undated record, so the honest
     * answer is to store everything and count nothing for this listing.
     */
    const outcome = normaliseApifyDataset(
      [
        record({ reviewId: "FIXTUREDATED000000001" }),
        record({ reviewId: "FIXTUREUNDATED0000001", publishedAtDate: undefined }),
      ],
      MAPPING,
    );

    expect(outcome.reviews).toHaveLength(2);
    expect(outcome.reviews.every((review) => review.feedPosition === null)).toBe(true);
    expect(outcome.unorderedStoreCodes).toEqual(["306"]);
    expect(outcome.problems).toContainEqual({
      code: "publication_time_missing",
      storeCode: "306",
    });
  });

  it("an undated listing counts nothing, even where an anchor exists", () => {
    const outcome = normaliseApifyDataset(
      [
        record({ reviewId: "FIXTUREANCHOR000000001", publishedAtDate: undefined }),
        record({ reviewId: "FIXTURENEWER0000000001", publishedAtDate: undefined }),
      ],
      MAPPING,
    );

    const plan = planPeriodAssignment(
      outcome.reviews.map((review) => ({
        externalReviewId: review.externalReviewId,
        storeCode: review.storeCode,
        feedPosition: review.feedPosition ?? null,
        publishedAt: review.googleAbsoluteDate ?? null,
      })),
      new Map([["306", "FIXTUREANCHOR000000001"]]),
    );

    expect(plan.storePlans[0].finding).toBe("feed_position_missing");
    expect(plan.storePlans[0].counted).toBe(0);
    expect([...plan.assignments.values()].every((value) => value === "historical")).toBe(true);
  });

  it("a dated listing counts exactly what sat above its anchor", () => {
    const outcome = normaliseApifyDataset(
      [
        record({
          reviewId: "FIXTUREANCHOR000000002",
          publishedAtDate: "2026-09-01T10:00:00.000Z",
        }),
        record({
          reviewId: "FIXTURENEWER0000000002",
          publishedAtDate: "2026-09-14T10:00:00.000Z",
        }),
        record({
          reviewId: "FIXTURENEWEST000000002",
          publishedAtDate: "2026-09-16T10:00:00.000Z",
        }),
      ],
      MAPPING,
    );

    const plan = planPeriodAssignment(
      outcome.reviews.map((review) => ({
        externalReviewId: review.externalReviewId,
        storeCode: review.storeCode,
        feedPosition: review.feedPosition ?? null,
        publishedAt: review.googleAbsoluteDate ?? null,
      })),
      new Map([["306", "FIXTUREANCHOR000000002"]]),
    );

    expect(plan.storePlans[0].finding).toBeNull();
    expect(plan.storePlans[0].counted).toBe(2);
    /* The anchor itself is never counted again. */
    expect(plan.assignments.get("FIXTUREANCHOR000000002")).toBe("historical");
    /* And the anchor moves to the top of what was just seen. */
    expect(plan.storePlans[0].advanceAnchorTo).toBe("FIXTURENEWEST000000002");
  });

  it("re-running the same dataset assigns the same positions", () => {
    /*
     * IDEMPOTENCE STARTS HERE. If the normaliser reordered records between two
     * runs, the anchor's neighbours would move and the second run could count a
     * review the first already counted.
     */
    const dataset = [
      record({ reviewId: "FIXTURETIEA00000000001", publishedAtDate: "2026-09-10T10:00:00.000Z" }),
      record({ reviewId: "FIXTURETIEB00000000001", publishedAtDate: "2026-09-10T10:00:00.000Z" }),
    ];

    const first = normaliseApifyDataset(dataset, MAPPING);
    const second = normaliseApifyDataset([...dataset].reverse(), MAPPING);

    expect(first.reviews.map((review) => review.externalReviewId)).toEqual(
      second.reviews.map((review) => review.externalReviewId),
    );
  });
});

describe("the place facts used to verify a mapping", () => {
  it("collects one entry per place, keeping the first name and address seen", () => {
    const facts = readPlaceFacts([
      record(),
      record({ reviewId: "FIXTUREAPIFY0000000007", title: null, address: null }),
      record({
        reviewId: "FIXTUREAPIFY0000000008",
        placeId: PLACE_144,
        title: "Sun Tan City",
        address: "500 N 27th St, Lincoln, NE 68503",
      }),
    ]);

    expect(facts).toHaveLength(2);
    const manhattan = facts.find((place) => place.placeId === PLACE_306);
    /* A LATER BLANK MUST NOT ERASE WHAT AN EARLIER RECORD ESTABLISHED. */
    expect(manhattan?.address).toBe("1234 N 3rd St, Manhattan, KS 66502");
    expect(manhattan?.reviewCount).toBe(2);
  });
});
