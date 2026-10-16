import type { IncomingGoogleReview } from "../types";
import type { GbpApiReview, GbpStarRating } from "./types";

/**
 * An official review, cleaned and typed. Nothing here talks to a database.
 *
 * Google's `comment` can arrive as "(Translated by Google) … (Original) …".
 * `comment` keeps exactly what Google sent; `comparableText` is what matching
 * compares — the ORIGINAL wording, because that is what Apify and the Brave
 * extension read off the page.
 */

export interface OfficialReview {
  gbpReviewId: string;
  gbpReviewName: string;
  storeCode: string;
  reviewerName: string;
  rating: number;
  comment: string | null;
  comparableText: string | null;
  createTime: string | null;
  updateTime: string | null;
  replyText: string | null;
  replyUpdateTime: string | null;
}

const STAR: Record<GbpStarRating, number | null> = {
  ONE: 1,
  TWO: 2,
  THREE: 3,
  FOUR: 4,
  FIVE: 5,
  STAR_RATING_UNSPECIFIED: null,
};

const GBP_ID_PATTERN = /^[A-Za-z0-9_-]{6,128}$/;

function iso(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

function clean(value: unknown, limit: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed.slice(0, limit);
}

export function originalText(comment: string | null): string | null {
  if (!comment) return null;
  const marker = comment.indexOf("(Original)");
  if (comment.startsWith("(Translated by Google)") && marker !== -1) {
    const original = comment.slice(marker + "(Original)".length).trim();
    return original === "" ? null : original;
  }
  return comment;
}

export type NormaliseOutcome =
  | { ok: true; review: OfficialReview }
  | { ok: false; code: "invalid_review_id" | "invalid_rating" };

export function normaliseOfficialReview(raw: GbpApiReview, storeCode: string): NormaliseOutcome {
  if (typeof raw.reviewId !== "string" || !GBP_ID_PATTERN.test(raw.reviewId)) {
    return { ok: false, code: "invalid_review_id" };
  }
  const rating = raw.starRating ? STAR[raw.starRating] ?? null : null;
  if (rating === null) return { ok: false, code: "invalid_rating" };

  const comment = clean(raw.comment, 8000);
  const reviewer = raw.reviewer;
  /* Anonymous reviewers have no name; the ingestion layer requires one. */
  const reviewerName =
    reviewer?.isAnonymous || !clean(reviewer?.displayName, 200)
      ? "A Google user"
      : (clean(reviewer?.displayName, 200) as string);

  return {
    ok: true,
    review: {
      gbpReviewId: raw.reviewId,
      gbpReviewName: raw.name,
      storeCode,
      reviewerName,
      rating,
      comment,
      comparableText: originalText(comment),
      createTime: iso(raw.createTime),
      updateTime: iso(raw.updateTime),
      replyText: clean(raw.reviewReply?.comment, 8000),
      replyUpdateTime: iso(raw.reviewReply?.updateTime),
    },
  };
}

/**
 * The shape `ingestGoogleReviews` already accepts. `externalReviewId` is
 * supplied by the caller because it is the EXISTING id for a review already
 * stored and the official id only for one genuinely new.
 */
export function toIncoming(
  review: OfficialReview,
  fields: {
    externalReviewId: string;
    feedPosition: number | null;
    reportedPlaceId: string | null;
    /** Values to file. For a first link these are the STORED values, not Google's. */
    reviewerName: string;
    rating: number;
    reviewText: string | null;
    googleAbsoluteDate: string | null;
    hasOwnerResponse: boolean;
    ownerResponseText: string | null;
  },
): IncomingGoogleReview {
  return {
    externalReviewId: fields.externalReviewId,
    storeCode: review.storeCode,
    reviewerName: fields.reviewerName,
    rating: fields.rating,
    reviewText: fields.reviewText,
    relativeDateText: null,
    googleAbsoluteDate: fields.googleAbsoluteDate,
    hasOwnerResponse: fields.hasOwnerResponse,
    ownerResponseText: fields.ownerResponseText,
    ownerResponseDateText: null,
    feedPosition: fields.feedPosition,
    reportedPlaceId: fields.reportedPlaceId,
  };
}
