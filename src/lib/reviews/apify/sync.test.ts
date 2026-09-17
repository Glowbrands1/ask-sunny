import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { __setSupabaseAdmin } from "@/lib/supabase/server";
import type { IncomingGoogleReview } from "../types";
import type { ApifyLocationMapping } from "./types";

/**
 * ============================================================================
 * THE RUN ORCHESTRATION — the lock, the budget, and what a failure may touch
 * ============================================================================
 *
 * The Apify client and the ingestion are replaced here, because what these
 * cover is the DECISIONS around them: whether a run is started at all, what it
 * is asked for, and — the one that matters most — that a run which fails,
 * times out or returns nothing never reaches the ingestion.
 *
 * `google_review_apify_claim_run`'s own concurrency guarantee is a partial
 * unique index in Postgres and is not simulated: a fake asserting that a fake
 * index refused a second insert would prove nothing. What IS asserted is that
 * this layer asks for the claim before touching Apify, and honours a refusal.
 */

const startRun = vi.fn();
const getRun = vi.fn();
const fetchDatasetItems = vi.fn();
const ingestGoogleReviews = vi.fn();

vi.mock("./client", async () => {
  const actual = await vi.importActual<typeof import("./client")>("./client");
  return {
    ...actual,
    startRun: (...args: unknown[]) => startRun(...args),
    getRun: (...args: unknown[]) => getRun(...args),
    fetchDatasetItems: (...args: unknown[]) => fetchDatasetItems(...args),
  };
});

vi.mock("../ingest", async () => {
  const actual = await vi.importActual<typeof import("../ingest")>("../ingest");
  return {
    ...actual,
    ingestGoogleReviews: (...args: unknown[]) => ingestGoogleReviews(...args),
  };
});

const readLocationMappings = vi.fn();

vi.mock("./locations", async () => {
  const actual = await vi.importActual<typeof import("./locations")>("./locations");
  return {
    ...actual,
    readLocationMappings: () => readLocationMappings(),
    assignPlaces: async () => [],
  };
});

const {
  batchByStore,
  buildActorInput,
  completeApifyRun,
  incrementalCutoff,
  startApifySync,
} = await import("./sync");

const PLACE_306 = "ChIJFIXTURE306Manhattan00";
const PLACE_144 = "ChIJFIXTURE144Lincoln27th";

function mapping(overrides: Partial<ApifyLocationMapping> = {}): ApifyLocationMapping {
  return {
    storeCode: "306",
    salonNumber: "0462",
    locationName: "KS Manhattan",
    district: "Patterson, Madeline",
    googleLocationLabel: "Sun Tan City - KS Manhattan",
    listingState: "verified",
    isActive: true,
    googlePlaceId: PLACE_306,
    googleCid: null,
    googleMapsUrl: null,
    canonicalGoogleName: "Sun Tan City",
    canonicalGoogleAddress: "1234 N 3rd St, Manhattan, KS 66502",
    expectedState: "KS",
    expectedCity: "Manhattan",
    sourceStatus: "verified",
    lastVerifiedAt: "2026-09-16T12:00:00.000Z",
    verificationNote: null,
    countingActive: true,
    reviewsTotal: 4,
    reviewsFromApify: 4,
    reviewsFromBrave: 0,
    latestPublishedAt: "2026-09-15T10:00:00.000Z",
    latestSeenAt: "2026-09-16T12:00:00.000Z",
    ...overrides,
  };
}

/** A Supabase stand-in that answers the RPCs this layer makes. */
function fakeAdmin(options: {
  claim?: Record<string, unknown>;
  ledger?: Record<string, unknown> | null;
  onRpc?: (name: string, args: unknown) => void;
}) {
  const rpc = vi.fn(async (name: string, args: unknown) => {
    options.onRpc?.(name, args);
    if (name === "google_review_apify_claim_run") {
      return { data: options.claim ?? { status: "claimed", runId: RUN_ID }, error: null };
    }
    return { data: null, error: null };
  });

  const from = vi.fn(() => ({
    select: () => ({
      eq: () => ({ maybeSingle: async () => ({ data: options.ledger ?? null, error: null }) }),
      order: () => ({ limit: async () => ({ data: [], error: null }) }),
      eq_: undefined,
    }),
  }));

  __setSupabaseAdmin({ rpc, from } as unknown as SupabaseClient);
  return rpc;
}

