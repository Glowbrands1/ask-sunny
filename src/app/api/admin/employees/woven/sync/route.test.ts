import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * POST /api/admin/employees/woven/sync — administrators only, and a dry run
 * unless the body explicitly says `"dryRun": false` AND `"confirmSave": true`;
 * `dryRun: false` alone is refused with 400 before the sync is called. And with
 * WOVEN_SYNC_ENABLED off it reaches neither Woven nor the database, even while
 * WOVEN_VALIDATION_ENABLED is on for the read-only connection test.
 */

const ENV = ["WOVEN_SYNC_WRITES_ENABLED", "WOVEN_VALIDATION_ACCESS_CODE", "WOVEN_VALIDATION_ENABLED", "WOVEN_SYNC_ENABLED", "WOVEN_SUBSCRIPTION_KEY", "WOVEN_USERNAME", "WOVEN_PASSWORD"] as const;
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

  it("is a dry run by default — including a confirmation without dryRun: false", async () => {
    const { POST, seen } = await loadRoute();
    await POST(post({}));
    await POST(post({ dryRun: "false" }));
    await POST(post({ dryRun: 0 }));
    await POST(post({ confirmSave: true }));
    await POST(post({ dryRun: true, confirmSave: true }));
    await POST(post({ dryRun: "false", confirmSave: true }));
    expect(seen.runs.map((r) => r.dryRun)).toEqual([true, true, true, true, true, true]);
  });

  it("refuses dryRun: false without an explicit confirmSave: true (400), before the sync is called", async () => {
    const { POST, seen } = await loadRoute();
    for (const body of [{ dryRun: false }, { dryRun: false, confirmSave: false }, { dryRun: false, confirmSave: "true" }, { dryRun: false, confirmSave: 1 }]) {
      const response = await POST(post(body));
      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json).toMatchObject({ status: "confirmation_required", field: "confirmSave" });
      expect(json.reason).toContain("confirmSave");
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
    expect(seen.runs).toHaveLength(0);
  });

  it("saves only when the body says dryRun: false and confirmSave: true", async () => {
    const { POST, seen } = await loadRoute();
    const response = await POST(post({ dryRun: false, confirmSave: true }));
    expect(response.status).toBe(200);
    expect(seen.runs).toHaveLength(1);
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
  it.each([{}, { dryRun: true }, { dryRun: false, confirmSave: true }])("body %j: disabled, no Woven call, no database", async (body) => {
    const { POST, seen } = await loadRouteWithRealSync(VALIDATION_ONLY);
    const response = await POST(post(body));
    const json = await response.json();
    expect(json.status).toBe("disabled");
    expect(json.reason).toContain("WOVEN_SYNC_ENABLED");
    expect(seen.fetches).toBe(0);
    expect(seen.storesCreated).toBe(0);
  });

  it("body {\"dryRun\":false} without the confirmation: refused as confirmation_required, no Woven call, no database", async () => {
    const { POST, seen } = await loadRouteWithRealSync(VALIDATION_ONLY);
    const response = await POST(post({ dryRun: false }));
    expect(response.status).toBe(400);
    expect((await response.json()).status).toBe("confirmation_required");
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
    const response = await POST(post({ accessCode: CODE, dryRun: false, confirmSave: true }));
    expect((await response.json()).status).toBe("disabled");
    expect(seen.fetches).toBe(0);
    expect(seen.storesCreated).toBe(0);
  });
});

/*
 * The real route and the real sync, against the fake Woven API on `fetch` and
 * an in-memory store that records every method called — so "succeeded" and
 * "refused" are both proven end to end, including what was written.
 */
async function loadRouteAgainstFakeWoven(env: Record<string, string>) {
  vi.resetModules();
  for (const key of ENV) delete process.env[key];
  Object.assign(process.env, env);
  const { createFakeWoven, FAKE_CREDENTIALS, wovenEmployee } = await import("@/lib/employees/woven/test-support");
  const { MemoryDirectoryStore } = await import("@/lib/employees/woven/memory-store");
  process.env.WOVEN_SUBSCRIPTION_KEY = FAKE_CREDENTIALS.subscriptionKey;
  process.env.WOVEN_USERNAME = FAKE_CREDENTIALS.username;
  process.env.WOVEN_PASSWORD = FAKE_CREDENTIALS.password;

  const fake = createFakeWoven({
    employees: [wovenEmployee("1000", { firstName: "Genevieve", email: "genevieve@suntancity.test" }), wovenEmployee("1001")],
  });
  vi.stubGlobal("fetch", fake.fetch);

  const seen = { storesCreated: 0, calls: [] as string[] };
  const inner = new MemoryDirectoryStore();
  vi.doMock("@/lib/api/respond", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/lib/api/respond")>()),
    assertLiveMode: () => {},
    assertNoConfigurationProblems: () => {},
    assertWithinRateLimit: () => {},
  }));
  vi.doMock("@/lib/auth/server", () => ({
    authorizeRequest: async () => ({ identity: { subject: "admin-1", email: "admin@suntancity.test", role: "admin" } }),
  }));
  vi.doMock("@/lib/employees/woven/store", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/lib/employees/woven/store")>()),
    createSupabaseDirectoryStore: () => {
      seen.storesCreated += 1;
      return new Proxy(inner, {
        get(target, key, receiver) {
          const value = Reflect.get(target, key, receiver);
          if (typeof value !== "function") return value;
          return (...args: unknown[]) => {
            seen.calls.push(String(key));
            return (value as (...a: unknown[]) => unknown).apply(target, args);
          };
        },
      });
    },
  }));

  const route = await import("./route");
  const written = () => [inner.runs.length, inner.rows.size, inner.changes.length, inner.affiliations.size, inner.locationMap.size, inner.positionMap.size];
  return { POST: route.POST, seen, fake, written };
}

