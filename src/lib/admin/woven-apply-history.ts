import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/server";

import { DISABLE_TERMINATED, envAllowsDisableTerminated } from "./woven-termination";

/**
 * Read-only: the state of the DISABLE_TERMINATED switches and the recent apply
 * history, for Access Preview › Automatic actions. Never returns a name or an
 * email — account ids only.
 */

export interface ApplyHistory {
  envSwitchOn: boolean;
  control: { enabled: boolean; maxPerRun: number; changedBy: string; reason: string | null; updatedAt: string } | null;
  controlChanges: { enabledFrom: boolean | null; enabledTo: boolean; maxPerRunTo: number; changedBy: string; reason: string | null; changedAt: string }[];
  runs: {
    id: string;
    requestedBy: string;
    status: string;
    guardCodes: string[];
    createdAt: string;
    applied: number;
    skipped: number;
    failed: number;
    blocked: number;
  }[];
  operations: { appUserId: string; status: string; triggerSource: string; errorCode: string | null; startedAt: string; finishedAt: string | null }[];
}

const num = (value: unknown) => (typeof value === "number" ? value : 0);
const str = (value: unknown) => (typeof value === "string" ? value : "");

export async function loadApplyHistory(): Promise<ApplyHistory | null> {
  const db = getSupabaseAdmin();
  const [control, changes, runs, operations] = await Promise.all([
    db.from("employee_access_controls").select("enabled, max_per_run, changed_by, reason, updated_at").eq("action", DISABLE_TERMINATED).maybeSingle(),
    db
      .from("employee_access_control_changes")
      .select("enabled_from, enabled_to, max_per_run_to, changed_by, reason, changed_at")
      .eq("action", DISABLE_TERMINATED)
      .order("changed_at", { ascending: false })
      .limit(10),
    db.from("employee_access_runs").select("id, requested_by, status, guard_codes, counts, created_at").eq("mode", "apply").order("created_at", { ascending: false }).limit(10),
    db
      .from("employee_access_operations")
      .select("app_user_id, status, trigger_source, error_code, started_at, finished_at")
      .order("started_at", { ascending: false })
      .limit(20),
  ]);
  /* Before the migration the tables do not exist: there is no history to show. */
  if (control.error || changes.error || runs.error || operations.error) return null;

  const c = control.data as Record<string, unknown> | null;
  return {
    envSwitchOn: envAllowsDisableTerminated(),
    control: c
      ? { enabled: c.enabled === true, maxPerRun: num(c.max_per_run), changedBy: str(c.changed_by), reason: typeof c.reason === "string" ? c.reason : null, updatedAt: str(c.updated_at) }
      : null,
    controlChanges: ((changes.data ?? []) as Record<string, unknown>[]).map((r) => ({
      enabledFrom: typeof r.enabled_from === "boolean" ? r.enabled_from : null,
      enabledTo: r.enabled_to === true,
      maxPerRunTo: num(r.max_per_run_to),
      changedBy: str(r.changed_by),
      reason: typeof r.reason === "string" ? r.reason : null,
      changedAt: str(r.changed_at),
    })),
    runs: ((runs.data ?? []) as Record<string, unknown>[]).map((r) => {
      const apply = ((r.counts as Record<string, unknown> | null)?.apply ?? {}) as Record<string, unknown>;
      return {
        id: str(r.id),
        requestedBy: str(r.requested_by),
        status: str(r.status),
        guardCodes: Array.isArray(r.guard_codes) ? r.guard_codes.map(String) : [],
        createdAt: str(r.created_at),
        applied: num(apply.applied),
        skipped: num(apply.skipped),
        failed: num(apply.failed),
        blocked: num(apply.blocked),
      };
    }),
    operations: ((operations.data ?? []) as Record<string, unknown>[]).map((r) => ({
      appUserId: str(r.app_user_id),
      status: str(r.status),
      triggerSource: str(r.trigger_source),
      errorCode: typeof r.error_code === "string" ? r.error_code : null,
      startedAt: str(r.started_at),
      finishedAt: typeof r.finished_at === "string" ? r.finished_at : null,
    })),
  };
}
