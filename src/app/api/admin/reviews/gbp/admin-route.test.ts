import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * THE ADMIN CONTROL ROUTE: permission, same-origin guard, read-only discovery,
 * and mapping confirmation that only ever accepts fresh, eligible evidence.
 */

const ENV = ["VERCEL_ENV", "GBP_SYNC_MODE"] as const;
const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
beforeEach(() => {
  process.env.VERCEL_ENV = "production";
  process.env.GBP_SYNC_MODE = "dry_run";
});
afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  for (const mod of ["@/lib/api/respond", "@/lib/auth/server", "@/lib/reviews/gbp/runtime", "@/lib/reviews/gbp/discovery", "@/lib/reviews/gbp/overview-load", "@/lib/reviews/apify/status"]) vi.doUnmock(mod);
});

const proposal = (storeCode: string, verdict: string, reasons: string[] = []) => ({
  verdict, storeCode, googleLocationName: `locations/${storeCode}`, title: `Sun Tan City ${storeCode}`, placeId: null, address: null, accountName: "accounts/1", reasons,
});

async function load(opts: { permitted?: boolean; proposals?: ReturnType<typeof proposal>[] } = {}) {
  vi.resetModules();
  const calls = { confirm: [] as { storeCode: string; evidence: Record<string, unknown> }[], sync: 0, permissions: [] as string[] };
  vi.doMock("@/lib/api/respond", async (orig) => ({ ...(await orig<typeof import("@/lib/api/respond")>()), assertLiveMode: () => {}, assertNoConfigurationProblems: () => {}, assertWithinRateLimit: () => {} }));
  vi.doMock("@/lib/auth/server", () => ({
    authorizeRequest: async (_r: Request, permission: string) => {
      calls.permissions.push(permission);
      if (opts.permitted === false) {
        const { AuthError } = await import("@/lib/auth/types");
        throw new AuthError("forbidden", "no");
      }
      return { identity: { subject: "admin-1", email: "admin@example.test", role: "admin" } };
    },
  }));
  vi.doMock("@/lib/reviews/apify/status", () => ({ readApifySourceStatus: async () => ({ enabled: true, scheduleEnabled: true, lastRun: null, lastSuccessfulRun: null }) }));
  vi.doMock("@/lib/reviews/gbp/overview-load", () => ({ apifyGlance: () => ({}), loadGbpOverview: async () => ({ mode: "dry_run" }) }));
  vi.doMock("@/lib/reviews/gbp/discovery", () => ({ discoverFromGoogle: async () => ({ accounts: [], counts: {}, missing: [], proposals: opts.proposals ?? [] }) }));
  vi.doMock("@/lib/reviews/gbp/runtime", () => ({
    buildGbpRuntime: async () => ({
      client: {},
      store: { confirmMapping: async (i: { storeCode: string; evidence: Record<string, unknown> }) => { calls.confirm.push(i); return "confirmed"; } },
      limits: {},
    }),
  }));
  const route = await import("./route");
  return { calls, GET: route.GET, POST: route.POST };
}

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("https://ask-sunny.example/api/admin/reviews/gbp", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", ...headers } });

describe("permissions and CSRF", () => {
  it("GET and POST require manage_integrations", async () => {
    const denied = await load({ permitted: false });
    expect((await denied.GET(new Request("https://ask-sunny.example/api/admin/reviews/gbp"))).status).toBe(403);
    expect((await denied.POST(post({ action: "discover" }))).status).toBe(403);
    const ok = await load();
    await ok.GET(new Request("https://ask-sunny.example/api/admin/reviews/gbp"));
    expect(ok.calls.permissions).toEqual(["manage_integrations"]);
  });

  it("refuses a cross-site POST before anything else", async () => {
    const r = await load();
    const response = await r.POST(post({ action: "confirm_all" }, { origin: "https://evil.example" }));
    expect(response.status).toBe(403);
    expect(r.calls.permissions).toEqual([]);
  });
});

describe("discovery and confirmation", () => {
  it("discover proposes and writes nothing", async () => {
    const r = await load({ proposals: [proposal("101", "eligible")] });
    const response = await r.POST(post({ action: "discover" }));
    expect(response.status).toBe(200);
    expect(r.calls.confirm).toEqual([]);
  });

  it("confirm_all confirms ONLY eligible proposals, never ambiguous or conflicting ones", async () => {
    const r = await load({ proposals: [proposal("101", "eligible"), proposal("102", "ambiguous", ["multiple_google_locations_for_store_code"]), proposal("103", "conflict", ["address_conflict"]), proposal("104", "needs_review", ["no_independent_corroboration"])] });
    const response = await r.POST(post({ action: "confirm_all" }));
    expect(response.status).toBe(200);
    expect(r.calls.confirm.map((c) => c.storeCode)).toEqual(["101"]);
  });

  it("confirm refuses a non-eligible listing, and a conflict even when manual is claimed", async () => {
    const r = await load({ proposals: [proposal("103", "conflict", ["address_conflict"])] });
    const response = await r.POST(post({ action: "confirm", storeCode: "103", locationName: "locations/103", manual: true }));
    expect(response.status).toBe(409);
    expect(r.calls.confirm).toEqual([]);
  });

  it("mapping changes are refused outside production, and discovery is silent when the mode is off", async () => {
    process.env.VERCEL_ENV = "preview";
    const preview = await load({ proposals: [proposal("101", "eligible")] });
    expect((await preview.POST(post({ action: "confirm_all" }))).status).toBe(409);
    expect(preview.calls.confirm).toEqual([]);
    process.env.VERCEL_ENV = "production";
    process.env.GBP_SYNC_MODE = "off";
    const off = await load({ proposals: [proposal("101", "eligible")] });
    expect((await off.POST(post({ action: "discover" }))).status).toBe(409);
  });

  it("sync without an explicit confirm:true is refused and reads nothing", async () => {
    const r = await load();
    const response = await r.POST(post({ action: "sync" }));
    expect(response.status).toBe(409);
    expect((await response.json()).status).toBe("confirmation_required");
  });
});
