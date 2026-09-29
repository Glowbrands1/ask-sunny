import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * POST /api/admin/employees/woven/validate — administrators only, refused in
 * demo mode, behind ITS OWN switch (`WOVEN_VALIDATION_ENABLED`, never the sync
 * switch), and never cached.
 */

const ENV = [
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
  vi.doUnmock("@/lib/api/respond");
  vi.doUnmock("@/lib/auth/server");
  vi.doUnmock("@/lib/employees/woven/validate");
  vi.doUnmock("@/lib/employees/woven/locations");
  vi.doUnmock("@/lib/employees/woven/sync");
});

interface RunSeen {
  permissions: string[];
  runs: { salons: unknown; includeLocationReview: unknown }[];
  syncs: number;
}

async function loadRoute(
  options: { permitted?: boolean; demo?: boolean; env?: Record<string, string>; role?: string; salonsFail?: boolean } = {},
) {
  vi.resetModules();
  for (const key of ENV) delete process.env[key];
  Object.assign(process.env, options.env ?? {});
  const seen: RunSeen = { permissions: [], runs: [], syncs: 0 };

  vi.doMock("@/lib/api/respond", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@/lib/api/respond")>();
    const { AiError } = await import("@/lib/ai/errors");
    return {
      ...actual,
      assertLiveMode: () => {
        if (options.demo) throw new AiError("not_configured", "demo mode", 409);
      },
      assertNoConfigurationProblems: () => {},
      assertWithinRateLimit: () => {},
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
const post = () => new Request("https://ask-sunny.test/api/admin/employees/woven/validate", { method: "POST" });

describe("POST /api/admin/employees/woven/validate", () => {
  it("requires manage_integrations", async () => {
    const { POST, seen } = await loadRoute({ permitted: false, env: VALIDATION_ONLY });
    expect((await POST(post())).status).toBe(403);
    expect(seen.permissions).toEqual(["manage_integrations"]);
    expect(seen.runs).toHaveLength(0);
  });

  it("is refused in demo mode", async () => {
    const { POST, seen } = await loadRoute({ demo: true, env: VALIDATION_ONLY });
    expect((await POST(post())).status).toBe(409);
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

  it("does not import the sync, the store or any write path", () => {
    /* Code only: the header comment explains the sync switch it does not read. */
    const source = readFileSync(join(__dirname, "route.ts"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    for (const forbidden of ["employees/woven/sync", "employees/woven/store", "runWovenEmployeeSync", "WOVEN_SYNC_ENABLED", "config.enabled"]) {
      expect(source, forbidden).not.toContain(forbidden);
    }
  });
});
