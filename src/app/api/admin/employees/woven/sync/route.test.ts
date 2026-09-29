import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * POST /api/admin/employees/woven/sync — administrators only, and a dry run
 * unless the body explicitly says `"dryRun": false`. And with
 * WOVEN_SYNC_ENABLED off it reaches neither Woven nor the database, even while
 * WOVEN_VALIDATION_ENABLED is on for the read-only connection test.
 */

const ENV = ["WOVEN_VALIDATION_ACCESS_CODE", "WOVEN_VALIDATION_ENABLED", "WOVEN_SYNC_ENABLED", "WOVEN_SUBSCRIPTION_KEY", "WOVEN_USERNAME", "WOVEN_PASSWORD"] as const;
const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));

afterEach(() => {
  for (const key of ENV) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  vi.unstubAllGlobals();
  vi.doUnmock("@/lib/api/respond");
  vi.doUnmock("@/lib/auth/server");
  vi.doUnmock("@/lib/employees/woven/sync");
  vi.doUnmock("@/lib/employees/woven/store");
  vi.doUnmock("@/lib/config/runtime");
});

async function loadRoute(options: { permitted?: boolean } = {}) {
  vi.resetModules();
  const seen = { permissions: [] as string[], runs: [] as Record<string, unknown>[] };

  vi.doMock("@/lib/api/respond", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/lib/api/respond")>()),
    assertLiveMode: () => {},
    assertNoConfigurationProblems: () => {},
    assertWithinRateLimit: () => {},
  }));

  vi.doMock("@/lib/auth/server", () => ({
    authorizeRequest: async (_request: Request, permission: string) => {
      seen.permissions.push(permission);
      if (options.permitted === false) {
        const { AuthError } = await import("@/lib/auth/types");
        throw new AuthError("forbidden", "Your role does not have permission to do that.");
      }
      return { identity: { subject: "admin-1", email: "admin@suntancity.test", role: "admin" } };
    },
  }));

  vi.doMock("@/lib/employees/woven/sync", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/lib/employees/woven/sync")>()),
    runWovenEmployeeSync: async (opts: Record<string, unknown>) => {
      seen.runs.push(opts);
      return { status: "succeeded", runId: null, summary: { dryRun: opts.dryRun } };
    },
  }));

  const route = await import("./route");
  return { POST: route.POST, seen };
}

const post = (body: unknown) =>
  new Request("https://ask-sunny.test/api/admin/employees/woven/sync", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("POST /api/admin/employees/woven/sync", () => {
  it("requires manage_integrations", async () => {
    const { POST, seen } = await loadRoute({ permitted: false });
    const response = await POST(post({}));
    expect(response.status).toBe(403);
    expect(seen.permissions).toEqual(["manage_integrations"]);
    expect(seen.runs).toHaveLength(0);
  });

  it("is a dry run by default", async () => {
    const { POST, seen } = await loadRoute();
    await POST(post({}));
    await POST(post({ dryRun: "false" }));
    await POST(post({ dryRun: 0 }));
    expect(seen.runs.map((r) => r.dryRun)).toEqual([true, true, true]);
  });

  it("saves only when the body says dryRun: false", async () => {
    const { POST, seen } = await loadRoute();
    const response = await POST(post({ dryRun: false }));
    expect(response.status).toBe(200);
    expect(seen.runs[0]).toMatchObject({ dryRun: false, requestedBy: "admin:admin@suntancity.test" });
  });

  it("takes the audit label from the session, never the body", async () => {
    const { POST, seen } = await loadRoute();
    await POST(post({ dryRun: true, requestedBy: "someone-else" }));
    expect(seen.runs[0].requestedBy).toBe("admin:admin@suntancity.test");
  });

  it("is never cached", async () => {
    const { POST } = await loadRoute();
    const response = await POST(post({}));
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});

/*
 * The REAL sync function runs below; only the network and the store are
 * tripwires, so a disabled outcome here proves neither was reached.
 */
async function loadRouteWithRealSync(env: Record<string, string>, options: { demo?: boolean } = {}) {
  vi.resetModules();
  for (const key of ENV) delete process.env[key];
  Object.assign(process.env, env);
  const seen = { fetches: 0, storesCreated: 0 };

  vi.stubGlobal("fetch", async () => {
    seen.fetches += 1;
    throw new Error("no network in this test");
  });
  if (options.demo) {
    /* Demo mode for real: the route's own assertLiveMode reads this. */
    vi.doMock("@/lib/config/runtime", async (importOriginal) => ({
      ...(await importOriginal<typeof import("@/lib/config/runtime")>()),
      isDemoMode: () => true,
      isProductionDeployment: () => false,
    }));
  }
  vi.doMock("@/lib/api/respond", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@/lib/api/respond")>();
    return {
      ...actual,
      ...(options.demo ? {} : { assertLiveMode: () => {} }),
      assertNoConfigurationProblems: () => {},
      assertWithinRateLimit: () => {},
    };
  });
  vi.doMock("@/lib/auth/server", () => ({
    authorizeRequest: async () => ({ identity: { subject: "admin-1", email: "admin@suntancity.test", role: "admin" } }),
  }));
  vi.doMock("@/lib/employees/woven/store", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/lib/employees/woven/store")>()),
    createSupabaseDirectoryStore: () => {
      seen.storesCreated += 1;
      throw new Error("the store must not be reached");
    },
  }));

  const route = await import("./route");
  return { POST: route.POST, seen };
}

const VALIDATION_ONLY = {
  WOVEN_VALIDATION_ENABLED: "true",
  WOVEN_SYNC_ENABLED: "false",
  WOVEN_SUBSCRIPTION_KEY: "k",
  WOVEN_USERNAME: "u",
  WOVEN_PASSWORD: "p",
};

describe("POST /api/admin/employees/woven/sync while WOVEN_SYNC_ENABLED=false and WOVEN_VALIDATION_ENABLED=true", () => {
  it.each([{}, { dryRun: true }, { dryRun: false }])("body %j: disabled, no Woven call, no database", async (body) => {
    const { POST, seen } = await loadRouteWithRealSync(VALIDATION_ONLY);
    const response = await POST(post(body));
    const json = await response.json();
    expect(json.status).toBe("disabled");
    expect(json.reason).toContain("WOVEN_SYNC_ENABLED");
    expect(seen.fetches).toBe(0);
    expect(seen.storesCreated).toBe(0);
  });
});

describe("the validation access code never opens the manual sync", () => {
  const CODE = "test-access-code-7f3a9c2e41b8";
  const WITH_CODE = { ...VALIDATION_ONLY, WOVEN_VALIDATION_ACCESS_CODE: CODE };

  it("demo mode + the correct code: still refused as demo mode, no Woven call, no database", async () => {
    for (const body of [{ accessCode: CODE }, { accessCode: CODE, dryRun: false }]) {
      const { POST, seen } = await loadRouteWithRealSync(WITH_CODE, { demo: true });
      const response = await POST(post(body));
      expect(response.status).toBe(409);
      expect(await response.text()).not.toContain(CODE);
      expect(seen.fetches).toBe(0);
      expect(seen.storesCreated).toBe(0);
    }
  });

  it("live mode + the correct code: still disabled by WOVEN_SYNC_ENABLED", async () => {
    const { POST, seen } = await loadRouteWithRealSync(WITH_CODE);
    const response = await POST(post({ accessCode: CODE, dryRun: false }));
    expect((await response.json()).status).toBe("disabled");
    expect(seen.fetches).toBe(0);
    expect(seen.storesCreated).toBe(0);
  });
});