const RUN_ID = "11111111-2222-4333-8444-555555555555";

beforeEach(() => {
  process.env.APIFY_SYNC_ENABLED = "true";
  process.env.APIFY_TOKEN = "fixture-token-not-a-real-one";
  process.env.APIFY_REVIEW_INCREMENTAL_LIMIT_PER_LOCATION = "15";
  process.env.APIFY_REVIEW_BACKFILL_LIMIT_PER_LOCATION = "100";
  readLocationMappings.mockResolvedValue([mapping()]);
});

afterEach(() => {
  __setSupabaseAdmin(null);
  delete process.env.APIFY_SYNC_ENABLED;
  delete process.env.APIFY_TOKEN;
  delete process.env.APIFY_REVIEW_INCREMENTAL_LIMIT_PER_LOCATION;
  delete process.env.APIFY_REVIEW_BACKFILL_LIMIT_PER_LOCATION;
  vi.clearAllMocks();
});

/* ------------------------------------------------------- the actor input -- */

describe("what the Actor is asked for", () => {
  it("asks for newest-first, which the whole reporting model depends on", () => {
    const input = buildActorInput({
      placeIds: [PLACE_306, PLACE_144],
      maxReviews: 15,
      reviewsSince: null,
    });

    expect(input.reviewsSort).toBe("newest");
    expect(input.placeIds).toEqual([PLACE_306, PLACE_144]);
    expect(input.maxReviews).toBe(15);
    /* The reviewer's display name is the dashboard's most-read field. */
    expect(input.personalData).toBe(true);
    expect(input).not.toHaveProperty("reviewsStartDate");
  });

  it("carries the date cutoff when one was worked out", () => {
    const input = buildActorInput({
      placeIds: [PLACE_306],
      maxReviews: 15,
      reviewsSince: "2026-09-01T00:00:00.000Z",
    });
    expect(input.reviewsStartDate).toBe("2026-09-01T00:00:00.000Z");
  });
});

describe("the recurring run's date cutoff", () => {
  const now = Date.parse("2026-09-17T12:00:00.000Z");

  it("takes the OLDEST newest-review across listings, never the newest", () => {
    /*
     * A cutoff from the newest review anywhere in the estate would silently
     * skip everything a slower salon received in between.
     */
    const cutoff = incrementalCutoff(
      [
        mapping({ storeCode: "306", latestPublishedAt: "2026-09-16T00:00:00.000Z" }),
        mapping({ storeCode: "144", latestPublishedAt: "2026-09-01T00:00:00.000Z" }),
      ],
      6,
      now,
    );

    /* 2026-09-01 less six hours of overlap. */
    expect(cutoff).toBe("2026-08-31T18:00:00.000Z");
  });

  it("sends no cutoff at all when a listing holds nothing", () => {
    /* A listing with no reviews has no floor, and no cutoff is safe for it. */
    expect(
      incrementalCutoff(
        [mapping({ latestPublishedAt: "2026-09-16T00:00:00.000Z" }), mapping({ storeCode: "144", latestPublishedAt: null })],
        6,
        now,
      ),
    ).toBeNull();
  });
});

/* --------------------------------------------------------- the guardrails - */

