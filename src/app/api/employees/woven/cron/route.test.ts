import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * GET /api/employees/woven/cron — every lock is checked before a sync can start.
 */

const SECRET = "cron-secret-for-tests-0123456789abcdef";

const ENV_KEYS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SECRET_KEY",
  "CRON_SECRET",
  "WOVEN_SYNC_ENABLED",
  "WOVEN_VALIDATION_ENABLED",
  "WOVEN_SYNC_SCHEDULE_ENABLED",
  "WOVEN_SUBSCRIPTION_KEY",
  "WOVEN_USERNAME",
  "WOVEN_PASSWORD",
] as const;

const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  vi.doUnmock("@/lib/employees/woven/sync");
});

async function loadRoute(env: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>) {
  vi.resetModules();
  for (const key of ENV_KEYS) delete process.env[key];
  const next: Record<string, string | undefined> = {
    NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
    SUPABASE_SECRET_KEY: "sb_secret_test",
    ...env,
  };
  for (const [key, value] of Object.entries(next)) if (value !== undefined) process.env[key] = value;

  const runs: unknown[] = [];
  vi.doMock("@/lib/employees/woven/sync", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/lib/employees/woven/sync")>()),
    runWovenEmployeeSync: async (options: unknown) => {
      runs.push(options);
      return { status: "succeeded", runId: "run-1", summary: { employeesReceived: 3 } };
    },
  }));

  const route = await import("./route");
  return { GET: route.GET, runs };
}

const request = (token?: string) =>
  new Request("https://ask-sunny.test/api/employees/woven/cron", {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });

const ALL_ON = {
  CRON_SECRET: SECRET,
  WOVEN_SYNC_ENABLED: "true",
  WOVEN_SYNC_SCHEDULE_ENABLED: "true",
  WOVEN_SUBSCRIPTION_KEY: "k",
  WOVEN_USERNAME: "u",
  WOVEN_PASSWORD: "p",
};

describe("GET /api/employees/woven/cron", () => {
  it("is closed when CRON_SECRET is not set", async () => {
    const { GET, runs } = await loadRoute({ ...ALL_ON, CRON_SECRET: undefined });
    const response = await GET(request(SECRET));
    expect(response.status).toBe(503);
    expect((await response.json()).code).toBe("cron_secret_missing");
    expect(runs).toHaveLength(0);
  });

  it("refuses a missing or wrong bearer token", async () => {
    const { GET, runs } = await loadRoute(ALL_ON);
    expect((await GET(request())).status).toBe(401);
    expect((await GET(request("wrong-secret-wrong-secret-wrong"))).status).toBe(401);
    expect(runs).toHaveLength(0);
  });

  it("starts nothing with only the validation switch on, even with the schedule switch on", async () => {
    const { GET, runs } = await loadRoute({ ...ALL_ON, WOVEN_SYNC_ENABLED: "false", WOVEN_VALIDATION_ENABLED: "true" });
    const response = await GET(request(SECRET));
    expect((await response.json()).status).toBe("disabled");
    expect(runs).toHaveLength(0);
  });

  it("starts nothing while the master switch is off", async () => {
    const { GET, runs } = await loadRoute({ ...ALL_ON, WOVEN_SYNC_ENABLED: "false" });
    const response = await GET(request(SECRET));
    expect(response.status).toBe(200);
    expect((await response.json()).status).toBe("disabled");
    expect(runs).toHaveLength(0);
  });

  it("starts nothing while the schedule switch is off", async () => {
    const { GET, runs } = await loadRoute({ ...ALL_ON, WOVEN_SYNC_SCHEDULE_ENABLED: undefined });
    const response = await GET(request(SECRET));
    expect(response.status).toBe(200);
    expect((await response.json()).status).toBe("schedule_disabled");
    expect(runs).toHaveLength(0);
  });

  it("runs the sync as `cron` when every lock is open", async () => {
    const { GET, runs } = await loadRoute(ALL_ON);
    const response = await GET(request(SECRET));
    expect(response.status).toBe(200);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ requestedBy: "cron" });
  });

  it("refuses when Supabase is not configured", async () => {
    const { GET, runs } = await loadRoute(ALL_ON);
    delete process.env.SUPABASE_SECRET_KEY;
    expect((await GET(request(SECRET))).status).toBe(503);
    expect(runs).toHaveLength(0);
  });
});
