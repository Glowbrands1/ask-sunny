import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * THE ADMIN GBP ROUTES — who may call them, what they refuse, and what they never
 * return. Auth, the store and the Google client are mocked; the real route code,
 * OAuth state handling and sealing run.
 */

const KEY = randomBytes(32).toString("base64");
const ENV = [
  "GOOGLE_GBP_CLIENT_ID", "GOOGLE_GBP_CLIENT_SECRET", "GOOGLE_GBP_TOKEN_ENCRYPTION_KEY", "NEXT_PUBLIC_SITE_URL",
  "VERCEL_ENV", "GBP_PUBSUB_TOPIC", "GBP_SYNC_MODE",
] as const;
const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));

beforeEach(() => {
  process.env.GOOGLE_GBP_CLIENT_ID = "client-id";
  process.env.GOOGLE_GBP_CLIENT_SECRET = "CLIENT-SECRET-VALUE";
  process.env.GOOGLE_GBP_TOKEN_ENCRYPTION_KEY = KEY;
  process.env.NEXT_PUBLIC_SITE_URL = "https://ask-sunny.example";
  process.env.VERCEL_ENV = "production";
});
afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.unstubAllGlobals();
  for (const mod of ["@/lib/api/respond", "@/lib/auth/server", "@/lib/reviews/gbp/store", "@/lib/reviews/gbp/runtime"]) vi.doUnmock(mod);
});

async function load(options: { permitted?: boolean; connection?: { refreshTokenSealed: string } | null; notification?: { pubsubTopic: string | null; notificationTypes: string[] } | null } = {}) {
  vi.resetModules();
  const seen = { permissions: [] as string[], saved: [] as { sealed: string; scopes: readonly string[]; actor: string }[], ended: [] as unknown[][], setTopic: [] as string[] };

  vi.doMock("@/lib/api/respond", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/lib/api/respond")>()),
    assertLiveMode: () => {},
    assertNoConfigurationProblems: () => {},
    assertWithinRateLimit: () => {},
  }));
  vi.doMock("@/lib/auth/server", () => ({
    authorizeRequest: async (_r: Request, permission: string) => {
      seen.permissions.push(permission);
      if (options.permitted === false) {
        const { AuthError } = await import("@/lib/auth/types");
        throw new AuthError("forbidden", "Your role does not have permission to do that.");
      }
      return { identity: { subject: "admin-1", email: "admin@example.test", role: "admin" } };
    },
  }));
  vi.doMock("@/lib/reviews/gbp/store", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/lib/reviews/gbp/store")>()),
    createSupabaseStore: () => ({
      getActiveConnection: async () => options.connection ?? null,
      saveConnection: async (sealed: string, scopes: readonly string[], actor: string) => { seen.saved.push({ sealed, scopes, actor }); return "conn-1"; },
      endConnection: async (...a: unknown[]) => { seen.ended.push(a); },
      readListings: async () => [],
    }),
  }));
  vi.doMock("@/lib/reviews/gbp/runtime", () => ({
    buildGbpRuntime: async () => ({
      client: {
        listAccounts: async () => [],
        getNotificationSetting: async () => options.notification ?? null,
        setNotificationSetting: async (_a: string, topic: string) => { seen.setTopic.push(topic); },
      },
      store: { readListings: async () => [] },
      limits: {},
      connectionId: "c",
    }),
  }));
  return {
    seen,
    connect: (await import("./connect/route")).GET,
    callback: (await import("./callback/route")).GET,
    disconnect: (await import("./disconnect/route")).POST,
    admin: (await import("./route")).POST,
  };
}

const get = (path: string, cookie?: string) => new Request(`https://ask-sunny.example${path}`, { headers: cookie ? { cookie } : {} });
const post = (path: string, body: unknown) => new Request(`https://ask-sunny.example${path}`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });

describe("connect", () => {
  it("requires manage_integrations", async () => {
    const r = await load({ permitted: false });
    expect((await r.connect(get("/api/admin/reviews/gbp/connect"))).status).toBe(403);
    expect(r.seen.permissions).toEqual(["manage_integrations"]);
  });

  it("redirects to Google with PKCE and sets ONE sealed, HttpOnly cookie scoped to the callback path", async () => {
    const r = await load();
    const response = await r.connect(get("/api/admin/reviews/gbp/connect"));
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get("location")!);
    expect(location.hostname).toBe("accounts.google.com");
    expect(location.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/business.manage");
    expect(location.searchParams.get("redirect_uri")).toBe("https://ask-sunny.example/api/admin/reviews/gbp/callback");
    const cookie = response.headers.get("set-cookie")!;
    expect(cookie).toMatch(/gbp_oauth=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Path=\/api\/admin\/reviews\/gbp\/callback/);
    expect(JSON.stringify([...response.headers])).not.toContain("CLIENT-SECRET-VALUE");
  });

  it("is refused outside a production deployment (Preview shares the production database)", async () => {
    process.env.VERCEL_ENV = "preview";
    const r = await load();
    expect((await r.connect(get("/api/admin/reviews/gbp/connect"))).status).toBe(409);
  });

  it("answers 503 naming the missing VARIABLES when the key is absent, never values", async () => {
    delete process.env.GOOGLE_GBP_TOKEN_ENCRYPTION_KEY;
    const r = await load();
    const response = await r.connect(get("/api/admin/reviews/gbp/connect"));
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("CLIENT-SECRET-VALUE");
  });
});

