import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * POST /api/admin/employees/woven/validate — administrators only, behind ITS
 * OWN switch (`WOVEN_VALIDATION_ENABLED`, never the sync switch), and never
 * cached. In demo mode it runs only with the sync switch off AND the access
 * code from WOVEN_VALIDATION_ACCESS_CODE; live mode never reads the code.
 */

const ENV = [
  "WOVEN_VALIDATION_ACCESS_CODE",
  "WOVEN_VALIDATION_ENABLED",
  "WOVEN_SYNC_ENABLED",
  "WOVEN_SUBSCRIPTION_KEY",
  "WOVEN_USERNAME",
  "WOVEN_PASSWORD",
] as const;
const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));

afterEach(() => {
  for (const key of ENV) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  vi.restoreAllMocks();
  vi.doUnmock("@/lib/api/respond");
  vi.doUnmock("@/lib/config/runtime");
  vi.doUnmock("@/lib/auth/server");
  vi.doUnmock("@/lib/employees/woven/validate");
  vi.doUnmock("@/lib/employees/woven/locations");
  vi.doUnmock("@/lib/employees/woven/sync");
});

interface RunSeen {
  permissions: string[];
  runs: { salons: unknown; includeLocationReview: unknown }[];
  syncs: number;
  rateLimitChecks: number;
  /** Everything written to the console while the route ran. */
  logged: string[];
}

async function loadRoute(
  options: {
    permitted?: boolean;
    demo?: boolean;
    production?: boolean;
    rateLimited?: boolean;
    env?: Record<string, string>;
    role?: string;
    salonsFail?: boolean;
  } = {},
) {
  vi.resetModules();
  for (const key of ENV) delete process.env[key];
  Object.assign(process.env, options.env ?? {});
  const seen: RunSeen = { permissions: [], runs: [], syncs: 0, rateLimitChecks: 0, logged: [] };
  for (const method of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      seen.logged.push(args.map(String).join(" "));
    });
  }

  vi.doMock("@/lib/config/runtime", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/lib/config/runtime")>()),
    isDemoMode: () => options.demo === true,
    isProductionDeployment: () => options.production === true,
  }));

  vi.doMock("@/lib/api/respond", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@/lib/api/respond")>();
    const { AiError } = await import("@/lib/ai/errors");
    return {
      ...actual,
      assertLiveMode: () => {
        if (options.demo) throw new AiError("not_configured", "demo mode", 409);
      },
      assertNoConfigurationProblems: () => {},
      assertWithinRateLimit: () => {
        seen.rateLimitChecks += 1;
        if (options.rateLimited) throw new AiError("bad_request", "Too many requests.", 429);
      },
    };
  });
  vi.doMock("@/lib/auth/server", () => ({
    authorizeRequest: async (_r: Request, permission: string) => {
      seen.permissions.push(permission);
      if (options.permitted === false) {
        const { AuthError } = await import("@/lib/auth/types");
        throw new AuthError("forbidden", "Your role does not have permission to do that.");
      }
      return { identity: { subject: "admin-1", email: "admin@suntancity.test", role: options.role ?? "admin" } };
    },
  }));
  vi.doMock("@/lib/employees/woven/validate", () => ({
    runWovenLiveValidation: async (opts: { salons: unknown; includeLocationReview: unknown }) => {
      seen.runs.push({ salons: opts.salons, includeLocationReview: opts.includeLocationReview });
      return { ok: true, findings: [] };
    },
  }));
  vi.doMock("@/lib/employees/woven/locations", () => ({
    listSalonsForComparison: async () => {
      if (options.salonsFail) throw new Error("db down");
      return [{ number: "0306", name: "Salon" }];
    },
  }));
  /* Tripwire: the validation route must never reach the sync. */
  vi.doMock("@/lib/employees/woven/sync", () => ({
    runWovenEmployeeSync: async () => {
      seen.syncs += 1;
      return { status: "disabled" };
    },
    outcomeHttpStatus: () => 200,
  }));

  const route = await import("./route");
  return { POST: route.POST, seen };
}

const CREDS = { WOVEN_SUBSCRIPTION_KEY: "k", WOVEN_USERNAME: "u", WOVEN_PASSWORD: "p" };
/** The first live connection test: validation on, the sync OFF. */
const VALIDATION_ONLY = { ...CREDS, WOVEN_VALIDATION_ENABLED: "true", WOVEN_SYNC_ENABLED: "false" };
const post = (body?: unknown) =>
  new Request("https://ask-sunny.test/api/admin/employees/woven/validate", {
    method: "POST",
    ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  });

/* A made-up test value; the real one is set only in Vercel. */
const CODE = "test-access-code-7f3a9c2e41b8";
/** Demo-mode Preview, as it will be configured for the connection test. */
const DEMO_READY = { ...VALIDATION_ONLY, WOVEN_VALIDATION_ACCESS_CODE: CODE };

