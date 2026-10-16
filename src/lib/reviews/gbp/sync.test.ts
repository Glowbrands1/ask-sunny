import { describe, expect, it, vi } from "vitest";

import type { IncomingGoogleReview } from "../types";
import type { GbpClient } from "./client";
import { DEFAULT_LIMITS } from "./config";
import { GbpApiError } from "./http";
import type { StoredReview } from "./reconcile";
import type { GbpStore, LinkInput, MappedLocation, ReviewItemInput } from "./store";
import { runGbpSync, type SyncDeps } from "./sync";

const T = "2026-10-01T15:00:00.000Z";
const mapping = (code: string, n: number): MappedLocation => ({
  locationId: `loc-${code}`,
  storeCode: code,
  label: `Sun Tan City ${code}`,
  accountName: "accounts/1",
  gbpLocationName: `locations/${n}`,
  gbpPlaceId: `ChIJplace${code}0000`,
  verifiedPlaceId: `ChIJplace${code}0000`,
});

const apiReview = (id: string, over: Record<string, unknown> = {}) => ({
  name: `accounts/1/locations/9/reviews/${id}`,
  reviewId: id,
  reviewer: { displayName: "Sarah Miller" },
  starRating: "FIVE",
  comment: "Loved it",
  createTime: T,
  updateTime: T,
  ...over,
});

const stored = (id: string, over: Partial<StoredReview> = {}): StoredReview => ({
  id,
  externalReviewId: `apify-${id}-${"z".repeat(50)}`,
  gbpReviewId: null,
  reviewerName: "Sarah Miller",
  rating: 5,
  reviewText: "Loved it",
  googleAbsoluteDate: T,
  hasOwnerResponse: false,
  ownerResponseText: null,
  ...over,
});

function fixture(opts: {
  mappings?: MappedLocation[];
  reviews?: Record<string, ReturnType<typeof apiReview>[]>;
  storedByLocation?: Record<string, StoredReview[]>;
  failOn?: Record<string, GbpApiError>;
}) {
  const writes = { links: [] as LinkInput[], items: [] as ReviewItemInput[], runs: 0, finished: 0 };
  const fetchedLocations: string[] = [];

  const client = {
    requestCount: 0,
    listReviews: vi.fn(async (_a: string, location: string) => {
      fetchedLocations.push(location);
      const failure = opts.failOn?.[location];
      if (failure) throw failure;
      return { reviews: opts.reviews?.[location] ?? [], averageRating: 4.8, totalReviewCount: 10, truncated: false };
    }),
  } as unknown as GbpClient;

  const store: GbpStore = {
    readListings: vi.fn(async () => []),
    readConfirmedMappings: vi.fn(async (codes) => (opts.mappings ?? []).filter((m) => !codes || codes.includes(m.storeCode))),
    readStoredReviews: vi.fn(async (locationId) => opts.storedByLocation?.[locationId] ?? []),
    lookupIdsByExternalId: vi.fn(async (_l: string, ids: string[]) => new Map<string, string>(ids.map((id) => [id, `row-for-${id}`] as [string, string]))),
    applyLinks: vi.fn(async (links) => {
      writes.links.push(...links);
      return { linked: links.length, refreshed: 0, conflicts: 0 };
    }),
    recordReviewItems: vi.fn(async (items) => {
      writes.items.push(...items);
      return items.length;
    }),
    confirmMapping: vi.fn(async () => "confirmed"),
    startRun: vi.fn(async () => {
      writes.runs += 1;
      return "run-1";
    }),
    finishRun: vi.fn(async () => {
      writes.finished += 1;
    }),
  };

  const ingested: IncomingGoogleReview[][] = [];
  const ingest = vi.fn(async (...args: [IncomingGoogleReview[], unknown?]) => {
    const [batch] = args;
    ingested.push(batch);
    return { runId: "r", received: batch.length, created: batch.length, updated: 0, duplicates: 0, ignoredNonStc: 0, invalid: 0, countedIntoPeriod: 0, storedAsHistorical: batch.length, storeFindings: [], problems: [] };
  });

  const deps: SyncDeps = { client, store, limits: DEFAULT_LIMITS, ingest: ingest as SyncDeps["ingest"] };
  return { deps, writes, ingested, ingest, fetchedLocations, store };
}

const dry = { requestedMode: "dry_run", scope: "incremental", trigger: "admin" } as const;
const live = { requestedMode: "live", scope: "incremental", trigger: "cron" } as const;
const env = (mode: string, extra: Record<string, string> = {}) => ({ GBP_SYNC_MODE: mode, ...extra }) as unknown as NodeJS.ProcessEnv;

