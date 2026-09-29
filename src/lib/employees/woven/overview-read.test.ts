import { afterEach, describe, expect, it } from "vitest";

import { __setSupabaseAdmin } from "@/lib/supabase/server";
import { readOverviewCounts, readWovenSyncStatus } from "./status";

/**
 * THE OVERVIEW'S READ PATH, against the row shapes the Production database
 * returned after the first stored sync (read as service_role, 29 September
 * 2026). A fake PostgREST client answers each query from those rows, so this
 * proves the mapping from the views' columns to the cards — not the SQL,
 * which the migration verifier checks.
 */

type Filter = { op: string; column: string; value: unknown };
type Query = { table: string; head: boolean; filters: Filter[] };

const RUN_ID = "11111111-2222-3333-4444-555555555555";
const STATUS_ROW = {
  source_system: "woven",
  last_run_id: RUN_ID,
  last_run_status: "succeeded",
  last_run_source_mode: "manual_poll",
  last_run_started_at: "2026-09-29T22:50:25.468308+00:00",
  last_run_finished_at: "2026-09-29T22:50:56.100000+00:00",
  last_run_error_code: null,
  last_success_run_id: RUN_ID,
  last_success_at: "2026-09-29T22:50:56.100000+00:00",
  total_active: 150,
  total_terminated: 0,
  total_status_unknown: 0,
  unmapped_locations: 17,
  unmapped_positions: 13,
  unreviewed_changes: 150,
};
const RUN_ROW = {
  id: RUN_ID,
  status: "succeeded",
  requested_by: "admin:owner@example.test",
  started_at: STATUS_ROW.last_run_started_at,
  finished_at: STATUS_ROW.last_run_finished_at,
  error_code: null,
  employees_received: 150,
  employees_active: 150,
  employees_terminated: 0,
  changes_recorded: 150,
  unmapped_locations: 17,
  details_skipped: 3,
};

function answer(q: Query): { data: unknown; count: number | null; error: null } {
  const eq = (column: string) => q.filters.find((f) => f.op === "eq" && f.column === column)?.value;
  switch (q.table) {
    case "employee_sync_status":
      return { data: STATUS_ROW, count: null, error: null };
    case "employee_sync_run_summary":
      return { data: [{ error_count: 0, status: "succeeded", employees_fetched: 150 }], count: null, error: null };
    case "employee_sync_runs":
      if (eq("requested_by") === "cron") return { data: [], count: null, error: null };
      return { data: [RUN_ROW], count: null, error: null };
    case "employee_directory_changes": {
      const initialLoad = eq("sync_run_id") === RUN_ID && eq("change_kind") === "new_employee" && eq("classification") === "initial_load";
      return { data: null, count: initialLoad ? 150 : 0, error: null };
    }
    case "employee_access_directory": {
      const withIssues = q.filters.some((f) => f.op === "neq" && f.column === "data_issues");
      return { data: null, count: withIssues ? 150 : 0, error: null };
    }
    default:
      throw new Error(`unexpected table ${q.table}`);
  }
}

function fakeClient() {
  const tables: string[] = [];
  const from = (table: string) => {
    tables.push(table);
    const q: Query = { table, head: false, filters: [] };
    const builder = {
      select(_cols: string, opts?: { head?: boolean }) {
        q.head = opts?.head === true;
        return builder;
      },
      eq(column: string, value: unknown) { q.filters.push({ op: "eq", column, value }); return builder; },
      neq(column: string, value: unknown) { q.filters.push({ op: "neq", column, value }); return builder; },
      is(column: string, value: unknown) { q.filters.push({ op: "is", column, value }); return builder; },
      in(column: string, value: unknown) { q.filters.push({ op: "in", column, value }); return builder; },
      or(value: string) { q.filters.push({ op: "or", column: "", value }); return builder; },
      order() { return builder; },
      limit() { return builder; },
      maybeSingle: async () => answer(q),
      then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
        return Promise.resolve().then(() => answer(q)).then(resolve, reject);
      },
    };
    return builder;
  };
  return { client: { from } as never, tables };
}

afterEach(() => __setSupabaseAdmin(null));

describe("the Overview read path, after the first stored sync", () => {
  it("readOverviewCounts reports the stored run, 150 active, 17 locations and 13 positions unmapped, and the initial load", async () => {
    const { client, tables } = fakeClient();
    __setSupabaseAdmin(client);
    const counts = await readOverviewCounts();
    expect(counts).toEqual({
      lastSuccessAt: STATUS_ROW.last_success_at,
      lastAttemptAt: STATUS_ROW.last_run_started_at,
      lastAttemptStatus: "succeeded",
      totalActive: 150,
      totalTerminated: 0,
      totalStatusUnknown: 0,
      newHiresSinceLast: null,
      initialLoadCount: 150,
      terminationsSinceLast: 0,
      positionChangesSinceLast: 0,
      confirmedPromotionsDemotionsSinceLast: 0,
      transfersSinceLast: 0,
      locationAccessAddedSinceLast: 0,
      locationAccessRemovedSinceLast: 0,
      lastRunErrorCount: 0,
      recordsWithIssues: 150,
      unmappedLocations: 17,
      unmappedPositions: 13,
      employeesMissingEmail: 0,
      unreviewedChanges: 150,
      recentRuns: [{ status: "succeeded", employeesFetched: 150 }],
    });
    /* It reads the sync's own views and tables — nothing else. */
    expect([...new Set(tables)].sort()).toEqual([
      "employee_access_directory",
      "employee_directory_changes",
      "employee_sync_run_summary",
      "employee_sync_status",
    ]);
  });

  it("readWovenSyncStatus reports the last success, sign-in evidence and the run", async () => {
    const { client } = fakeClient();
    __setSupabaseAdmin(client);
    const status = await readWovenSyncStatus();
    expect(status.lastSuccessAt).toBe(STATUS_ROW.last_success_at);
    expect(status.lastCronSuccessAt).toBeNull();
    expect(status.signInEvidence).toBe("succeeded");
    expect(status.unmappedLocations).toBe(17);
    expect(status.unreviewedChanges).toBe(150);
    expect(status.recentRuns).toEqual([
      expect.objectContaining({ status: "succeeded", employeesReceived: 150, employeesActive: 150, changesRecorded: 150, unmappedLocations: 17, detailsSkipped: 3 }),
    ]);
  });
});