describe("POST /api/admin/employees/woven/validate", () => {
  it("requires manage_integrations", async () => {
    const { POST, seen } = await loadRoute({ permitted: false, env: VALIDATION_ONLY });
    expect((await POST(post())).status).toBe(403);
    expect(seen.permissions).toEqual(["manage_integrations"]);
    expect(seen.runs).toHaveLength(0);
  });

  it("is refused in demo mode when no access code is configured, naming the variable only", async () => {
    const { POST, seen } = await loadRoute({ demo: true, env: VALIDATION_ONLY });
    const response = await POST(post({ accessCode: CODE }));
    expect(response.status).toBe(503);
    expect((await response.json()).missing).toEqual(["WOVEN_VALIDATION_ACCESS_CODE"]);
    expect(seen.runs).toHaveLength(0);
  });

  it("runs with WOVEN_VALIDATION_ENABLED=true and WOVEN_SYNC_ENABLED=false, and never cached", async () => {
    const { POST, seen } = await loadRoute({ env: VALIDATION_ONLY });
    const response = await POST(post());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(seen.runs).toHaveLength(1);
    expect(seen.syncs).toBe(0);
  });

  it("does not run on the sync switch alone: WOVEN_SYNC_ENABLED no longer opens validation", async () => {
    const { POST, seen } = await loadRoute({ env: { ...CREDS, WOVEN_SYNC_ENABLED: "true" } });
    const response = await POST(post());
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.status).toBe("disabled");
    expect(body.reason).toContain("WOVEN_VALIDATION_ENABLED");
    expect(seen.runs).toHaveLength(0);
    expect(seen.syncs).toBe(0);
  });

  it("starts nothing while every switch is off", async () => {
    const { POST, seen } = await loadRoute({ env: CREDS });
    expect((await POST(post())).status).toBe(409);
    expect(seen.runs).toHaveLength(0);
  });

  it("names missing credentials without running", async () => {
    const { POST, seen } = await loadRoute({ env: { WOVEN_VALIDATION_ENABLED: "true" } });
    const response = await POST(post());
    expect(response.status).toBe(503);
    expect((await response.json()).missing).toEqual(["WOVEN_SUBSCRIPTION_KEY", "WOVEN_USERNAME", "WOVEN_PASSWORD"]);
    expect(seen.runs).toHaveLength(0);
  });

  it("passes the salons for the coverage counts, and the location review only to a manage_users caller", async () => {
    const admin = await loadRoute({ env: VALIDATION_ONLY });
    await admin.POST(post());
    expect(admin.seen.runs[0]).toEqual({ salons: { outcome: "loaded", salons: [{ number: "0306", name: "Salon" }] }, includeLocationReview: true });

    /* A role without manage_users (authorizeRequest is stubbed to admit it here) gets counts only. */
    const other = await loadRoute({ env: VALIDATION_ONLY, role: "employee" });
    await other.POST(post());
    expect(other.seen.runs[0].includeLocationReview).toBe(false);
  });

  it("still runs the Woven checks when the salons cannot be read", async () => {
    const { POST, seen } = await loadRoute({ env: VALIDATION_ONLY, salonsFail: true });
    expect((await POST(post())).status).toBe(200);
    expect(seen.runs[0].salons).toEqual({ outcome: "unavailable", salons: [] });
  });

  it("does not import the sync, the store or any write path, and reads the sync switch only to refuse", () => {
    /* Code only: the header comment explains the switches. */
    const source = readFileSync(join(__dirname, "route.ts"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    for (const forbidden of ["employees/woven/sync", "employees/woven/store", "runWovenEmployeeSync", "getSupabaseAdmin"]) {
      expect(source, forbidden).not.toContain(forbidden);
    }
    /* The one read of the sync switch is the demo-mode refusal: sync ON means no test. */
    expect(source.match(/config\.enabled/g)).toEqual(["config.enabled"]);
    expect(source).toContain("if (!config.validationEnabled || config.enabled) {");
  });
});

describe("demo mode: the access code", () => {
  it("1. missing code: refused, and nothing runs", async () => {
    for (const body of [undefined, {}, { accessCode: "" }, { accessCode: 42 }]) {
      const { POST, seen } = await loadRoute({ demo: true, env: DEMO_READY });
      const response = await POST(post(body));
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ status: "refused", reason: "The access code is missing or incorrect." });
      expect(seen.runs).toHaveLength(0);
    }
  });

  it("2. wrong code: refused with the same generic answer, and nothing runs", async () => {
    for (const wrong of ["nope", CODE.slice(0, -1), `${CODE}x`, CODE.toUpperCase(), "x".repeat(600)]) {
      const { POST, seen } = await loadRoute({ demo: true, env: DEMO_READY });
      const response = await POST(post({ accessCode: wrong }));
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ status: "refused", reason: "The access code is missing or incorrect." });
      expect(seen.runs).toHaveLength(0);
    }
  });

  it("3. correct code + validation on + sync off: the validation runs, and only it", async () => {
    const { POST, seen } = await loadRoute({ demo: true, env: DEMO_READY });
    const response = await POST(post({ accessCode: CODE }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(seen.runs).toHaveLength(1);
    expect(seen.syncs).toBe(0);
    expect(seen.permissions).toEqual(["manage_integrations"]);
  });

  it("the correct code does not help while WOVEN_SYNC_ENABLED is on", async () => {
    const { POST, seen } = await loadRoute({ demo: true, env: { ...DEMO_READY, WOVEN_SYNC_ENABLED: "true" } });
    const response = await POST(post({ accessCode: CODE }));
    expect(response.status).toBe(409);
    expect((await response.json()).reason).toContain("WOVEN_SYNC_ENABLED off");
    expect(seen.runs).toHaveLength(0);
  });

  it("the correct code does not help while WOVEN_VALIDATION_ENABLED is off", async () => {
    const { POST, seen } = await loadRoute({ demo: true, env: { ...DEMO_READY, WOVEN_VALIDATION_ENABLED: "false" } });
    expect((await POST(post({ accessCode: CODE }))).status).toBe(409);
    expect(seen.runs).toHaveLength(0);
  });

  it("is never available on a Vercel Production deployment, even in demo mode with the right code", async () => {
    const { POST, seen } = await loadRoute({ demo: true, production: true, env: DEMO_READY });
    expect((await POST(post({ accessCode: CODE }))).status).toBe(409);
    expect(seen.runs).toHaveLength(0);
  });

  it("is rate-limited BEFORE the code is compared, so it cannot be guessed at speed", async () => {
    const { POST, seen } = await loadRoute({ demo: true, rateLimited: true, env: DEMO_READY });
    expect((await POST(post({ accessCode: CODE }))).status).toBe(429);
    expect(seen.rateLimitChecks).toBe(1);
    expect(seen.runs).toHaveLength(0);
  });

  it("a code shorter than 16 characters counts as not configured", async () => {
    const { POST, seen } = await loadRoute({ demo: true, env: { ...VALIDATION_ONLY, WOVEN_VALIDATION_ACCESS_CODE: "short" } });
    expect((await POST(post({ accessCode: "short" }))).status).toBe(503);
    expect(seen.runs).toHaveLength(0);
  });

  it("6. the code never appears in any response or log", async () => {
    const cases: [Parameters<typeof loadRoute>[0], unknown][] = [
      [{ demo: true, env: DEMO_READY }, { accessCode: CODE }],
      [{ demo: true, env: DEMO_READY }, { accessCode: "wrong-guess-000000" }],
      [{ demo: true, env: DEMO_READY }, {}],
      [{ demo: true, env: { ...DEMO_READY, WOVEN_SYNC_ENABLED: "true" } }, { accessCode: CODE }],
      [{ demo: true, production: true, env: DEMO_READY }, { accessCode: CODE }],
      [{ demo: true, rateLimited: true, env: DEMO_READY }, { accessCode: CODE }],
      [{ demo: true, permitted: false, env: DEMO_READY }, { accessCode: CODE }],
      [{ env: DEMO_READY }, { accessCode: CODE }],
    ];
    for (const [options, body] of cases) {
      const { POST, seen } = await loadRoute(options);
      const response = await POST(post(body));
      const text = `${await response.text()} ${JSON.stringify([...response.headers])} ${seen.logged.join(" ")}`;
      expect(text).not.toContain(CODE);
      expect(text).not.toContain("wrong-guess-000000");
    }
  });
});

describe("7. live mode is unchanged", () => {
  it("runs without any code, and ignores one if sent", async () => {
    for (const body of [undefined, { accessCode: "anything-at-all-000" }]) {
      const { POST, seen } = await loadRoute({ env: VALIDATION_ONLY });
      expect((await POST(post(body))).status).toBe(200);
      expect(seen.runs).toHaveLength(1);
    }
  });

  it("does not ask for the code even when one is configured", async () => {
    const { POST, seen } = await loadRoute({ env: DEMO_READY });
    expect((await POST(post())).status).toBe(200);
    expect(seen.runs).toHaveLength(1);
  });

  it("still checks permission before the rate limit, as before", async () => {
    const { POST, seen } = await loadRoute({ permitted: false, env: DEMO_READY });
    expect((await POST(post())).status).toBe(403);
    expect(seen.rateLimitChecks).toBe(0);
  });
});