describe("starting a run", () => {
  it("starts nothing while the source is switched off", async () => {
    process.env.APIFY_SYNC_ENABLED = "false";
    fakeAdmin({});

    const result = await startApifySync({
      kind: "incremental",
      requestedBy: "cron",
      baseUrl: "https://example.test",
      webhookSecret: null,
    });

    expect(result.status).toBe("disabled");
    expect(startRun).not.toHaveBeenCalled();
  });

  it("starts nothing when no listing has been verified", async () => {
    readLocationMappings.mockResolvedValue([mapping({ sourceStatus: "pending_verification" })]);
    fakeAdmin({});

    const result = await startApifySync({
      kind: "incremental",
      requestedBy: "cron",
      baseUrl: "https://example.test",
      webhookSecret: null,
    });

    expect(result.status).toBe("not_configured");
    expect(startRun).not.toHaveBeenCalled();
  });

  it("HONOURS THE CONCURRENCY LOCK — a second trigger starts no second run", async () => {
    /*
     * This is the manual button being double-clicked, two tabs, and a cron tick
     * landing at the same moment. All three reach here; the database refuses
     * one of them, and this layer must not go on to Apify anyway.
     */
    fakeAdmin({ claim: { status: "already_running", runId: RUN_ID } });

    const result = await startApifySync({
      kind: "incremental",
      requestedBy: "admin:someone@example.test",
      baseUrl: "https://example.test",
      webhookSecret: null,
    });

    expect(result.status).toBe("already_running");
    expect(result.message).toContain("scrape and pay for the same reviews twice");
    expect(startRun).not.toHaveBeenCalled();
  });

  it("HONOURS THE DAILY BUDGET — a bug in a loop is stopped, not billed", async () => {
    fakeAdmin({ claim: { status: "over_budget", runsInWindow: 8, limit: 8 } });

    const result = await startApifySync({
      kind: "incremental",
      requestedBy: "cron",
      baseUrl: "https://example.test",
      webhookSecret: null,
    });

    expect(result.status).toBe("over_budget");
    expect(startRun).not.toHaveBeenCalled();
  });

  it("claims the slot BEFORE touching Apify, and sends the budget with the claim", async () => {
    const calls: { name: string; args: unknown }[] = [];
    fakeAdmin({ onRpc: (name, args) => calls.push({ name, args }) });
    startRun.mockResolvedValue({
      id: "apifyrun00001",
      actorId: "compass~google-maps-reviews-scraper",
      status: "RUNNING",
      defaultDatasetId: "dataset000001",
      startedAt: null,
      finishedAt: null,
      usageTotalUsd: null,
    });

    const result = await startApifySync({
      kind: "incremental",
      requestedBy: "cron",
      baseUrl: "https://example.test/",
      webhookSecret: "fixture-webhook-secret-not-real",
    });

    expect(calls[0].name).toBe("google_review_apify_claim_run");
    expect((calls[0].args as { p_max_runs_per_day: number }).p_max_runs_per_day).toBe(8);
    expect(result.status).toBe("started");
    expect(result.apifyRunId).toBe("apifyrun00001");

    /* THE CALLBACK IS THE DEPLOYMENT'S OWN URL, with no token in it. */
    const options = startRun.mock.calls[0][1] as {
      webhooks: { requestUrl: string; headersTemplate?: string }[];
    };
    expect(options.webhooks[0].requestUrl).toBe(
      "https://example.test/api/reviews/apify/webhook",
    );
    expect(options.webhooks[0].requestUrl).not.toContain("fixture-webhook-secret");
    /* The secret travels in a header template, never in the URL. */
    expect(options.webhooks[0].headersTemplate).toContain("fixture-webhook-secret-not-real");
  });

  it("releases the slot when Apify refuses, rather than leaving it locked", async () => {
    const released: unknown[] = [];
    fakeAdmin({
      onRpc: (name, args) => {
        if (name === "google_review_apify_release_run") released.push(args);
      },
    });
    startRun.mockRejectedValue(new Error("apify said no"));

    await expect(
      startApifySync({
        kind: "incremental",
        requestedBy: "cron",
        baseUrl: "https://example.test",
        webhookSecret: null,
      }),
    ).rejects.toThrow();

    expect(released).toHaveLength(1);
    expect(released[0]).toMatchObject({ p_status: "failed" });
  });
});

/* ------------------------------------------------------ finishing a run --- */

const LEDGER = {
  id: RUN_ID,
  apify_run_id: "apifyrun00001",
  status: "running",
  kind: "incremental",
  locations_requested: 1,
};