/* The real client paces Woven requests ~650ms apart, so a real dry run takes several seconds. */
describe("POST /api/admin/employees/woven/sync with WOVEN_SYNC_ENABLED=true and WOVEN_SYNC_WRITES_ENABLED off", { timeout: 60_000 }, () => {
  const SYNC_ON = { WOVEN_SYNC_ENABLED: "true" };

  it("2. a dry run succeeds: Woven is read, the store only read, nothing written, counts only in the response", async () => {
    for (const body of [{}, { dryRun: true }]) {
      const { POST, seen, fake, written } = await loadRouteAgainstFakeWoven(SYNC_ON);
      const response = await POST(post(body));
      expect(response.status).toBe(200);
      const text = await response.text();
      const json = JSON.parse(text);
      expect(json).toMatchObject({ status: "succeeded", runId: null, summary: { dryRun: true, employeesReceived: 2 } });
      expect(fake.calls.length).toBeGreaterThan(0);
      expect(seen.calls.filter((c) => ["claimRun", "commitRun", "abandonRun"].includes(c))).toEqual([]);
      expect(written()).toEqual([0, 0, 0, 0, 0, 0]);
      /* The dry-run result carries no per-person detail. */
      for (const forbidden of ["Genevieve", "genevieve@", "1000", "1001", "First1001", "Last1001"]) expect(text).not.toContain(forbidden);
    }
  });

  it("dryRun:false without the confirmation is refused (400) — the store is never created and Woven never called", async () => {
    const { POST, seen, fake, written } = await loadRouteAgainstFakeWoven(SYNC_ON);
    const response = await POST(post({ dryRun: false }));
    expect(response.status).toBe(400);
    expect((await response.json()).status).toBe("confirmation_required");
    expect(seen.storesCreated).toBe(0);
    expect(fake.calls).toHaveLength(0);
    expect(written()).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it("3 and 4. a CONFIRMED save is still refused (409) while writes are off — the store is never created and Woven never called", async () => {
    const { POST, seen, fake, written } = await loadRouteAgainstFakeWoven(SYNC_ON);
    const response = await POST(post({ dryRun: false, confirmSave: true }));
    expect(response.status).toBe(409);
    const json = await response.json();
    expect(json.status).toBe("writes_disabled");
    expect(json.reason).toContain("WOVEN_SYNC_WRITES_ENABLED");
    expect(seen.storesCreated).toBe(0);
    expect(seen.calls).toEqual([]);
    expect(fake.calls).toHaveLength(0);
    expect(written()).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it("writes on, no confirmation: still refused (400), nothing read or written", async () => {
    const { POST, seen, fake, written } = await loadRouteAgainstFakeWoven({ ...SYNC_ON, WOVEN_SYNC_WRITES_ENABLED: "true" });
    const response = await POST(post({ dryRun: false }));
    expect(response.status).toBe(400);
    expect(seen.storesCreated).toBe(0);
    expect(fake.calls).toHaveLength(0);
    expect(written()).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it("writes on and confirmed: saves, and reports the saved counts", async () => {
    const { POST, seen, written } = await loadRouteAgainstFakeWoven({ ...SYNC_ON, WOVEN_SYNC_WRITES_ENABLED: "true" });
    const response = await POST(post({ dryRun: false, confirmSave: true }));
    const json = await response.json();
    expect(json.status).toBe("succeeded");
    expect(json.summary.saved).toEqual({
      directoryCreated: 2,
      directoryUpdated: 0,
      directoryUnchanged: 0,
      changesRecorded: 2,
      affiliationsSaved: 2,
      locationsQueued: 1,
      positionsQueued: 1,
    });
    expect(seen.calls).toContain("commitRun");
    expect(written()[1]).toBe(2);
  });

  it("two confirmed saves at once: the run lock lets one through and refuses the other as busy", async () => {
    const { POST, seen, written } = await loadRouteAgainstFakeWoven({ ...SYNC_ON, WOVEN_SYNC_WRITES_ENABLED: "true" });
    const [a, b] = await Promise.all([
      POST(post({ dryRun: false, confirmSave: true })),
      POST(post({ dryRun: false, confirmSave: true })),
    ]);
    const statuses = [(await a.json()).status, (await b.json()).status].sort();
    expect(statuses).toEqual(["busy", "succeeded"]);
    expect(seen.calls.filter((c) => c === "commitRun")).toHaveLength(1);
    expect(written()[0]).toBe(1);
  });
});
