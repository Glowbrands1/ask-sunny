import { describe, expect, it } from "vitest";

import { AUTOMATIC_SYNC_INTERVAL_DAYS } from "./types";
import { createSupabaseKnowledgeSyncStore } from "./store";
import { decideScheduledWork, FULL_SYNC_DUE_TOLERANCE_MS, nextAutomaticSyncAt } from "./woven/sync";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The production `knowledge_sync_settings` row was written when the cadence was
 * 30 days and still says so. The weekly schedule must hold against that row,
 * not just against fresh defaults.
 */

/** A client that answers the one query `loadSettings` makes with the given row. */
function clientReturning(row: Record<string, unknown>): SupabaseClient {
  const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: row, error: null }) };
  return { from: () => query } as unknown as SupabaseClient;
}

const LIVE_ROW = {
  source: "woven",
  auto_sync_enabled: true,
  interval_days: 30,
  initial_sync_completed_at: "2026-09-29T23:46:54.561+00:00",
  last_full_scan_at: "2026-09-30T11:54:29.191+00:00",
  last_success_at: "2026-09-30T11:54:29.191+00:00",
};

const HOUR = 60 * 60 * 1000;

describe("the weekly schedule against an existing settings row", () => {
  it("ignores the stored 30-day interval and reports the effective one", async () => {
    const settings = await createSupabaseKnowledgeSyncStore(clientReturning(LIVE_ROW)).loadSettings("woven");
    expect(settings.intervalDays).toBe(AUTOMATIC_SYNC_INTERVAL_DAYS);
    expect(settings.intervalDays).toBe(7);
    expect(settings.autoSyncEnabled).toBe(true);
    expect(nextAutomaticSyncAt(settings)).toBe("2026-10-07T11:54:29.191Z");
  });

  it("is due in the next 09:xx slot after the weekly date, and not before", async () => {
    const settings = await createSupabaseKnowledgeSyncStore(clientReturning(LIVE_ROW)).loadSettings("woven");
    expect(decideScheduledWork(settings, [], new Date("2026-10-06T09:40:00Z"))).toEqual({ run: "none", reason: "not_due" });
    expect(decideScheduledWork(settings, [], new Date("2026-10-07T09:40:00Z"))).toEqual({ run: "sync" });
    /* Overdue (the old 30-day date was 10-30): the next 09:40 slot syncs, no other hour does. */
    expect(decideScheduledWork(settings, [], new Date("2026-10-13T15:40:00Z"))).toEqual({ run: "none", reason: "not_due" });
    expect(decideScheduledWork(settings, [], new Date("2026-10-14T09:40:00Z"))).toEqual({ run: "sync" });
  });
});

describe("the due tolerance cannot cause an early or a duplicate scan", () => {
  const scanAt = (iso: string) => ({
    source: "woven" as const,
    autoSyncEnabled: true,
    intervalDays: 7,
    initialSyncCompletedAt: "2026-01-01T00:00:00Z",
    lastFullScanAt: iso,
    lastSuccessAt: iso,
  });

  it("is smaller than a day, so it can never bring a scan forward a whole day", () => {
    expect(FULL_SYNC_DUE_TOLERANCE_MS).toBeLessThan(24 * HOUR);
  });

  it("never scans earlier than 7 days minus the tolerance after the last complete scan, whatever hour it finished", () => {
    for (let finishHour = 0; finishHour < 24; finishHour += 1) {
      const finished = new Date(Date.UTC(2026, 8, 1, finishHour, 30));
      const settings = scanAt(finished.toISOString());
      for (let day = 0; day <= 9; day += 1) {
        const tick = new Date(Date.UTC(2026, 8, 1 + day, 9, 40));
        const run = decideScheduledWork(settings, [], tick).run === "sync";
        const earliest = finished.getTime() + 7 * 24 * HOUR - FULL_SYNC_DUE_TOLERANCE_MS;
        if (tick.getTime() < earliest) expect(run, `finished ${finished.toISOString()} tick ${tick.toISOString()}`).toBe(false);
        /* A tick two days past the weekly date has always been due: the cadence never skips a week. */
        if (tick.getTime() >= finished.getTime() + 7 * 24 * HOUR + 24 * HOUR) expect(run).toBe(true);
      }
    }
  });

  it("scans at most once per week: right after a scan completes, the next ticks are not due", () => {
    /* A scan started at the 09:40 tick finishes minutes later and stamps lastFullScanAt. */
    const settings = scanAt("2026-10-07T09:46:00Z");
    for (const tick of ["2026-10-07T09:40:00Z", "2026-10-07T10:40:00Z", "2026-10-08T09:40:00Z", "2026-10-13T09:40:00Z"]) {
      expect(decideScheduledWork(settings, [], new Date(tick)), tick).toEqual({ run: "none", reason: "not_due" });
    }
    expect(decideScheduledWork(settings, [], new Date("2026-10-14T09:40:00Z"))).toEqual({ run: "sync" });
  });

  it("only one tick a day can start a scan: the slot is the 09:xx hour", () => {
    const settings = scanAt("2026-09-01T00:00:00Z");
    const syncingHours = Array.from({ length: 24 }, (_, hour) => hour).filter(
      (hour) => decideScheduledWork(settings, [], new Date(Date.UTC(2026, 9, 1, hour, 40))).run === "sync",
    );
    expect(syncingHours).toEqual([9]);
  });
});