describe("filing what a run returned", () => {
  it("A FAILED ACTOR RUN TOUCHES NO REVIEW", async () => {
    /*
     * The property the whole failure model rests on. There is nothing to undo
     * because nothing is written: ingestion happens only after a successful run
     * produced a dataset this system could read.
     */
    fakeAdmin({ ledger: LEDGER });
    getRun.mockResolvedValue({
      id: "apifyrun00001",
      actorId: null,
      status: "FAILED",
      defaultDatasetId: "dataset000001",
      startedAt: null,
      finishedAt: null,
      usageTotalUsd: 0.0012,
    });

    const result = await completeApifyRun(RUN_ID);

    expect(result.status).toBe("failed");
    expect(fetchDatasetItems).not.toHaveBeenCalled();
    expect(ingestGoogleReviews).not.toHaveBeenCalled();
    expect(result.message).toContain("untouched");
  });

  it("a timed-out run is the same: nothing fetched, nothing ingested", async () => {
    fakeAdmin({ ledger: LEDGER });
    getRun.mockResolvedValue({
      id: "apifyrun00001",
      actorId: null,
      status: "TIMED-OUT",
      defaultDatasetId: null,
      startedAt: null,
      finishedAt: null,
      usageTotalUsd: null,
    });

    expect((await completeApifyRun(RUN_ID)).status).toBe("failed");
    expect(ingestGoogleReviews).not.toHaveBeenCalled();
  });

  it("a succeeded run with no dataset is a failure, not an empty import", async () => {
    fakeAdmin({ ledger: LEDGER });
    getRun.mockResolvedValue({
      id: "apifyrun00001",
      actorId: null,
      status: "SUCCEEDED",
      defaultDatasetId: null,
      startedAt: null,
      finishedAt: null,
      usageTotalUsd: null,
    });

    const result = await completeApifyRun(RUN_ID);
    expect(result.status).toBe("failed");
    expect(ingestGoogleReviews).not.toHaveBeenCalled();
  });

  it("A REPEATED DELIVERY DOES NOTHING — Apify delivers at least once", async () => {
    fakeAdmin({ ledger: { ...LEDGER, status: "succeeded" } });

    const result = await completeApifyRun(RUN_ID);

    expect(result.status).toBe("ignored");
    expect(getRun).not.toHaveBeenCalled();
    expect(ingestGoogleReviews).not.toHaveBeenCalled();
  });

  it("a run this system never started is ignored rather than errored", async () => {
    fakeAdmin({ ledger: null });
    expect((await completeApifyRun(RUN_ID)).status).toBe("ignored");
    expect(ingestGoogleReviews).not.toHaveBeenCalled();
  });

  it("a run Apify says is still going concludes nothing and keeps the lock", async () => {
    fakeAdmin({ ledger: LEDGER });
    getRun.mockResolvedValue({
      id: "apifyrun00001",
      actorId: null,
      status: "RUNNING",
      defaultDatasetId: "dataset000001",
      startedAt: null,
      finishedAt: null,
      usageTotalUsd: null,
    });

    expect((await completeApifyRun(RUN_ID)).status).toBe("ignored");
    expect(ingestGoogleReviews).not.toHaveBeenCalled();
  });

  it("REPORTS A PARTIAL RUN BY NAME, rather than calling it a success", async () => {
    /*
     * "This location had no new reviews" and "this location did not answer"
     * both show zero. Collapsing them is how a broken mapping survives for six
     * weeks, so a listing that was asked for and did not appear is named.
     */
    readLocationMappings.mockResolvedValue([
      mapping({ storeCode: "306", googlePlaceId: PLACE_306 }),
      mapping({ storeCode: "144", salonNumber: "0310", googlePlaceId: PLACE_144 }),
    ]);

    const outcomes: Record<string, unknown>[] = [];
    fakeAdmin({
      ledger: { ...LEDGER, locations_requested: 2 },
      onRpc: (name, args) => {
        if (name === "google_review_apify_record_outcome") {
          outcomes.push(args as Record<string, unknown>);
        }
      },
    });

    getRun.mockResolvedValue({
      id: "apifyrun00001",
      actorId: null,
      status: "SUCCEEDED",
      defaultDatasetId: "dataset000001",
      startedAt: null,
      finishedAt: null,
      usageTotalUsd: 0.004,
    });

    /* Only 306 came back. 144 was asked for and is absent entirely. */
    fetchDatasetItems.mockResolvedValue([
      {
        reviewId: "FIXTUREAPIFY0000000101",
        placeId: PLACE_306,
        reviewerName: "Tamsin Vale",
        stars: 5,
        publishedAtDate: "2026-09-16T10:00:00.000Z",
      },
    ]);

    ingestGoogleReviews.mockResolvedValue({
      runId: "sync-run-1",
      received: 1,
      created: 1,
      updated: 0,
      duplicates: 0,
      ignoredNonStc: 0,
      invalid: 0,
      countedIntoPeriod: 0,
      storedAsHistorical: 1,
      storeFindings: [],
      problems: [],
    });

    const result = await completeApifyRun(RUN_ID);

    expect(result.status).toBe("partial");
    expect(result.missingStoreCodes).toEqual(["144"]);
    expect(result.locationsReturned).toBe(1);
    expect(outcomes[0]).toMatchObject({ p_status: "partial", p_missing: ["144"] });
    /* THE COST IS APIFY'S FIGURE, read back rather than estimated here. */
    expect(outcomes[0].p_usage_usd).toBe(0.004);
  });

  it("files a full run as the Apify transport, never as the extension", async () => {
    fakeAdmin({ ledger: LEDGER });
    getRun.mockResolvedValue({
      id: "apifyrun00001",
      actorId: null,
      status: "SUCCEEDED",
      defaultDatasetId: "dataset000001",
      startedAt: null,
      finishedAt: null,
      usageTotalUsd: null,
    });
    fetchDatasetItems.mockResolvedValue([
      {
        reviewId: "FIXTUREAPIFY0000000102",
        placeId: PLACE_306,
        reviewerName: "Tamsin Vale",
        stars: 4,
        publishedAtDate: "2026-09-16T10:00:00.000Z",
      },
    ]);
    ingestGoogleReviews.mockResolvedValue({
      runId: "sync-run-2",
      received: 1,
      created: 1,
      updated: 0,
      duplicates: 0,
      ignoredNonStc: 0,
      invalid: 0,
      countedIntoPeriod: 0,
      storedAsHistorical: 1,
      storeFindings: [],
      problems: [],
    });

    const result = await completeApifyRun(RUN_ID);

    expect(result.status).toBe("succeeded");
    expect(ingestGoogleReviews).toHaveBeenCalledTimes(1);
    const options = ingestGoogleReviews.mock.calls[0][1] as { ingestionSource: string };
    /*
     * THE TRANSPORT, NOT THE IDENTITY. `source` stays
     * `google_business_profile`, so a review the extension already found is
     * matched and updated rather than duplicated.
     */
    expect(options.ingestionSource).toBe("apify");
  });
});

