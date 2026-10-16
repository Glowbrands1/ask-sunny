import { describe, expect, it } from "vitest";

import type { OfficialReview } from "./normalise";
import { reconcileLocation, type StoredReview } from "./reconcile";

const T = "2026-10-01T15:00:00.000Z";
const official = (id: string, over: Partial<OfficialReview> = {}): OfficialReview => ({
  gbpReviewId: id,
  gbpReviewName: `accounts/1/locations/2/reviews/${id}`,
  storeCode: "306",
  reviewerName: "Sarah Miller",
  rating: 5,
  comment: "Loved it",
  comparableText: "Loved it",
  createTime: T,
  updateTime: T,
  replyText: null,
  replyUpdateTime: null,
  ...over,
});
const stored = (id: string, over: Partial<StoredReview> = {}): StoredReview => ({
  id,
  externalReviewId: `ext-${id}-${"x".repeat(60)}`,
  gbpReviewId: null,
  reviewerName: "Sarah Miller",
  rating: 5,
  reviewText: "Loved it",
  googleAbsoluteDate: T,
  hasOwnerResponse: false,
  ownerResponseText: null,
  ...over,
});
const kinds = (plan: ReturnType<typeof reconcileLocation>) => plan.decisions.map((d) => d.kind);

describe("reconcileLocation", () => {
  it("auto-matches a review whose name, rating, text and timestamp all agree and are unique", () => {
    const plan = reconcileLocation([official("GBP00001")], [stored("a")]);
    expect(plan.decisions[0]).toMatchObject({ kind: "auto_match", stored: { id: "a" } });
    expect(plan.unmatchedStored).toEqual([]);
  });

  it("absorbs a scraper timestamp off by hours when the text is identical", () => {
    const plan = reconcileLocation([official("GBP00001")], [stored("a", { googleAbsoluteDate: "2026-10-01T09:00:00.000Z" })]);
    expect(kinds(plan)).toEqual(["auto_match"]);
  });

  it("requires a tight timestamp when there is no text to corroborate", () => {
    const noText = { comment: null, comparableText: null };
    const tight = reconcileLocation([official("GBP00001", noText)], [stored("a", { reviewText: null, googleAbsoluteDate: "2026-10-01T15:01:00.000Z" })]);
    expect(kinds(tight)).toEqual(["auto_match"]);
    const loose = reconcileLocation([official("GBP00001", noText)], [stored("a", { reviewText: null, googleAbsoluteDate: "2026-10-01T09:00:00.000Z" })]);
    expect(kinds(loose)).toEqual(["needs_review"]);
  });

  it("NEVER matches on name, rating and text alone: a stored row without a timestamp goes to a person", () => {
    const plan = reconcileLocation([official("GBP00001")], [stored("a", { googleAbsoluteDate: null })]);
    expect(plan.decisions[0]).toMatchObject({ kind: "needs_review", reasons: expect.arrayContaining(["no_timestamp_on_existing"]) });
  });

  it("declares a review new only when nothing stored resembles it", () => {
    const plan = reconcileLocation(
      [official("GBP00001")],
      [stored("a", { reviewerName: "Someone Else", reviewText: "Different", rating: 2, googleAbsoluteDate: "2025-01-01T00:00:00.000Z" })],
    );
    expect(kinds(plan)).toEqual(["new"]);
    expect(plan.unmatchedStored.map((s) => s.id)).toEqual(["a"]);
  });

  it("does not file a duplicate when the name format differs (Sarah M vs Sarah Miller)", () => {
    const plan = reconcileLocation([official("GBP00001")], [stored("a", { reviewerName: "Sarah M" })]);
    expect(kinds(plan)).toEqual(["needs_review"]);
    expect(plan.decisions[0]).toMatchObject({ reasons: expect.arrayContaining(["name_differs"]) });
  });

  it("sends an edited rating to review rather than overwriting or duplicating", () => {
    const plan = reconcileLocation([official("GBP00001", { rating: 3 })], [stored("a")]);
    expect(plan.decisions[0]).toMatchObject({ kind: "needs_review", reasons: expect.arrayContaining(["rating_differs"]) });
  });

  it("refuses to choose between two identical stored candidates", () => {
    const plan = reconcileLocation([official("GBP00001")], [stored("a"), stored("b")]);
    expect(plan.decisions[0]).toMatchObject({ kind: "needs_review", reasons: expect.arrayContaining(["multiple_candidates"]) });
  });

  it("refuses when two official reviews contend for one stored row", () => {
    const plan = reconcileLocation([official("GBP00001"), official("GBP00002")], [stored("a")]);
    expect(kinds(plan)).toEqual(["needs_review", "needs_review"]);
    expect(plan.decisions[0]).toMatchObject({ reasons: expect.arrayContaining(["candidate_claimed_by_another_review"]) });
  });

  it("two same-name same-rating reviews on different days stay separate", () => {
    const plan = reconcileLocation(
      [official("GBP00001", { createTime: "2026-10-01T15:00:00.000Z" }), official("GBP00002", { createTime: "2026-10-20T15:00:00.000Z", comment: "Back again", comparableText: "Back again" })],
      [stored("a"), stored("b", { reviewText: "Back again", googleAbsoluteDate: "2026-10-20T15:00:00.000Z" })],
    );
    expect(plan.decisions.map((d) => d.kind === "auto_match" && d.stored.id)).toEqual(["a", "b"]);
  });

  it("recognises an already-linked review by its official id", () => {
    const plan = reconcileLocation([official("GBP00001")], [stored("a", { gbpReviewId: "GBP00001", reviewerName: "Different" })]);
    expect(plan.decisions[0]).toMatchObject({ kind: "linked", method: "exact_id" });
  });

  it("recognises a review previously filed under the official id itself", () => {
    const plan = reconcileLocation([official("GBP00001")], [stored("a", { externalReviewId: "GBP00001" })]);
    expect(kinds(plan)).toEqual(["linked"]);
  });

  it("a linked row is never a candidate for another official review", () => {
    const plan = reconcileLocation([official("GBP00001"), official("GBP00002")], [stored("a", { gbpReviewId: "GBP00001" })]);
    expect(kinds(plan)).toEqual(["linked", "new"]);
  });

  it("reports discrepancies for matched pairs instead of overwriting", () => {
    const plan = reconcileLocation(
      [official("GBP00001", { replyText: "Thank you" })],
      [stored("a")],
    );
    expect(plan.discrepancies).toEqual([expect.objectContaining({ field: "owner_reply", stored: null, official: "Thank you" })]);
  });

  it("is deterministic: the same inputs give the same plan", () => {
    const args = [[official("GBP00001"), official("GBP00002", { reviewerName: "Zed" })], [stored("a"), stored("b", { reviewerName: "Zed" })]] as const;
    expect(JSON.stringify(reconcileLocation(...args))).toBe(JSON.stringify(reconcileLocation(...args)));
  });
});
