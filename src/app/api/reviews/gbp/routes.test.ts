import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runGbpSync = vi.fn();
const readConfirmedMappings = vi.fn();

vi.mock("@/lib/reviews/gbp/sync", () => ({ runGbpSync: (...a: unknown[]) => runGbpSync(...a) }));
vi.mock("@/lib/reviews/gbp/runtime", () => ({
  buildGbpRuntime: () => ({ client: {}, store: { readConfirmedMappings }, limits: {} }),
}));
vi.mock("@/lib/reviews/gbp/pubsub", async () => {
  const actual = await vi.importActual<typeof import("@/lib/reviews/gbp/pubsub")>("@/lib/reviews/gbp/pubsub");
  return { ...actual, verifyPubSubRequest: vi.fn() };
});

import { verifyPubSubRequest } from "@/lib/reviews/gbp/pubsub";
import { GET as cronGet } from "./cron/route";
import { POST as pubsubPost } from "./pubsub/route";

const SECRET = "c".repeat(40);
const ENV_KEYS = ["CRON_SECRET", "GBP_SYNC_MODE", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SECRET_KEY", "NEXT_PUBLIC_DEMO_MODE"];
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  process.env.CRON_SECRET = SECRET;
  process.env.NEXT_PUBLIC_DEMO_MODE = "false";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SECRET_KEY = "service-key-for-test";
  delete process.env.GBP_SYNC_MODE;
  runGbpSync.mockReset();
  readConfirmedMappings.mockReset();
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const cron = (token?: string) =>
  cronGet(new Request("https://app.test/api/reviews/gbp/cron", { headers: token ? { authorization: `Bearer ${token}` } : {} }));

describe("GET /api/reviews/gbp/cron", () => {
  it("refuses without the cron secret and with a wrong one", async () => {
    expect((await cron()).status).toBe(401);
    expect((await cron("wrong".repeat(10))).status).toBe(401);
    expect(runGbpSync).not.toHaveBeenCalled();
  });

  it("refuses everyone when CRON_SECRET is not configured", async () => {
    delete process.env.CRON_SECRET;
    expect((await cron(SECRET)).status).toBe(503);
  });

  it("is inert while GBP_SYNC_MODE is unset: 200 disabled, no sync", async () => {
    const response = await cron(SECRET);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "disabled" });
    expect(runGbpSync).not.toHaveBeenCalled();
  });

  it("runs an INCREMENTAL reconciliation (never a backfill) and returns counts only", async () => {
    process.env.GBP_SYNC_MODE = "dry_run";
    runGbpSync.mockResolvedValue({
      mode: "dry_run",
      status: "succeeded",
      requests: 4,
      totals: { fetched: 3, alreadyLinked: 1, autoMatched: 1, newReviews: 1, needsReview: 0, failedLocations: 0 },
      locations: [{ storeCode: "306", status: "ok", needsReviewItems: [{ reviewer: "Sarah Miller", excerpt: "private words" }] }],
    });
    const response = await cron(SECRET);
    expect(runGbpSync.mock.calls[0][0]).toMatchObject({ scope: "incremental", trigger: "cron" });
    const text = JSON.stringify(await response.json());
    expect(text).toContain("fetched");
    expect(text).not.toMatch(/Sarah|private words/);
  });
});

const envelope = (payload: unknown) => ({
  message: { data: Buffer.from(JSON.stringify(payload)).toString("base64") },
});
const push = (body: unknown) =>
  pubsubPost(new Request("https://app.test/api/reviews/gbp/pubsub", { method: "POST", headers: { authorization: "Bearer x" }, body: JSON.stringify(body) }));

describe("POST /api/reviews/gbp/pubsub", () => {
  it("rejects an unauthenticated delivery and reports missing auth config as 503", async () => {
    vi.mocked(verifyPubSubRequest).mockResolvedValueOnce("unauthorized");
    expect((await push({})).status).toBe(401);
    vi.mocked(verifyPubSubRequest).mockResolvedValueOnce("unconfigured");
    expect((await push({})).status).toBe(503);
    expect(runGbpSync).not.toHaveBeenCalled();
  });

  it("acknowledges and does nothing while the integration is off", async () => {
    vi.mocked(verifyPubSubRequest).mockResolvedValue("ok");
    expect((await push(envelope({ review: "accounts/1/locations/2/reviews/x" }))).status).toBe(204);
    expect(runGbpSync).not.toHaveBeenCalled();
  });

  it("acknowledges (no retry loop) a malformed message and a location we do not sync", async () => {
    vi.mocked(verifyPubSubRequest).mockResolvedValue("ok");
    process.env.GBP_SYNC_MODE = "live";
    expect((await push({ nonsense: true })).status).toBe(204);
    readConfirmedMappings.mockResolvedValue([{ storeCode: "306", accountName: "accounts/1", gbpLocationName: "locations/2" }]);
    /* A Buff City location: valid message, but not a confirmed Sun Tan City listing. */
    expect((await push(envelope({ review: "accounts/1/locations/999/reviews/x" }))).status).toBe(204);
    expect(runGbpSync).not.toHaveBeenCalled();
  });

  it("syncs only the named confirmed listing, and acknowledges on success", async () => {
    vi.mocked(verifyPubSubRequest).mockResolvedValue("ok");
    process.env.GBP_SYNC_MODE = "live";
    readConfirmedMappings.mockResolvedValue([{ storeCode: "306", accountName: "accounts/1", gbpLocationName: "locations/2" }]);
    runGbpSync.mockResolvedValue({ status: "succeeded" });
    expect((await push(envelope({ notificationType: "NEW_REVIEW", review: "accounts/1/locations/2/reviews/x" }))).status).toBe(204);
    expect(runGbpSync.mock.calls[0][0]).toMatchObject({ trigger: "pubsub", scope: "incremental", storeCodes: ["306"] });
  });

  it("does NOT acknowledge a failed sync, so Pub/Sub redelivers it", async () => {
    vi.mocked(verifyPubSubRequest).mockResolvedValue("ok");
    process.env.GBP_SYNC_MODE = "live";
    readConfirmedMappings.mockResolvedValue([{ storeCode: "306", accountName: "accounts/1", gbpLocationName: "locations/2" }]);
    runGbpSync.mockResolvedValue({ status: "failed" });
    expect((await push(envelope({ review: "accounts/1/locations/2/reviews/x" }))).status).toBe(500);
  });
});
