import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/server";
import { readWovenConfig } from "./config";
import { EmployeeStoreError } from "./store";

/**
 * What an administrator sees about the Woven sync: whether it is switched on,
 * which variables are missing (by NAME), the last run and the last SUCCESSFUL
 * run, and recent runs' codes and counts.
 *
 * NO PERSON APPEARS HERE. Run rows carry counts and error codes only, so this
 * is safe to render on an admin screen or read in a log.
 */

export interface WovenSyncRunView {
  id: string;
  status: string;
  requestedBy: string;
  startedAt: string;
  finishedAt: string | null;
  errorCode: string | null;
  employeesReceived: number;
  employeesActive: number;
  employeesTerminated: number;
  changesRecorded: number;
  unmappedLocations: number;
  detailsSkipped: number;
}

export interface WovenSyncStatus {
  enabled: boolean;
  scheduleEnabled: boolean;
  missingCredentials: string[];
  problems: string[];
  lastSuccessAt: string | null;
  unmappedLocations: number;
  unreviewedChanges: number;
  recentRuns: WovenSyncRunView[];
}

const n = (value: unknown) => (typeof value === "number" ? value : Number(value ?? 0) || 0);

export async function readWovenSyncStatus(): Promise<WovenSyncStatus> {
  const config = readWovenConfig();
  const db = getSupabaseAdmin();

  const [summary, runs] = await Promise.all([
    db.from("employee_sync_status").select("last_success_at, unmapped_locations, unreviewed_changes").maybeSingle(),
    db
      .from("employee_sync_runs")
      .select(
        "id, status, requested_by, started_at, finished_at, error_code, employees_received, employees_active, employees_terminated, changes_recorded, unmapped_locations, details_skipped",
      )
      .order("started_at", { ascending: false })
      .limit(10),
  ]);
  if (summary.error || runs.error) {
    throw new EmployeeStoreError(
      "store_unavailable",
      "The Woven sync status could not be read. The directory migration may not be applied yet.",
    );
  }

  const row = (summary.data ?? {}) as Record<string, unknown>;
  return {
    enabled: config.enabled,
    scheduleEnabled: config.scheduleEnabled,
    missingCredentials: config.missingCredentials,
    problems: config.problems,
    lastSuccessAt: typeof row.last_success_at === "string" ? row.last_success_at : null,
    unmappedLocations: n(row.unmapped_locations),
    unreviewedChanges: n(row.unreviewed_changes),
    recentRuns: ((runs.data ?? []) as Record<string, unknown>[]).map((r) => ({
      id: String(r.id),
      status: String(r.status),
      requestedBy: String(r.requested_by),
      startedAt: String(r.started_at),
      finishedAt: typeof r.finished_at === "string" ? r.finished_at : null,
      errorCode: typeof r.error_code === "string" ? r.error_code : null,
      employeesReceived: n(r.employees_received),
      employeesActive: n(r.employees_active),
      employeesTerminated: n(r.employees_terminated),
      changesRecorded: n(r.changes_recorded),
      unmappedLocations: n(r.unmapped_locations),
      detailsSkipped: n(r.details_skipped),
    })),
  };
}
