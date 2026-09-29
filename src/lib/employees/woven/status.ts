import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/server";
import { readWovenConfig } from "./config";
import type { OverviewCounts, RunRow } from "./view-types";

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
  /** The last SCHEDULED run that succeeded (`requested_by = 'cron'`). Evidence the schedule works. */
  lastCronSuccessAt: string | null;
  /**
   * What recorded runs prove about signing in to Woven: `succeeded` once any run
   * got past the token exchange and read employees, `failed` when the latest
   * such evidence is a refused sign-in, null when no run says either way.
   */
  signInEvidence: "succeeded" | "failed" | null;
  unmappedLocations: number;
  unreviewedChanges: number;
  recentRuns: WovenSyncRunView[];
}

/**
 * WHY THE STATUS COULD NOT BE READ — kept apart, because "the migration has not
 * been applied" and "the database did not answer" call for different actions
 * and must not be shown as the same thing.
 */
export class WovenStatusError extends Error {
  readonly reason: "missing" | "unavailable";
  readonly code: string | null;
  constructor(reason: "missing" | "unavailable", code: string | null) {
    super(
      reason === "missing"
        ? "The Woven directory tables do not exist in this database yet."
        : `The Woven sync status could not be read${code ? ` (${code})` : ""}.`,
    );
    this.name = "WovenStatusError";
    this.reason = reason;
    this.code = code;
  }
}

/** Postgres `undefined_table`, and PostgREST's "not in the schema cache". */
const MISSING_RELATION_CODES = new Set(["42P01", "PGRST205", "PGRST200"]);

export function classifyStatusError(error: { code?: string | null } | null | undefined): WovenStatusError {
  const code = error?.code ?? null;
  return new WovenStatusError(code !== null && MISSING_RELATION_CODES.has(code) ? "missing" : "unavailable", code);
}

const AUTH_FAILURE_CODES = new Set(["woven_auth_failed", "woven_forbidden"]);

const n = (value: unknown) => (typeof value === "number" ? value : Number(value ?? 0) || 0);

