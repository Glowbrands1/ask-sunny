import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AiError } from "@/lib/ai/errors";
import { __setSupabaseAdmin } from "@/lib/supabase/server";
import {
  ingestGoogleReviews,
  MAX_REVIEWS_PER_SYNC,
  normaliseReviewBatch,
} from "./ingest";

/**
 * THE INGESTION GATE.
 *
 * These cover the layer between the extension and the database: what is
 * accepted, what is refused as malformed, what is ignored as somebody else's
 * business, and — the distinction the whole design turns on — that those last
 * two are counted separately.
 *
 * THE DATABASE'S OWN IDEMPOTENCY IS NOT SIMULATED HERE. `ingest_google_reviews`
 * is where the upsert happens, and a fake client asserting that a fake upsert
 * was idempotent would prove nothing. What IS asserted here is that the route
 * layer passes a clean batch through and reports the database's counts
 * faithfully, including adding back the records it dropped itself. The real
 * function was exercised against the live schema during QA; see the handoff.
 *
 * Every reviewer name and review id below is invented.
 */

const VALID = {
  externalReviewId: "FIXTURE-0000000001",
  storeCode: "306",
  reviewerName: "Tamsin Vale",
  rating: 3,
  reviewText: "The team sorted it out in the end.",
  relativeDateText: "7 hours ago",
  hasOwnerResponse: false,
};

afterEach(() => {
  __setSupabaseAdmin(null);
});

/** A Supabase stand-in whose `rpc` answers with the counts a test wants. */
function fakeAdmin(result: Record<string, unknown>, capture?: { args?: unknown }) {
  const rpc = vi.fn(async (_name: string, args: unknown) => {
    if (capture) capture.args = args;
    return { data: result, error: null };
  });
  __setSupabaseAdmin({ rpc } as unknown as SupabaseClient);
  return rpc;
}

describe("normaliseReviewBatch", () => {
  it("accepts a well-formed review for one of the fifteen stores", () => {
    const outcome = normaliseReviewBatch([VALID]);
    expect(outcome.accepted).toHaveLength(1);
    expect(outcome.invalid).toBe(0);
    expect(outcome.ignoredNonStc).toBe(0);
  });

  it("ignores another business rather than refusing it", () => {
    /*
     * THE DISTINCTION THAT MATTERS. Buff City Soap shares this Google account,
     * so its reviews arriving is the NORMAL case. Counting them as failures
     * would report every sync as broken.
     */
    const outcome = normaliseReviewBatch([
      { ...VALID, externalReviewId: "FIXTURE-BCS-000001", storeCode: "881" },
    ]);
    expect(outcome.accepted).toHaveLength(0);
    expect(outcome.ignoredNonStc).toBe(1);
    expect(outcome.invalid).toBe(0);
    expect(outcome.problems).toEqual([
      { code: "ignored_unknown_store", storeCode: "881" },
    ]);
  });

  it("refuses a rating outside 1 to 5", () => {
    const outcome = normaliseReviewBatch([
      { ...VALID, externalReviewId: "FIXTURE-BAD-000001", rating: 0 },
      { ...VALID, externalReviewId: "FIXTURE-BAD-000002", rating: 9 },
      { ...VALID, externalReviewId: "FIXTURE-BAD-000003", rating: 4.5 },
    ]);
    expect(outcome.accepted).toHaveLength(0);
    expect(outcome.invalid).toBe(3);
  });

  it("refuses a review with no id, or an id that is not Google-shaped", () => {
    const outcome = normaliseReviewBatch([
      { ...VALID, externalReviewId: "" },
      { ...VALID, externalReviewId: "short" },
      { ...VALID, externalReviewId: "has spaces in it" },
      { ...VALID, externalReviewId: "<script>alert(1)</script>" },
    ]);
    expect(outcome.accepted).toHaveLength(0);
    expect(outcome.invalid).toBe(4);
  });

  it("refuses a review with no reviewer name", () => {
    const outcome = normaliseReviewBatch([{ ...VALID, reviewerName: "   " }]);
    expect(outcome.invalid).toBe(1);
    expect(outcome.problems[0].code).toBe("missing_reviewer_name");
  });

  it("collapses the same review id appearing twice in one payload", () => {
    /*
     * Google's markup nests elements sharing a `data-lid`. The extension already
     * collapses them; this is the second net, and it keeps the counts honest —
     * "12 discovered, 12 imported" rather than "13 received, 12 created, 1
     * updated" for a page holding twelve reviews.
     */
    const outcome = normaliseReviewBatch([VALID, { ...VALID }]);
    expect(outcome.accepted).toHaveLength(1);
    expect(outcome.invalid).toBe(0);
  });

  it("keeps a rating-only review, with null rather than empty text", () => {
    const outcome = normaliseReviewBatch([
      { ...VALID, reviewText: "", externalReviewId: "FIXTURE-RATINGONLY-01" },
    ]);
    expect(outcome.accepted[0].reviewText).toBeNull();
  });

  it("treats response text as proof of a response even when the flag says otherwise", () => {
    /*
     * The parser can read a reply and miss whatever marker Google puts beside
     * it. It cannot invent the reply's words, so the words win.
     */
    const outcome = normaliseReviewBatch([
      {
        ...VALID,
        hasOwnerResponse: false,
        ownerResponseText: "Thanks for letting us know — we have spoken to the team.",
      },
    ]);
    expect(outcome.accepted[0].hasOwnerResponse).toBe(true);
    expect(outcome.accepted[0].ownerResponseText).toContain("spoken to the team");
  });

  it("drops response text when there is no response", () => {
    const outcome = normaliseReviewBatch([
      { ...VALID, hasOwnerResponse: false, ownerResponseDateText: "2 days ago" },
    ]);
    expect(outcome.accepted[0].hasOwnerResponse).toBe(false);
    expect(outcome.accepted[0].ownerResponseText).toBeNull();
    expect(outcome.accepted[0].ownerResponseDateText).toBeNull();
  });

  it("refuses a payload that is not a list", () => {
    expect(() => normaliseReviewBatch({ reviews: [] })).toThrow(AiError);
    expect(() => normaliseReviewBatch(null)).toThrow(AiError);
  });

  it("refuses a batch larger than one sync may carry", () => {
    const oversized = Array.from({ length: MAX_REVIEWS_PER_SYNC + 1 }, (_, index) => ({
      ...VALID,
      externalReviewId: `FIXTURE-BULK-${String(index).padStart(6, "0")}`,
    }));
    expect(() => normaliseReviewBatch(oversized)).toThrow(AiError);
  });

  it("refuses a record that is not an object at all", () => {
    const outcome = normaliseReviewBatch(["not a review", 42, null]);
    expect(outcome.invalid).toBe(3);
    expect(outcome.accepted).toHaveLength(0);
  });
});

