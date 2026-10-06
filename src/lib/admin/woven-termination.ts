import "server-only";

import { plannerAccount } from "@/lib/employees/woven/access/adapters";
import { loadAccessPlan, type AccessPlan } from "@/lib/employees/woven/access/load";
import { isProtectedAccount } from "@/lib/employees/woven/access/managed-policy";
import type { PlannedRow } from "@/lib/employees/woven/access/types";
import { getSupabaseAdmin } from "@/lib/supabase/server";

import { DirectoryError, patchUser, type DirectoryActor } from "./user-directory";

/**
 * ============================================================================
 * DISABLE_TERMINATED — automatic Woven termination enforcement
 * ============================================================================
 *
 * The ONE apply action that exists. When Woven explicitly reports a linked,
 * status-managed, unprotected employee as Terminated, their Ask Sunny access
 * is revoked through the existing hardened path (`patchUser`, status
 * disabled): the profile is disabled, the Supabase Auth user is banned, and
 * every session and refresh token is revoked. Forgot Password stays blocked
 * (disabled accounts get no email). Nothing is deleted — the auth user, the
 * profile, forms, chats, reports and history all remain.
 *
 * TWO KEYS, BOTH OFF BY DEFAULT, for the scheduled run:
 *   1. `WOVEN_APPLY_ACTIONS` must list DISABLE_TERMINATED (Vercel environment,
 *      takes a redeploy), and
 *   2. `employee_access_controls.enabled` for DISABLE_TERMINATED must be true
 *      (owner-only, in the SQL editor; every change is logged).
 * Turning either off stops it at the next run.
 *
 * EVERY CONDITION IS CHECKED TWICE. The planner proposes DISABLE_TERMINATED
 * only for a linked account with status managed, not protected, whose Woven
 * status is Terminated in the LATEST read; the guards block every mutation on
 * a stale, failed or unresolved read, a failed terminated-status read, or a
 * mass change. Immediately before acting, each account is then re-read from
 * the database and must still be: linked to that EmployeeID with status
 * managed and not yet revoked; not protected (administrative role or
 * override); and Terminated in the directory row seen by the latest successful
 * run (miss count 0). Anything else is skipped and recorded.
 *
 * ONE ATTEMPT AT A TIME, EXACTLY ONCE. Each account is claimed in
 * `employee_access_operations` (one open attempt per account); a concurrent
 * run is skipped. Once applied, the link records the revocation and the
 * planner reports "access already revoked", so a repeated run does nothing. A
 * half-finished attempt is completed by the next run (both steps are
 * idempotent).
 *
 * Every run is recorded in `employee_access_runs` (mode apply) with each
 * account's result: applied, skipped, failed or blocked.
 */

export const DISABLE_TERMINATED = "DISABLE_TERMINATED";
export const APPLY_ACTIONS_ENV = "WOVEN_APPLY_ACTIONS";
/** Woven EmployeeIDs are UUIDs; this prefix can only be a disposable test employee. */
export const TEST_EMPLOYEE_PREFIX = "ASK-SUNNY-TEST-";
export const APPLY_REQUESTER = { cron: "cron:apply", test: "admin:test-termination" } as const;

/** The audit actor for automatic revocation: no Ask Sunny account of its own. */
export const WOVEN_TERMINATION_ACTOR: DirectoryActor = {
  id: null,
  email: "woven-sync: automatic termination (DISABLE_TERMINATED)",
  role: "admin",
};

export type ApplyResult = "applied" | "skipped" | "failed" | "blocked";

export interface ApplyActionRecord {
  external_employee_id: string | null;
  app_user_id: string | null;
  action: typeof DISABLE_TERMINATED;
  reason_codes: string[];
  before_values: Record<string, unknown> | null;
  after_values: Record<string, unknown> | null;
  woven_source_at: string | null;
  result: ApplyResult;
}

export type ApplyOutcome =
  | { status: "off"; reason: "env_switch_off" | "control_off" | "control_missing" }
  | { status: "blocked"; accessRunId: string | null; guardCodes: string[]; proposed: number }
  | { status: "completed"; accessRunId: string | null; applied: number; skipped: number; failed: number }
  | { status: "failed"; code: string };

export type ApplyRequest = { source: "cron" } | { source: "test"; appUserId: string };

/** Key 1: the deployment allows this action. */
export function envAllowsDisableTerminated(env: Record<string, string | undefined> = process.env): boolean {
  return (env[APPLY_ACTIONS_ENV] ?? "")
    .split(",")
    .map((value) => value.trim().toUpperCase())
    .includes(DISABLE_TERMINATED);
}

/** Key 2: the owner's switch in the database. */
export async function readDisableTerminatedControl(): Promise<{ enabled: boolean; maxPerRun: number } | null> {
  const { data, error } = await getSupabaseAdmin()
    .from("employee_access_controls")
    .select("enabled, max_per_run")
    .eq("action", DISABLE_TERMINATED)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as { enabled?: unknown; max_per_run?: unknown };
  return { enabled: row.enabled === true, maxPerRun: Number(row.max_per_run) || 0 };
}

