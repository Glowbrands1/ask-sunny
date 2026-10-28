import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * GET /api/employees/woven/invites/cron — NEW_HIRE_INVITES_ENABLED (Pau, 28 Oct
 * 2026). Off by default: it answers `disabled` and reads nothing. The secret
 * guards it like every scheduled route.
 */
const SECRET = "cron-secret-for-tests-0123456789abcdef";
const ENV_KEYS = ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SECRET_KEY", "CRON_SECRET", "NEW_HIRE_INVITES_ENABLED", "NEW_HIRE_INVITE_SINCE"] as const;
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  vi.doUnmock("@/lib/employees/woven/access/apply-run");
});

async function loadRoute(env: Partial<Record<(typeof ENV_KEYS)[number], string>>) {
  vi.resetModules();
  for (const key of ENV_KEYS) delete process.env[key];
  Object.assign(process.env, { NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co", SUPABASE_SECRET_KEY: "sb_secret_test", ...env });
  const runs: unknown[] = [];
  vi.doMock("@/lib/employees/woven/access/apply-run", () => ({
    runNewHireInvites: async (...args: unknown[]) => {
      runs.push(args);
      return { status: "completed", sent: 1, failed: 0, waiting: 0, stoppedBy: null };
    },
  }));
  const route = await import("./route");
  return { GET: route.GET, runs };
}

const request = (token?: string) =>
  new Request("https://ask-sunny.test/api/employees/woven/invites/cron", { headers: token ? { authorization: `Bearer ${token}` } : {} });

describe("the hourly new-hire invitation route", () => {
  it("without CRON_SECRET it is closed", async () => {
    const { GET, runs } = await loadRoute({ NEW_HIRE_INVITES_ENABLED: "true", NEW_HIRE_INVITE_SINCE: "2026-10-28" });
    expect((await GET(request(SECRET))).status).toBe(503);
    expect(runs).toEqual([]);
  });

  it("a wrong token is refused", async () => {
    const { GET, runs } = await loadRoute({ CRON_SECRET: SECRET, NEW_HIRE_INVITES_ENABLED: "true", NEW_HIRE_INVITE_SINCE: "2026-10-28" });
    expect((await GET(request("wrong"))).status).toBe(401);
    expect(runs).toEqual([]);
  });

  it("off (the default): disabled, and nothing runs", async () => {
    const { GET, runs } = await loadRoute({ CRON_SECRET: SECRET });
    const response = await GET(request(SECRET));
    expect(await response.json()).toMatchObject({ status: "disabled" });
    expect(runs).toEqual([]);
  });

  it("on without a date: disabled, and says why", async () => {
    const { GET, runs } = await loadRoute({ CRON_SECRET: SECRET, NEW_HIRE_INVITES_ENABLED: "true" });
    expect(await (await GET(request(SECRET))).json()).toMatchObject({ status: "disabled", reason: expect.stringContaining("NEW_HIRE_INVITE_SINCE") });
    expect(runs).toEqual([]);
  });

  it("on: the hourly run, and only codes and counts come back", async () => {
    const { GET, runs } = await loadRoute({ CRON_SECRET: SECRET, NEW_HIRE_INVITES_ENABLED: "true", NEW_HIRE_INVITE_SINCE: "2026-10-28" });
    expect(await (await GET(request(SECRET))).json()).toEqual({ status: "completed", sent: 1, failed: 0, waiting: 0, stoppedBy: null });
    expect(runs).toHaveLength(1);
  });
});