/* ---------------------------------------------------------- the batching -- */

describe("splitting a dataset for the ingestion", () => {
  function review(storeCode: string, id: string): IncomingGoogleReview {
    return { externalReviewId: id, storeCode, reviewerName: "A", rating: 5 };
  }

  it("NEVER SPLITS ONE LISTING ACROSS TWO BATCHES", () => {
    /*
     * Feed positions are only comparable within a batch, because that is the
     * unit the anchor plan is measured over. A listing divided across two would
     * have its boundary fall inside the split and count the wrong half.
     */
    const reviews = [
      ...Array.from({ length: 4 }, (_, index) => review("306", `FIXTURE306${index}0000`)),
      ...Array.from({ length: 4 }, (_, index) => review("144", `FIXTURE144${index}0000`)),
    ];

    const batches = batchByStore(reviews, 5);

    expect(batches).toHaveLength(2);
    for (const batch of batches) {
      expect(new Set(batch.map((entry) => entry.storeCode)).size).toBe(1);
    }
  });

  it("packs several listings into one batch while they fit", () => {
    const batches = batchByStore(
      [review("306", "FIXTURE30600001"), review("144", "FIXTURE14400001")],
      500,
    );
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(2);
  });

  it("returns nothing for an empty dataset rather than an empty batch", () => {
    expect(batchByStore([], 500)).toEqual([]);
  });
});