function record(row: PlannedRow, result: ApplyResult, reasons: string[], extra?: Record<string, unknown>): ApplyActionRecord {
  return {
    external_employee_id: row.externalEmployeeId,
    app_user_id: row.appUserId,
    action: DISABLE_TERMINATED,
    reason_codes: [...row.reasons, ...reasons],
    before_values: row.before,
    after_values: extra ? { ...(row.after ?? {}), ...extra } : row.after,
    woven_source_at: row.wovenSourceAt,
    result,
  };
}

/**
 * Re-reads one account, its link and its Woven directory row, and says why it
 * must NOT be revoked — or null when every condition still holds.
 */
export async function verifyStillTerminated(row: PlannedRow, latestRunId: string | null): Promise<string | null> {
  const db = getSupabaseAdmin();
  if (!row.appUserId || !row.externalEmployeeId) return "not_linked";
  if (!latestRunId) return "no_successful_directory_run";

  const { data: accountRow, error: accountError } = await db
    .from("employee_access_accounts")
    .select("*")
    .eq("app_user_id", row.appUserId)
    .maybeSingle();
  if (accountError) return "account_unreadable";
  const account = accountRow ? plannerAccount(accountRow as Record<string, unknown>) : null;
  if (!account) return "account_not_found";
  if (account.management !== "woven_linked" || account.linkedExternalEmployeeId !== row.externalEmployeeId) return "not_linked_to_this_employee";
  if (!account.managedStatus) return "status_not_woven_managed";
  if (isProtectedAccount(account)) return "protected_account";
  if (account.accessRevokedAt) return "access_already_revoked";

  const { data: employee, error: employeeError } = await db
    .from("employee_access_directory")
    .select("employment_status, missing_sync_count, last_seen_run_id")
    .eq("source_system", "woven")
    .eq("external_employee_id", row.externalEmployeeId)
    .maybeSingle();
  if (employeeError) return "directory_unreadable";
  if (!employee) return "employee_not_in_directory";
  const e = employee as { employment_status?: unknown; missing_sync_count?: unknown; last_seen_run_id?: unknown };
  if (e.employment_status !== "terminated") return "not_terminated_in_woven";
  if (Number(e.missing_sync_count) !== 0 || e.last_seen_run_id !== latestRunId) return "not_read_in_latest_run";
  return null;
}

async function recordRun(plan: AccessPlan, source: ApplyRequest["source"], guardCodes: string[], actions: ApplyActionRecord[]) {
  const tally = { applied: 0, skipped: 0, failed: 0, blocked: 0 };
  for (const action of actions) tally[action.result] += 1;
  const { data, error } = await getSupabaseAdmin().rpc("employee_access_record_apply_run", {
    p_requested_by: APPLY_REQUESTER[source],
    p_directory_run_id: plan.directoryRunId,
    p_policy_version: plan.policyVersion,
    p_guard_codes: guardCodes,
    p_counts: { apply: { action: DISABLE_TERMINATED, source, ...tally }, guard: plan.guard.details, mappings: plan.mappings },
    p_actions: actions,
  });
  return error || typeof data !== "string" ? null : data;
}

async function disableOne(row: PlannedRow, source: ApplyRequest["source"], latestRunId: string | null): Promise<ApplyActionRecord> {
  const db = getSupabaseAdmin();

  const refusal = await verifyStillTerminated(row, latestRunId);
  if (refusal) return record(row, "skipped", [refusal]);

  const claim = await db.rpc("employee_access_claim_operation", {
    p_action: DISABLE_TERMINATED,
    p_app_user_id: row.appUserId,
    p_external_employee_id: row.externalEmployeeId,
    p_trigger_source: source,
  });
  if (claim.error) return record(row, "failed", ["operation_not_claimed"]);
  const operationId = typeof claim.data === "string" ? claim.data : null;
  if (!operationId) return record(row, "skipped", ["operation_in_progress"]);

  const steps: Record<string, boolean> = { profile_disabled: false, auth_revoked: false, link_recorded: false };
  const finish = async (status: "applied" | "skipped" | "failed", code: string | null, detail: string | null) => {
    await db.rpc("employee_access_finish_operation", {
      p_id: operationId,
      p_status: status,
      p_steps: steps,
      p_error_code: code,
      p_error_detail: detail,
    });
  };

  /*
   * RE-CHECK WHILE HOLDING THE CLAIM. Another run may have finished this very
   * account between our first check and our claim; it must not be revoked
   * twice.
   */
  const refusedNow = await verifyStillTerminated(row, latestRunId);
  if (refusedNow) {
    await finish("skipped", refusedNow, null);
    return record(row, "skipped", [refusedNow]);
  }

  /* 1–3. The hardened path: profile disabled, Supabase Auth ban, sessions and refresh tokens revoked, audited. */
  try {
    await patchUser(row.appUserId!, { status: "disabled" }, WOVEN_TERMINATION_ACTOR);
    steps.profile_disabled = true;
    steps.auth_revoked = true;
  } catch (error) {
    const code = error instanceof DirectoryError ? error.code : "unexpected";
    /* `auth_revocation_incomplete` means the profile IS disabled; the next run completes the auth layer. */
    steps.profile_disabled = code === "auth_revocation_incomplete";
    await finish("failed", code, error instanceof Error ? error.message : null);
    return record(row, "failed", [`revocation_${code}`]);
  }

  /* 4. The link records the revocation (write-once). */
  const revokedAt = new Date().toISOString();
  const terminatedOn = typeof row.after?.terminated_on === "string" ? row.after.terminated_on : null;
  const { data: linked, error: linkError } = await db
    .from("employee_account_links")
    .update({ terminated_at: terminatedOn ?? revokedAt, access_revoked_at: revokedAt, revoked_woven_status: "terminated" })
    .eq("app_user_id", row.appUserId!)
    .eq("management", "woven_linked")
    .is("access_revoked_at", null)
    .select("app_user_id");
  if (linkError || !Array.isArray(linked) || linked.length !== 1) {
    await finish("failed", "link_not_recorded", linkError?.message ?? null);
    return record(row, "failed", ["link_not_recorded"], { access_revoked_at: null });
  }
  steps.link_recorded = true;

  await finish("applied", null, null);
  return record(row, "applied", [], { access_revoked_at: revokedAt });
}

