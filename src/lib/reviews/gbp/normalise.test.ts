import { describe, expect, it } from "vitest";

import { normaliseOfficialReview, originalText } from "./normalise";

const raw = {
  name: "accounts/1/locations/2/reviews/AbCdEf123456",
  reviewId: "AbCdEf123456",
  reviewer: { displayName: "Sarah Miller" },
  starRating: "FOUR" as const,
  comment: "Great  place",
  createTime: "2026-10-01T15:00:00Z",
  updateTime: "2026-10-02T15:00:00Z",
  reviewReply: { comment: "Thanks!", updateTime: "2026-10-02T16:00:00Z" },
};

describe("normaliseOfficialReview", () => {
  it("maps ratings, text, timestamps, reviewer and owner reply", () => {
    const outcome = normaliseOfficialReview(raw, "306");
    expect(outcome.ok && outcome.review).toMatchObject({
      gbpReviewId: "AbCdEf123456",
      storeCode: "306",
      rating: 4,
      reviewerName: "Sarah Miller",
      comment: "Great  place",
      createTime: "2026-10-01T15:00:00.000Z",
      replyText: "Thanks!",
    });
  });

  it("rejects an unspecified rating and a malformed id instead of guessing", () => {
    expect(normaliseOfficialReview({ ...raw, starRating: "STAR_RATING_UNSPECIFIED" }, "306")).toEqual({ ok: false, code: "invalid_rating" });
    expect(normaliseOfficialReview({ ...raw, reviewId: "x" }, "306")).toEqual({ ok: false, code: "invalid_review_id" });
  });

  it("gives anonymous reviewers a placeholder name", () => {
    const outcome = normaliseOfficialReview({ ...raw, reviewer: { isAnonymous: true } }, "306");
    expect(outcome.ok && outcome.review.reviewerName).toBe("A Google user");
  });

  it("compares the original wording of a translated review", () => {
    expect(originalText("(Translated by Google)\nNice\n\n(Original)\nBien")).toBe("Bien");
    expect(originalText("Plain")).toBe("Plain");
    expect(originalText(null)).toBeNull();
  });

  it("treats a rating-only review as having no comment", () => {
    const outcome = normaliseOfficialReview({ ...raw, comment: undefined }, "306");
    expect(outcome.ok && outcome.review.comment).toBeNull();
  });
});