export async function readWovenSyncStatus(): Promise<WovenSyncStatus> {
  const config = readWovenConfig();
  const db = getSupabaseAdmin();

  const [summary, runs, cron, evidence] = await Promise.all([
    db.from("employee_sync_status").select("last_success_at, unmapped_locations, unreviewed_changes").maybeSingle(),
    db
      .from("employee_sync_runs")
      .select(
        "id, status, requested_by, started_at, finished_at, error_code, employees_received, employees_active, employees_terminated, changes_recorded, unmapped_locations, details_skipped",
      )
      .order("started_at", { ascending: false })
      .limit(10),
    db
      .from("employee_sync_runs")
      .select("finished_at")
      .eq("status", "succeeded")
      .eq("requested_by", "cron")
      .order("started_at", { ascending: false })
      .limit(1),
    db
      .from("employee_sync_runs")
      .select("status, error_code")
      .or("status.in.(succeeded,rejected),error_code.in.(woven_auth_failed,woven_forbidden)")
      .order("started_at", { ascending: false })
      .limit(1),
  ]);
  const failure = summary.error ?? runs.error ?? cron.error ?? evidence.error;
  if (failure) throw classifyStatusError(failure);

  const latestEvidence = ((evidence.data ?? []) as Record<string, unknown>[])[0];
  const signInEvidence: WovenSyncStatus["signInEvidence"] = !latestEvidence
    ? null
    : AUTH_FAILURE_CODES.has(String(latestEvidence.error_code))
      ? "failed"
      : "succeeded";
  const cronRow = ((cron.data ?? []) as Record<string, unknown>[])[0];

  const row = (summary.data ?? {}) as Record<string, unknown>;
  return {
    enabled: config.enabled,
    scheduleEnabled: config.scheduleEnabled,
    missingCredentials: config.missingCredentials,
    problems: config.problems,
    lastSuccessAt: typeof row.last_success_at === "string" ? row.last_success_at : null,
    lastCronSuccessAt: typeof cronRow?.finished_at === "string" ? cronRow.finished_at : null,
    signInEvidence,
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

/**
 * THE OVERVIEW'S CARDS — counts and timestamps, never a person.
 *
 * "Since last sync" means the last SUCCESSFUL run: a refused or failed run
 * saved nothing, so it has nothing to report. When that run was the first
 * (every employee new, classified `initial_load`), new hires are reported as
 * an initial load instead, so day one is not mistaken for a hiring wave.
 */
export async function readOverviewCounts(): Promise<OverviewCounts> {
  const db = getSupabaseAdmin();
  const head = { count: "exact" as const, head: true };

  const { data: statusRow, error: statusError } = await db.from("employee_sync_status").select("*").maybeSingle();
  if (statusError) throw classifyStatusError(statusError);
  const s = (statusRow ?? {}) as Record<string, unknown>;
  const lastSuccessRunId = typeof s.last_success_run_id === "string" ? s.last_success_run_id : null;

  const changeCount = (kind: string, extra?: (q: ReturnType<typeof base>) => ReturnType<typeof base>) => {
    let q = base().eq("change_kind", kind);
    if (extra) q = extra(q);
    return q;
  };
  function base() {
    return db.from("employee_directory_changes").select("id", head).eq("sync_run_id", lastSuccessRunId ?? "00000000-0000-0000-0000-000000000000");
  }

  const [newHires, initialLoad, terminations, positionChanges, confirmedMoves, transfers, added, removed, lastRun, recent, withIssues, missingEmail] =
    await Promise.all([
      changeCount("new_employee", (q) => q.eq("classification", "new_hire")),
      changeCount("new_employee", (q) => q.eq("classification", "initial_load")),
      changeCount("terminated"),
      changeCount("position_changed"),
      changeCount("position_changed", (q) => q.in("classification", ["promotion_confirmed", "demotion_confirmed"])),
      changeCount("primary_location_changed", (q) => q.eq("classification", "transfer")),
      changeCount("location_access_added"),
      changeCount("location_access_removed"),
      db.from("employee_sync_run_summary").select("error_count").order("started_at", { ascending: false }).limit(1),
      db.from("employee_sync_run_summary").select("status, employees_fetched").order("started_at", { ascending: false }).limit(14),
      db.from("employee_access_directory").select("id", head).neq("data_issues", "{}"),
      db.from("employee_access_directory").select("id", head).is("email_address", null),
    ]);
  const failed = [newHires, initialLoad, terminations, positionChanges, confirmedMoves, transfers, added, removed, lastRun, recent, withIssues, missingEmail].find(
    (r) => r.error,
  );
  if (failed?.error) throw classifyStatusError(failed.error);

  const c = (r: { count: number | null }) => (lastSuccessRunId ? r.count ?? 0 : 0);
  const initial = c(initialLoad);
  const statusOf = (v: unknown): RunRow["status"] | null =>
    v === "running" || v === "succeeded" || v === "failed" || v === "rejected" ? v : null;

  return {
    lastSuccessAt: typeof s.last_success_at === "string" ? s.last_success_at : null,
    lastAttemptAt: typeof s.last_run_started_at === "string" ? s.last_run_started_at : null,
    lastAttemptStatus: statusOf(s.last_run_status),
    totalActive: n(s.total_active),
    totalTerminated: n(s.total_terminated),
    totalStatusUnknown: n(s.total_status_unknown),
    newHiresSinceLast: initial > 0 ? null : c(newHires),
    initialLoadCount: initial > 0 ? initial : null,
    terminationsSinceLast: c(terminations),
    positionChangesSinceLast: c(positionChanges),
    confirmedPromotionsDemotionsSinceLast: c(confirmedMoves),
    transfersSinceLast: c(transfers),
    locationAccessAddedSinceLast: c(added),
    locationAccessRemovedSinceLast: c(removed),
    lastRunErrorCount: n(((lastRun.data ?? []) as Record<string, unknown>[])[0]?.error_count),
    recordsWithIssues: withIssues.count ?? 0,
    unmappedLocations: n(s.unmapped_locations),
    unmappedPositions: n(s.unmapped_positions),
    employeesMissingEmail: missingEmail.count ?? 0,
    unreviewedChanges: n(s.unreviewed_changes),
    recentRuns: ((recent.data ?? []) as Record<string, unknown>[])
      .map((r) => ({ status: statusOf(r.status) ?? "failed", employeesFetched: n(r.employees_fetched) }))
      .reverse(),
  };
}