/**
 * Runs DISABLE_TERMINATED once. The scheduled run (`source: "cron"`) needs both
 * keys; a test run (`source: "test"`) acts only on ONE account whose Woven
 * EmployeeID carries the disposable-test prefix, and does not need the keys.
 * Never throws: every failure is a recorded result.
 */
export async function applyDisableTerminated(request: ApplyRequest, now: Date = new Date()): Promise<ApplyOutcome> {
  try {
    let maxPerRun = Number.POSITIVE_INFINITY;
    if (request.source === "cron") {
      if (!envAllowsDisableTerminated()) return { status: "off", reason: "env_switch_off" };
      const control = await readDisableTerminatedControl();
      if (!control) return { status: "off", reason: "control_missing" };
      if (!control.enabled) return { status: "off", reason: "control_off" };
      maxPerRun = control.maxPerRun;
    }

    const plan = await loadAccessPlan(now);
    let proposed = plan.rows.filter((row) => row.actions.includes("DISABLE_TERMINATED") && row.appUserId && row.externalEmployeeId);

    if (request.source === "test") {
      proposed = proposed.filter((row) => row.appUserId === request.appUserId);
      if (proposed.some((row) => !row.externalEmployeeId!.startsWith(TEST_EMPLOYEE_PREFIX))) {
        return { status: "failed", code: "not_a_test_employee" };
      }
    }

    const guardCodes: string[] = [...plan.guard.codes];
    if (request.source === "cron" && proposed.length > maxPerRun) guardCodes.push("apply_batch_limit_exceeded");
    if (guardCodes.length > 0) {
      const accessRunId = await recordRun(plan, request.source, guardCodes, proposed.map((row) => record(row, "blocked", ["guard_blocked", ...guardCodes])));
      return { status: "blocked", accessRunId, guardCodes, proposed: proposed.length };
    }

    const actions: ApplyActionRecord[] = [];
    for (const row of proposed) actions.push(await disableOne(row, request.source, plan.directoryRunId));

    const accessRunId = await recordRun(plan, request.source, [], actions);
    return {
      status: "completed",
      accessRunId,
      applied: actions.filter((a) => a.result === "applied").length,
      skipped: actions.filter((a) => a.result === "skipped").length,
      failed: actions.filter((a) => a.result === "failed").length,
    };
  } catch {
    return { status: "failed", code: "apply_failed" };
  }
}

/**
 * The disposable-test entry point. Refuses any account whose Woven link is not
 * a test employee, BEFORE anything is planned or touched.
 */
export async function applyDisableTerminatedForTestAccount(appUserId: string, now: Date = new Date()): Promise<ApplyOutcome> {
  const { data, error } = await getSupabaseAdmin()
    .from("employee_account_links")
    .select("external_employee_id, management")
    .eq("app_user_id", appUserId)
    .maybeSingle();
  if (error) throw new DirectoryError("provider_failed", "The account's Woven link could not be read.", 502);
  const link = data as { external_employee_id?: unknown; management?: unknown } | null;
  if (!link || link.management !== "woven_linked" || typeof link.external_employee_id !== "string" || !link.external_employee_id.startsWith(TEST_EMPLOYEE_PREFIX)) {
    throw new DirectoryError(
      "invalid_input",
      `Only an account linked to a disposable test employee (EmployeeID starting ${TEST_EMPLOYEE_PREFIX}) can be used for a test run.`,
      400,
    );
  }
  return applyDisableTerminated({ source: "test", appUserId }, now);
}
