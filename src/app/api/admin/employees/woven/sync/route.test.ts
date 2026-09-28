import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * POST /api/admin/employees/woven/sync — administrators only, and a dry run
 * unless the body explicitly says `"dryRun": false`.
 */

afterEach(() => {
  vi.doUnmock("@/lib/api/respond");
  vi.doUnmock("@/lib/auth/server");
  vi.doUnmock("@/lib/employees/woven/sync");
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
