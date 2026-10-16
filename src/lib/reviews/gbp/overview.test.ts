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
