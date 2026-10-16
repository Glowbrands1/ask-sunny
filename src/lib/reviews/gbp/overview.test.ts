import { describe, expect, it } from "vitest";

import { buildOverview } from "./overview";
import type { OverviewRows } from "./store";

const apify = { enabled: true, scheduleEnabled: true, lastRunAt: null, lastRunStatus: null, lastSuccessAt: null };
const empty: OverviewRows = { listings: [], runs: [], connection: null };

describe("buildOverview", () => {
  it("keeps Apify primary and Google off by default, with no connection", () => {
    const o = buildOverview(empty, apify, { env: {} as NodeJS.ProcessEnv, now: Date.UTC(2026, 9, 16) });
    expect(o.mode).toBe("off");
    expect(o.primarySource).toBe("apify");
    expect(o.connection.state).toBe("none");
    expect(o.cutover.ready).toBe(false);
  });

  it("shows dry_run without making Google primary, and never exposes secrets", () => {
    const o = buildOverview(empty, apify, { env: { GBP_SYNC_MODE: "dry_run", GOOGLE_GBP_CLIENT_SECRET: "SECRET-VALUE" } as unknown as NodeJS.ProcessEnv });
    expect(o.mode).toBe("dry_run");
    expect(o.primarySource).toBe("apify");
    expect(JSON.stringify(o)).not.toContain("SECRET-VALUE");
  });
});

describe("cutover readiness with nothing measured", () => {
  it("is not ready when no location is mapped, even if a backfill report has zero rows", () => {
    const rows: OverviewRows = {
      listings: [],
      connection: { status: "active", connectedBy: "a@b.test", connectedAt: "2026-10-16T10:00:00Z", lastUsedAt: null, lastErrorCode: null } as OverviewRows["connection"],
      runs: [],
    };
    const o = buildOverview(rows, apify, { env: { GBP_SYNC_MODE: "dry_run" } as unknown as NodeJS.ProcessEnv });
    expect(o.connection.state).toBe("active");
    expect(o.cutover.ready).toBe(false);
    expect(o.cutover.checks.find((c) => c.id === "backfill_measured")?.status).toBe("fail");
  });
});
