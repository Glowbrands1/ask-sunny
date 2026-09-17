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

/**
 * A Supabase stand-in.
 *
 * `from(...)` serves the ANCHOR READ that now precedes every write — the
 * reporting period is decided against what the database holds, so the fake has
 * to be able to hold something. `rpc` answers with the counts a test wants.
 */
function fakeAdmin(
  result: Record<string, unknown>,
  options: { anchors?: Record<string, string | null>; capture?: { args?: unknown } } = {},
) {
  const rows = Object.entries(options.anchors ?? {}).map(([store_code, anchor]) => ({
    store_code,
    counted_through_external_review_id: anchor,
  }));

  const rpc = vi.fn(async (_name: string, args: unknown) => {
    if (options.capture) options.capture.args = args;
    return { data: result, error: null };
  });

  const from = vi.fn(() => ({
    select: () => ({ in: async () => ({ data: rows, error: null }) }),
  }));

  __setSupabaseAdmin({ rpc, from } as unknown as SupabaseClient);
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
        countedIntoPeriod: 1,
        storedAsHistorical: 0,
        problems: [],
      },
      { capture, anchors: { "306": "FIXTURE-ANCHOR-0001" } },
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
      from: vi.fn(() => ({
        select: () => ({ in: async () => ({ data: [], error: null }) }),
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

/* --------------------------------------------- the reporting period wiring -- */

describe("which reviews are handed to the database as counting", () => {
  /**
   * THE DECISION IS `planPeriodAssignment`'S — tested exhaustively in
   * `period-assignment.test.ts`. What is tested here is the WIRING: that the
   * anchors are read from the database, that the decision reaches the write,
   * and that nothing a caller sends can influence it.
   */
  const feed = (ids: string[]) =>
    ids.map((externalReviewId, index) => ({
      ...VALID,
      externalReviewId,
      feedPosition: index,
      relativeDateText: `${index + 1} days ago`,
    }));

  function plannedFor(args: unknown) {
    const call = args as {
      p_reviews: { externalReviewId: string; periodAssignment: string }[];
      p_store_plans: { storeCode: string; expectedAnchor: string | null; advanceAnchorTo: string | null }[];
    };
    return {
      assignments: Object.fromEntries(
        call.p_reviews.map((review) => [review.externalReviewId, review.periodAssignment]),
      ),
      plans: call.p_store_plans,
    };
  }

  const COUNTS = {
    runId: "00000000-0000-4000-8000-00000000000a",
    received: 3,
    created: 3,
    updated: 0,
    duplicates: 0,
    ignoredNonStc: 0,
    invalid: 0,
    countedIntoPeriod: 2,
    storedAsHistorical: 1,
    problems: [],
  };

  it("marks everything historical when the listing has no anchor", async () => {
    /*
     * THE BACKLOG CASE, END TO END through this layer. A first import cannot
     * raise this week's number, because nothing above an unknown boundary can
     * be called new.
     */
    const capture: { args?: unknown } = {};
    fakeAdmin(COUNTS, { capture, anchors: { "306": null } });

    await ingestGoogleReviews(feed(["FIXTURE-A-000001", "FIXTURE-A-000002"]), {
      parserVersion: "2026.09.17-1",
      credentialId: "brave-extension",
    });

    const planned = plannedFor(capture.args);
    expect(Object.values(planned.assignments)).toEqual(["historical", "historical"]);
    expect(planned.plans[0]).toMatchObject({
      storeCode: "306",
      expectedAnchor: null,
      advanceAnchorTo: null,
    });
  });

  it("marks the reviews above the anchor as counting, and the anchor itself as not", async () => {
    const capture: { args?: unknown } = {};
    fakeAdmin(COUNTS, { capture, anchors: { "306": "FIXTURE-A-000003" } });

    await ingestGoogleReviews(
      feed(["FIXTURE-A-000001", "FIXTURE-A-000002", "FIXTURE-A-000003", "FIXTURE-A-000004"]),
      { parserVersion: "2026.09.17-1", credentialId: "brave-extension" },
    );

    const planned = plannedFor(capture.args);
    expect(planned.assignments).toEqual({
      "FIXTURE-A-000001": "current",
      "FIXTURE-A-000002": "current",
      /* The anchor was counted in the period that closed on it. */
      "FIXTURE-A-000003": "historical",
      "FIXTURE-A-000004": "historical",
    });
    expect(planned.plans[0]).toMatchObject({
      expectedAnchor: "FIXTURE-A-000003",
      advanceAnchorTo: "FIXTURE-A-000001",
    });
  });

  it("ignores a periodAssignment a caller tried to send", async () => {
    /*
     * THE FIELD DOES NOT SURVIVE VALIDATION. `normaliseReviewBatch` builds each
     * record from a whitelist, so an extension — or anything holding the token
     * — cannot tell ASK Sunny that a year-old review belongs in this week.
     */
    const capture: { args?: unknown } = {};
    fakeAdmin(COUNTS, { capture, anchors: { "306": null } });

    await ingestGoogleReviews(
      [
        {
          ...VALID,
          externalReviewId: "FIXTURE-A-000009",
          feedPosition: 0,
          periodAssignment: "current",
          reportingPeriodId: "whatever-they-like",
        },
      ],
      { parserVersion: "2026.09.17-1", credentialId: "brave-extension" },
    );

    const planned = plannedFor(capture.args);
    expect(planned.assignments["FIXTURE-A-000009"]).toBe("historical");
  });

  it("reports what counted and what was only stored", async () => {
    fakeAdmin(COUNTS, { anchors: { "306": "FIXTURE-A-000003" } });

    const result = await ingestGoogleReviews(
      feed(["FIXTURE-A-000001", "FIXTURE-A-000002", "FIXTURE-A-000003"]),
      { parserVersion: "2026.09.17-1", credentialId: "brave-extension" },
    );

    expect(result.countedIntoPeriod).toBe(2);
    expect(result.storedAsHistorical).toBe(1);
  });

  it("says WHY a listing counted nothing, and says nothing when it simply had no news", async () => {
    const withoutAnchor = fakeAdmin(COUNTS, { anchors: { "306": null } });
    const noAnchorRun = await ingestGoogleReviews(feed(["FIXTURE-A-000001"]), {
      parserVersion: "2026.09.17-1",
      credentialId: "brave-extension",
    });
    expect(withoutAnchor).toHaveBeenCalled();
    expect(noAnchorRun.storeFindings).toEqual([
      { storeCode: "306", finding: "no_anchor", reviews: 1 },
    ]);

    /* Anchor at the top of the page: nothing new, and that is not a finding. */
    fakeAdmin(COUNTS, { anchors: { "306": "FIXTURE-A-000001" } });
    const quiet = await ingestGoogleReviews(
      feed(["FIXTURE-A-000001", "FIXTURE-A-000002"]),
      { parserVersion: "2026.09.17-1", credentialId: "brave-extension" },
    );
    expect(quiet.storeFindings).toEqual([]);
  });

  it("counts nothing for a page that is not in newest-first order", async () => {
    const capture: { args?: unknown } = {};
    fakeAdmin(COUNTS, { capture, anchors: { "306": "FIXTURE-A-000003" } });

    await ingestGoogleReviews(
      [
        { ...VALID, externalReviewId: "FIXTURE-A-000001", feedPosition: 0, relativeDateText: "6 months ago" },
        { ...VALID, externalReviewId: "FIXTURE-A-000002", feedPosition: 1, relativeDateText: "2 hours ago" },
        { ...VALID, externalReviewId: "FIXTURE-A-000003", feedPosition: 2, relativeDateText: "1 week ago" },
      ],
      { parserVersion: "2026.09.17-1", credentialId: "brave-extension" },
    );

    const planned = plannedFor(capture.args);
    expect(Object.values(planned.assignments).every((value) => value === "historical")).toBe(
      true,
    );
    expect(planned.plans[0].advanceAnchorTo).toBeNull();
  });

  it("passes the feed position through so the database can order a backlog later", async () => {
    const capture: { args?: unknown } = {};
    fakeAdmin(COUNTS, { capture, anchors: { "306": null } });

    await ingestGoogleReviews(feed(["FIXTURE-A-000001", "FIXTURE-A-000002"]), {
      parserVersion: "2026.09.17-1",
      credentialId: "brave-extension",
    });

    const call = capture.args as { p_reviews: { feedPosition: number | null }[] };
    expect(call.p_reviews.map((review) => review.feedPosition)).toEqual([0, 1]);
  });

  it("drops a junk feed position rather than letting it move a boundary", () => {
    const outcome = normaliseReviewBatch([
      { ...VALID, externalReviewId: "FIXTURE-POS-000001", feedPosition: -3 },
      { ...VALID, externalReviewId: "FIXTURE-POS-000002", feedPosition: 1.5 },
      { ...VALID, externalReviewId: "FIXTURE-POS-000003", feedPosition: "top" },
      { ...VALID, externalReviewId: "FIXTURE-POS-000004", feedPosition: 4 },
    ]);
    expect(outcome.accepted.map((review) => review.feedPosition)).toEqual([
      null,
      null,
      null,
      4,
    ]);
  });
});