describe("runGbpSync", () => {
  it("is disabled, and touches nothing, when GBP_SYNC_MODE is off", async () => {
    const f = fixture({ mappings: [mapping("306", 9)] });
    const report = await runGbpSync(live, { ...f.deps, env: env("") });
    expect(report.status).toBe("disabled");
    expect(f.fetchedLocations).toEqual([]);
    expect(f.store.readConfirmedMappings).not.toHaveBeenCalled();
  });

  it("a DRY RUN reads and reports but writes nothing at all", async () => {
    const f = fixture({
      mappings: [mapping("306", 9)],
      reviews: { "locations/9": [apiReview("GBP00001"), apiReview("GBP00002", { createTime: "2026-09-01T10:00:00Z", reviewer: { displayName: "New Person" }, comment: "Brand new" })] },
      storedByLocation: { "loc-306": [stored("a")] },
    });
    const report = await runGbpSync(dry, { ...f.deps, env: env("dry_run") });
    expect(report.mode).toBe("dry_run");
    expect(report.totals).toMatchObject({ fetched: 2, autoMatched: 1, newReviews: 1, needsReview: 0 });
    expect(f.ingest).not.toHaveBeenCalled();
    expect(f.writes).toEqual({ links: [], items: [], runs: 0, finished: 0 });
  });

  it("the environment can force a dry run even when live is requested", async () => {
    const f = fixture({ mappings: [mapping("306", 9)], reviews: { "locations/9": [apiReview("GBP00001")] } });
    const report = await runGbpSync(live, { ...f.deps, env: env("dry_run") });
    expect(report.mode).toBe("dry_run");
    expect(f.ingest).not.toHaveBeenCalled();
    expect(f.writes.links).toEqual([]);
  });

  it("only requests CONFIRMED listings from Google — an unmapped or other-brand location is never fetched", async () => {
    const f = fixture({ mappings: [mapping("306", 9)], reviews: { "locations/9": [] } });
    await runGbpSync(dry, { ...f.deps, env: env("dry_run") });
    expect(f.fetchedLocations).toEqual(["locations/9"]);
  });

  it("live: files a known review under its EXISTING id with stored name/text, and a new one under the official id", async () => {
    const f = fixture({
      mappings: [mapping("306", 9)],
      reviews: {
        "locations/9": [
          apiReview("GBP00001", { reviewer: { displayName: "Sarah Miller" }, reviewReply: { comment: "Thank you!" } }),
          apiReview("GBP00002", { createTime: "2026-09-01T10:00:00Z", reviewer: { displayName: "New Person" }, comment: "Brand new", starRating: "FOUR" }),
        ],
      },
      storedByLocation: { "loc-306": [stored("a", { reviewerName: "Sarah Miller", reviewText: "Loved it" })] },
    });
    const report = await runGbpSync(live, { ...f.deps, env: env("live") });
    expect(report.status).toBe("succeeded");

    const [batch] = f.ingested;
    const known = batch.find((r) => r.externalReviewId.startsWith("apify-a"))!;
    expect(known).toMatchObject({ reviewerName: "Sarah Miller", reviewText: "Loved it", hasOwnerResponse: true, ownerResponseText: "Thank you!" });
    const fresh = batch.find((r) => r.externalReviewId === "GBP00002")!;
    expect(fresh).toMatchObject({ reviewerName: "New Person", rating: 4, googleAbsoluteDate: "2026-09-01T10:00:00.000Z" });

    /* Newest first, so the anchor planner sees a trustworthy order. */
    expect(batch.map((r) => r.feedPosition)).toEqual([0, 1]);
    expect(f.writes.links.map((l) => [l.gbpReviewId, l.method, l.reviewId])).toEqual(
      expect.arrayContaining([["GBP00001", "auto_match", "a"], ["GBP00002", "created_from_gbp", "row-for-GBP00002"]]),
    );
  });

  it("live: ingestion is called with the gbp_api source and never carries a reporting-week field", async () => {
    const f = fixture({ mappings: [mapping("306", 9)], reviews: { "locations/9": [apiReview("GBP00001")] } });
    await runGbpSync(live, { ...f.deps, env: env("live") });
    expect(f.ingest.mock.calls[0][1]).toMatchObject({ ingestionSource: "gbp_api" });
    expect(JSON.stringify(f.ingested)).not.toMatch(/reporting_?week|firstSeen|anchor/i);
  });

  it("live: an ambiguous review is queued for a person and is NOT ingested", async () => {
    const f = fixture({
      mappings: [mapping("306", 9)],
      reviews: { "locations/9": [apiReview("GBP00001")] },
      storedByLocation: { "loc-306": [stored("a", { googleAbsoluteDate: null })] },
    });
    const report = await runGbpSync(live, { ...f.deps, env: env("live") });
    expect(report.totals.needsReview).toBe(1);
    expect(f.ingest).not.toHaveBeenCalled();
    expect(f.writes.items).toEqual([expect.objectContaining({ gbpReviewId: "GBP00001", candidateReviewIds: ["a"], reasons: ["no_timestamp_on_existing"] })]);
    expect(f.writes.links).toEqual([]);
  });

  it("is idempotent: a second run over already-linked reviews files nothing new and creates no duplicates", async () => {
    const f = fixture({
      mappings: [mapping("306", 9)],
      reviews: { "locations/9": [apiReview("GBP00001")] },
      storedByLocation: { "loc-306": [stored("a", { gbpReviewId: "GBP00001" })] },
    });
    const report = await runGbpSync(live, { ...f.deps, env: env("live") });
    expect(report.totals).toMatchObject({ alreadyLinked: 1, newReviews: 0, autoMatched: 0 });
    expect(f.ingested[0].map((r) => r.externalReviewId)).toEqual([stored("a").externalReviewId]);
    expect(f.writes.links[0].method).toBe("exact_id");
  });

  it("a live historical backfill is refused unless explicitly allowed", async () => {
    const f = fixture({ mappings: [mapping("306", 9)] });
    const refused = await runGbpSync({ ...live, scope: "backfill" }, { ...f.deps, env: env("live") });
    expect(refused.status).toBe("refused");
    expect(f.fetchedLocations).toEqual([]);
    const allowed = await runGbpSync({ ...live, scope: "backfill" }, { ...f.deps, env: env("live", { GBP_ALLOW_LIVE_BACKFILL: "true" }) });
    expect(allowed.status).toBe("succeeded");
  });

  it("a dry-run backfill is always allowed", async () => {
    const f = fixture({ mappings: [mapping("306", 9)] });
    const report = await runGbpSync({ ...dry, scope: "backfill" }, { ...f.deps, env: env("dry_run") });
    expect(report.status).toBe("succeeded");
  });

  it("one failing listing does not stop the others", async () => {
    const f = fixture({
      mappings: [mapping("306", 9), mapping("307", 10)],
      reviews: { "locations/10": [] },
      failOn: { "locations/9": new GbpApiError("not_found", "x") },
    });
    const report = await runGbpSync(dry, { ...f.deps, env: env("dry_run") });
    expect(report.status).toBe("partial");
    expect(report.locations.map((l) => [l.storeCode, l.status, l.errorCode ?? null])).toEqual([["306", "failed", "not_found"], ["307", "ok", null]]);
  });

  it("revoked authorisation stops the whole run instead of failing each listing in turn", async () => {
    const f = fixture({
      mappings: [mapping("306", 9), mapping("307", 10)],
      failOn: { "locations/9": new GbpApiError("auth_revoked", "x") },
    });
    const report = await runGbpSync(live, { ...f.deps, env: env("live") });
    expect(report.status).toBe("failed");
    expect(report.locations[1]).toMatchObject({ status: "skipped", errorCode: "auth_revoked" });
    expect(f.fetchedLocations).toEqual(["locations/9"]);
    expect(f.store.finishRun).toHaveBeenCalledWith("run-1", expect.objectContaining({ status: "failed", errorCode: "auth_revoked" }));
  });

  it("scopes a Pub/Sub-triggered run to the named listing only", async () => {
    const f = fixture({ mappings: [mapping("306", 9), mapping("307", 10)], reviews: { "locations/9": [], "locations/10": [] } });
    await runGbpSync({ ...live, trigger: "pubsub", storeCodes: ["307"] }, { ...f.deps, env: env("dry_run") });
    expect(f.fetchedLocations).toEqual(["locations/10"]);
  });

  it("compares Google's total and average with what is stored, and flags a truncated read", async () => {
    const f = fixture({ mappings: [mapping("306", 9)], reviews: { "locations/9": [apiReview("GBP00001")] }, storedByLocation: { "loc-306": [stored("a"), stored("b", { rating: 3 })] } });
    const report = await runGbpSync(dry, { ...f.deps, env: env("dry_run") });
    expect(report.locations[0]).toMatchObject({ storedTotal: 2, storedAverage: 4, googleTotal: 10, googleAverage: 4.8 });
  });

  it("never writes review text or names into the run ledger summary", async () => {
    const f = fixture({ mappings: [mapping("306", 9)], reviews: { "locations/9": [apiReview("GBP00001")] } });
    await runGbpSync(live, { ...f.deps, env: env("live") });
    const summary = JSON.stringify((f.store.finishRun as ReturnType<typeof vi.fn>).mock.calls[0][1].summary);
    expect(summary).not.toMatch(/Sarah|Loved it/);
  });
});