describe("callback", () => {
  async function startAttempt(r: Awaited<ReturnType<typeof load>>) {
    const response = await r.connect(get("/api/admin/reviews/gbp/connect"));
    const state = new URL(response.headers.get("location")!).searchParams.get("state")!;
    const cookie = response.headers.get("set-cookie")!.split(";")[0];
    return { state, cookie };
  }

  it("rejects a forged state, saves nothing, and clears the cookie", async () => {
    const r = await load();
    const { cookie } = await startAttempt(r);
    const response = await r.callback(get("/api/admin/reviews/gbp/callback?code=abc&state=forged", cookie));
    expect(response.status).toBe(303);
    expect(new URL(response.headers.get("location")!).searchParams.get("gbp")).toBe("state_mismatch");
    expect(r.seen.saved).toEqual([]);
    expect(response.headers.get("set-cookie")).toMatch(/Max-Age=0/i);
  });

  it("saves the SEALED refresh token for a valid state and a grant with the business scope, and never reflects Google's query string", async () => {
    const r = await load();
    const { state, cookie } = await startAttempt(r);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ refresh_token: "1//0gREFRESH-PLAINTEXT", scope: "https://www.googleapis.com/auth/business.manage" }), { status: 200 })));
    const response = await r.callback(get(`/api/admin/reviews/gbp/callback?code=abc&state=${state}&evil=%3Cscript%3E`, cookie));
    expect(new URL(response.headers.get("location")!).searchParams.get("gbp")).toBe("connected");
    expect(response.headers.get("location")).not.toMatch(/evil|script/);
    expect(r.seen.saved).toHaveLength(1);
    expect(r.seen.saved[0].sealed).toMatch(/^v1\./);
    expect(r.seen.saved[0].sealed).not.toContain("REFRESH-PLAINTEXT");
    expect(r.seen.saved[0].actor).toBe("admin@example.test");
  });

  it("reports a denied consent without detail", async () => {
    const r = await load();
    const { cookie } = await startAttempt(r);
    const response = await r.callback(get("/api/admin/reviews/gbp/callback?error=access_denied&error_description=secret", cookie));
    expect(new URL(response.headers.get("location")!).searchParams.get("gbp")).toBe("denied");
    expect(response.headers.get("location")).not.toContain("secret");
  });
});

describe("disconnect", () => {
  it("ends the local connection and returns no token", async () => {
    const { seal, REFRESH_TOKEN_LABEL } = await import("@/lib/reviews/gbp/crypto");
    const r = await load({ connection: { refreshTokenSealed: seal("1//0gTOKEN", REFRESH_TOKEN_LABEL) } });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
    const response = await r.disconnect(post("/api/admin/reviews/gbp/disconnect", {}));
    const body = JSON.stringify(await response.json());
    expect(body).toContain("revokedAtGoogle");
    expect(body).not.toContain("1//0gTOKEN");
    expect(r.seen.ended).toHaveLength(1);
  });
});

describe("configure_notifications on the SHARED account", () => {
  const request = () => post("/api/admin/reviews/gbp", { action: "configure_notifications", accountName: "accounts/123" });

  it("REFUSES to repoint an account that already notifies a different topic (the other app's)", async () => {
    process.env.GBP_PUBSUB_TOPIC = "projects/sunny-123456/topics/gbp";
    const r = await load({ notification: { pubsubTopic: "projects/bubbles-123456/topics/reviews", notificationTypes: ["NEW_REVIEW"] } });
    const response = await r.admin(request());
    expect(response.status).toBe(409);
    expect((await response.json()).reason).toMatch(/already notifies a different Pub\/Sub topic/);
    expect(r.seen.setTopic).toEqual([]);
  });

  it("is a no-op when the account already points at this topic, and sets it when none is set", async () => {
    process.env.GBP_PUBSUB_TOPIC = "projects/sunny-123456/topics/gbp";
    const same = await load({ notification: { pubsubTopic: "projects/sunny-123456/topics/gbp", notificationTypes: [] } });
    expect((await (await same.admin(request())).json()).unchanged).toBe(true);
    expect(same.seen.setTopic).toEqual([]);
    const none = await load({ notification: null });
    expect((await none.admin(request())).status).toBe(200);
    expect(none.seen.setTopic).toEqual(["projects/sunny-123456/topics/gbp"]);
  });

  it("is refused outside production", async () => {
    process.env.GBP_PUBSUB_TOPIC = "projects/sunny-123456/topics/gbp";
    process.env.VERCEL_ENV = "preview";
    const r = await load({ notification: null });
    expect((await r.admin(request())).status).toBe(409);
    expect(r.seen.setTopic).toEqual([]);
  });
});