describe("ingestGoogleReviews", () => {
  it("sends only validated records to the database", async () => {
    const capture: { args?: unknown } = {};
    fakeAdmin(
      {
        runId: "00000000-0000-4000-8000-000000000001",
        received: 1,
        created: 1,
        updated: 0,
        duplicates: 0,
        ignoredNonStc: 0,
        invalid: 0,
        problems: [],
      },
      capture,
    );

    await ingestGoogleReviews(
      [VALID, { ...VALID, externalReviewId: "FIXTURE-BCS-000002", storeCode: "881" }],
      { parserVersion: "2026.09.17-1", credentialId: "brave-extension" },
    );

    const args = capture.args as { p_reviews: unknown[]; p_parser_version: string };
    expect(args.p_reviews).toHaveLength(1);
    expect(args.p_parser_version).toBe("2026.09.17-1");
  });

  it("reports what the CALLER sent, not what survived validation", async () => {
    /*
     * The extension says "8 reviews found"; the manager must see 8 accounted
     * for. A `received` that counted only the survivors would quietly lose the
     * refused ones out of the arithmetic.
     */
    fakeAdmin({
      runId: "00000000-0000-4000-8000-000000000002",
      received: 1,
      created: 1,
      updated: 0,
      duplicates: 0,
      ignoredNonStc: 0,
      invalid: 0,
      problems: [],
    });

    const result = await ingestGoogleReviews(
      [
        VALID,
        { ...VALID, externalReviewId: "FIXTURE-BCS-000003", storeCode: "881" },
        { ...VALID, externalReviewId: "FIXTURE-BAD-000004", rating: 11 },
      ],
      { parserVersion: "2026.09.17-1", credentialId: "brave-extension" },
    );

    expect(result.received).toBe(3);
    expect(result.created).toBe(1);
    expect(result.ignoredNonStc).toBe(1);
    expect(result.invalid).toBe(1);
  });

  it("reports a re-sync of unchanged reviews as duplicates, creating nothing", async () => {
    fakeAdmin({
      runId: "00000000-0000-4000-8000-000000000003",
      received: 1,
      created: 0,
      updated: 0,
      duplicates: 1,
      ignoredNonStc: 0,
      invalid: 0,
      problems: [],
    });

    const result = await ingestGoogleReviews([VALID], {
      parserVersion: "2026.09.17-1",
      credentialId: "brave-extension",
    });

    expect(result.created).toBe(0);
    expect(result.duplicates).toBe(1);
  });

  it("does not touch the database for an empty batch", async () => {
    /*
     * An empty payload is how the Options page tests its token, and a page
     * holding only another business's reviews is an ordinary Tuesday. Neither
     * deserves a round trip or a sync-run row.
     */
    const rpc = fakeAdmin({});
    const result = await ingestGoogleReviews([], {
      parserVersion: "connection-test",
      credentialId: "brave-extension",
    });

    expect(rpc).not.toHaveBeenCalled();
    expect(result).toMatchObject({ runId: null, received: 0, created: 0 });
  });

  it("does not reflect a database error message back to the caller", async () => {
    /*
     * A Postgres message can carry a constraint name and occasionally a value
     * from the offending row — and the offending row here holds somebody's
     * review. The caller gets a fixed sentence.
     */
    __setSupabaseAdmin({
      rpc: vi.fn(async () => ({
        data: null,
        error: { code: "23505", message: 'duplicate key value violates "x" (Tamsin Vale)' },
      })),
    } as unknown as SupabaseClient);

    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      ingestGoogleReviews([VALID], {
        parserVersion: "2026.09.17-1",
        credentialId: "brave-extension",
      }),
    ).rejects.toThrow(/could not be filed/i);

    /* The log line carries the code and nothing from the row. */
    expect(consoleError).toHaveBeenCalledWith(expect.any(String), "23505");
  });
});
