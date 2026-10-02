import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/server";

import { readWovenAccessMode } from "./config";
import { loadAccessPlan, type AccessPlan } from "./load";

/**
 * ============================================================================
 * SHADOW MODE — record what the access sync WOULD do, apply nothing
 * ============================================================================
 *
 * Only while `WOVEN_ACCESS_MODE=shadow`. Plans from the database, then writes
 * ONE run and its actions through `employee_access_record_shadow_run`, in one
 * transaction. That function writes `employee_access_runs` and
 * `employee_access_actions` and nothing else; it cannot create an account,
 * send an invite, revoke access or change a salon or role. There is no apply
 * path anywhere in the code.
 *
 * A run whose guards trip is still recorded — as `aborted`, with the codes —
 * because "the guards would have stopped this" is exactly what shadow mode is
 * for.
 */

export type ShadowOutcome =
  | { status: "off" }
  | { status: "recorded"; accessRunId: string; aborted: boolean; actions: number }
  | { status: "failed"; code: string };

export function shadowPayload(plan: AccessPlan) {
  return plan.rows.flatMap((row) =>
    row.actions.map((action, index) => ({
      external_employee_id: row.externalEmployeeId,
      app_user_id: row.appUserId,
      action,
      is_primary: index === 0,
      reason_codes: row.reasons,
      before_values: index === 0 ? row.before : null,
      after_values: index === 0 ? row.after : null,
      woven_source_at: row.wovenSourceAt,
    })),
  );
}

export async function recordAccessShadowRun(requestedBy: string, now: Date = new Date()): Promise<ShadowOutcome> {
  if (readWovenAccessMode().mode !== "shadow") return { status: "off" };
  try {
    const plan = await loadAccessPlan(now);
    const actions = shadowPayload(plan);
    const { data, error } = await getSupabaseAdmin().rpc("employee_access_record_shadow_run", {
      p_requested_by: requestedBy,
      p_directory_run_id: plan.directoryRunId,
      p_policy_version: plan.policyVersion,
      p_guard_codes: plan.guard.codes,
      p_counts: { actions: plan.counts, guard: plan.guard.details, mappings: plan.mappings },
      p_actions: actions,
    });
    if (error || typeof data !== "string") return { status: "failed", code: "record_failed" };
    return { status: "recorded", accessRunId: data, aborted: !plan.guard.mutationsAllowed, actions: actions.length };
  } catch {
    return { status: "failed", code: "plan_failed" };
  }
}
