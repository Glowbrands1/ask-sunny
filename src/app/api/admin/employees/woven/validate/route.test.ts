import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * POST /api/admin/employees/woven/validate — administrators only, refused in
 * demo mode, behind the master switch, and never cached.
 */

const ENV = ["WOVEN_SYNC_ENABLED", "WOVEN_SUBSCRIPTION_KEY", "WOVEN_USERNAME", "WOVEN_PASSWORD"] as const;
const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));

afterEach(() => {
  for (const key of ENV) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  vi.doUnmock("@/lib/api/respond");
  vi.doUnmock("@/lib/auth/server");
  vi.doUnmock("@/lib/employees/woven/validate");
});

async function loadRoute(options: { permitted?: boolean; demo?: boolean; env?: Record<string, string> } = {}) {
  vi.resetModules();
  for (const key of ENV) delete process.env[key];
  Object.assign(process.env, options.env ?? {});
  const seen = { permissions: [] as string[], runs: 0 };

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
      return { identity: { subject: "admin-1", email: "admin@suntancity.test", role: "admin" } };
    },
  }));
  vi.doMock("@/lib/employees/woven/validate", () => ({
    runWovenLiveValidation: async () => {
      seen.runs += 1;
      return { ok: true, findings: [] };
    },
  }));

  const route = await import("./route");
  return { POST: route.POST, seen };
}

const ON = { WOVEN_SYNC_ENABLED: "true", WOVEN_SUBSCRIPTION_KEY: "k", WOVEN_USERNAME: "u", WOVEN_PASSWORD: "p" };
const post = () => new Request("https://ask-sunny.test/api/admin/employees/woven/validate", { method: "POST" });

describe("POST /api/admin/employees/woven/validate", () => {
  it("requires manage_integrations", async () => {
    const { POST, seen } = await loadRoute({ permitted: false, env: ON });
    expect((await POST(post())).status).toBe(403);
    expect(seen.permissions).toEqual(["manage_integrations"]);
    expect(seen.runs).toBe(0);
  });

  it("is refused in demo mode", async () => {
    const { POST, seen } = await loadRoute({ demo: true, env: ON });
    expect((await POST(post())).status).toBe(409);
    expect(seen.runs).toBe(0);
  });

  it("starts nothing while the master switch is off", async () => {
    const { POST, seen } = await loadRoute({ env: { ...ON, WOVEN_SYNC_ENABLED: "false" } });
    const response = await POST(post());
    expect(response.status).toBe(409);
    expect((await response.json()).status).toBe("disabled");
    expect(seen.runs).toBe(0);
  });

  it("names missing credentials without running", async () => {
    const { POST, seen } = await loadRoute({ env: { WOVEN_SYNC_ENABLED: "true" } });
    const response = await POST(post());
    expect(response.status).toBe(503);
    expect((await response.json()).missing).toEqual(["WOVEN_SUBSCRIPTION_KEY", "WOVEN_USERNAME", "WOVEN_PASSWORD"]);
    expect(seen.runs).toBe(0);
  });

  it("runs the check and is never cached", async () => {
    const { POST, seen } = await loadRoute({ env: ON });
    const response = await POST(post());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(seen.runs).toBe(1);
  });
});
