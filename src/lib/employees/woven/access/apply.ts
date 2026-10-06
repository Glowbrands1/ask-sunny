import { MAX_AUTOMATIC_INVITE_ATTEMPTS } from "./lifecycle";
import type { AccessPlan } from "./build";
import type { WovenAccessConfig } from "./config";
import { isLifecycleAction, isMutating, type AccessAction, type LifecycleAction, type PlannedRow } from "./types";

/**
 * ============================================================================
 * THE ACCOUNT LIFECYCLE, APPLIED — create + invite, link, revoke on Terminated
 * ============================================================================
 *
 * Runs only in `WOVEN_ACCESS_MODE=apply`, and then only the capabilities named
 * in WOVEN_ACCESS_APPLY_ACTIONS, only for the EmployeeIDs in
 * WOVEN_ACCESS_APPLY_EMPLOYEE_IDS while that is set (`config.ts`).
 *
 * THE ORDER OF EVERY RUN
 *
 *   1. Take the run lock (`employee_access_begin_apply_run`): one apply run at
 *      a time, enforced by a unique index. A second run gets `busy`.
 *   2. Plan from the database AFTER the lock, so the plan is the current one.
 *   3. Guards. One tripped guard and the run applies NOTHING: it is recorded as
 *      `aborted`, every would-be mutation as `skipped`.
 *   4. Each row's primary action, if it is a lifecycle action that is enabled
 *      and in the batch, is applied. Each database step re-checks its own
 *      facts under row locks (the migration's functions) and refuses with a
 *      named code if anything moved since the plan.
 *   5. Provisioned accounts whose invitation failed are retried, at most
 *      MAX_AUTOMATIC_INVITE_ATTEMPTS times in total; then a person is asked.
 *   6. Every row is recorded (`employee_access_actions`): applied, failed,
 *      skipped or planned, with a result code. The run is closed.
 *
 * WHAT IT NEVER DOES
 *   - UPDATE_ROLE or UPDATE_PRIMARY_LOCATION: recorded `skipped`,
 *     `not_a_lifecycle_action`, whatever the configuration says;
 *   - set, read, store or email a password — the auth user is created with
 *     none, and Supabase emails the invitation link directly to the person;
 *   - delete anything: an interrupted CREATE_USER leaves an unconfirmed,
 *     password-less auth user carrying the EmployeeID in app_metadata, which
 *     the next run finds and resumes;
 *   - re-enable anybody (a rehire is FLAG_REHIRE_REVIEW in the plan).
 *
 * Pure orchestration: every effect goes through `ApplyDeps`, so the unit tests
 * drive it with fakes and the local-stack test with the real services.
 */

export interface RpcResult {
  data: unknown;
  error: { message?: string; code?: string } | null;
}

export interface ApplyDeps {
  loadPlan(now: Date): Promise<AccessPlan>;
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<RpcResult>;
  auth: {
    createUser(attributes: {
      email: string;
      email_confirm: false;
      app_metadata: { provisioned_by: "woven"; external_employee_id: string };
    }): Promise<{ data: { user: { id: string } | null } | null; error: { message?: string; code?: string; status?: number } | null }>;
    inviteUserByEmail(
      email: string,
      options: { redirectTo: string },
    ): Promise<{ data: unknown; error: { message?: string; code?: string; status?: number } | null }>;
    getUserById(id: string): Promise<{
      data: { user: { email_confirmed_at?: string | null; banned_until?: string | null } | null } | null;
      error: unknown;
    }>;
  };
  revokeAuthAccess(userId: string): Promise<{ ok: boolean; failed: string[] }>;
}

export interface ApplyRequest {
  requestedBy: string;
  /** Where the invitation link lands (`<site>/auth/accept`). Without it, no invitation is sent. */
  redirectTo: string | null;
  config: WovenAccessConfig;
  now?: Date;
}

export type ActionResult = "applied" | "failed" | "skipped" | "planned";

export interface ApplyTally {
  applied: Partial<Record<LifecycleAction | "INVITE_RETRY", number>>;
  failed: Partial<Record<LifecycleAction | "INVITE_RETRY", number>>;
  skipped: number;
}

export type ApplyOutcome =
  | { status: "off" }
  | { status: "busy" }
  | { status: "aborted"; accessRunId: string; guardCodes: string[] }
  | { status: "completed"; accessRunId: string; tally: ApplyTally }
  | { status: "failed"; code: string; accessRunId: string | null };

interface RecordedAction {
  external_employee_id: string | null;
  app_user_id: string | null;
  action: AccessAction;
  is_primary: boolean;
  reason_codes: string[];
  before_values: PlannedRow["before"];
  after_values: PlannedRow["after"];
  woven_source_at: string | null;
  result: ActionResult;
  result_code: string | null;
}

const SAFE_CODE = /^[a-z0-9_.:-]{1,80}$/;
/** The database functions raise their own short codes; anything else is not passed on. */
export function refusalCode(error: { message?: string; code?: string } | null | undefined, fallback: string): string {
  const message = (error?.message ?? "").trim();
  return SAFE_CODE.test(message) ? message : fallback;
}

function isRateLimit(error: { code?: string; status?: number } | null | undefined): boolean {
  return error?.code === "over_email_send_rate_limit" || error?.status === 429;
}

function recordRow(row: PlannedRow, primary: { result: ActionResult; code: string | null }, appUserId: string | null = row.appUserId): RecordedAction[] {
  return row.actions.map((action, index) => ({
    external_employee_id: row.externalEmployeeId,
    app_user_id: appUserId,
    action,
    is_primary: index === 0,
    reason_codes: row.reasons,
    before_values: index === 0 ? row.before : null,
    after_values: index === 0 ? row.after : null,
    woven_source_at: row.wovenSourceAt,
    result: index === 0 ? primary.result : "planned",
    result_code: index === 0 ? primary.code : null,
  }));
}

export async function applyAccessLifecycle(request: ApplyRequest, deps: ApplyDeps): Promise<ApplyOutcome> {
  const { config } = request;
  if (config.mode !== "apply") return { status: "off" };
  const now = request.now ?? new Date();
  const setBy = `woven-access-sync:${request.requestedBy}`.slice(0, 120);

  /* 1. the lock */
  let probe: AccessPlan;
  try {
    probe = await deps.loadPlan(now);
  } catch {
    return { status: "failed", code: "plan_failed", accessRunId: null };
  }
  const begun = await deps.rpc("employee_access_begin_apply_run", {
    p_requested_by: request.requestedBy,
    p_directory_run_id: probe.directoryRunId,
    p_policy_version: probe.policyVersion,
  });
  if (begun.error) {
    return (begun.error.message ?? "").includes("employee_access_apply_in_progress") || begun.error.code === "55P03"
      ? { status: "busy" }
      : { status: "failed", code: "begin_failed", accessRunId: null };
  }
  const runId = String(begun.data);

  const recorded: RecordedAction[] = [];
  const tally: ApplyTally = { applied: {}, failed: {}, skipped: 0 };
  const bump = (bucket: "applied" | "failed", key: LifecycleAction | "INVITE_RETRY") => (tally[bucket][key] = (tally[bucket][key] ?? 0) + 1);
  const flush = async () => {
    if (recorded.length === 0) return;
    const batch = recorded.splice(0, recorded.length);
    const { error } = await deps.rpc("employee_access_record_apply_actions", { p_run: runId, p_actions: batch });
    if (error) throw new Error("record_failed");
  };

  try {
    /* 2. the plan, after the lock */
    const plan = await deps.loadPlan(now);
    const enabled = new Set<string>(config.applyActions);
    const inBatch = (row: PlannedRow) => config.employeeAllowlist === null || (row.externalEmployeeId !== null && config.employeeAllowlist.includes(row.externalEmployeeId));
    const rows = [...plan.rows].sort((a, b) => a.key.localeCompare(b.key));

    /* 3. the guards */
    if (!plan.guard.mutationsAllowed) {
      for (const row of rows) {
        const primary = row.actions[0]!;
        recorded.push(...recordRow(row, isMutating(primary) ? { result: "skipped", code: "guard_blocked" } : { result: "planned", code: null }));
      }
      await flush();
      await deps.rpc("employee_access_finish_apply_run", {
        p_run: runId,
        p_status: "aborted",
        p_guard_codes: plan.guard.codes,
        p_counts: { actions: plan.counts, guard: plan.guard.details, mappings: plan.mappings },
      });
      return { status: "aborted", accessRunId: runId, guardCodes: plan.guard.codes };
    }

    /* 4. the lifecycle */
    for (const row of rows) {
      const primary = row.actions[0]!;
      if (!isMutating(primary)) {
        recorded.push(...recordRow(row, { result: "planned", code: null }));
        continue;
      }
      if (!isLifecycleAction(primary)) {
        /* UPDATE_ROLE / UPDATE_PRIMARY_LOCATION: preview only, never applied. */
        tally.skipped += 1;
        recorded.push(...recordRow(row, { result: "skipped", code: "not_a_lifecycle_action" }));
        continue;
      }
      if (!enabled.has(primary)) {
        tally.skipped += 1;
        recorded.push(...recordRow(row, { result: "skipped", code: "capability_off" }));
        continue;
      }
      if (!inBatch(row)) {
        tally.skipped += 1;
        recorded.push(...recordRow(row, { result: "skipped", code: "not_in_approved_batch" }));
        continue;
      }

      const outcome =
        primary === "CREATE_USER"
          ? await createUser(row, request, deps, setBy)
          : primary === "LINK_EXISTING"
            ? await linkExisting(row, deps, setBy)
            : await disableTerminated(row, deps, setBy);
      bump(outcome.result === "applied" ? "applied" : "failed", primary);
      recorded.push(...recordRow(row, { result: outcome.result, code: outcome.code }, outcome.appUserId ?? row.appUserId));
      /* Recorded at once, so a run that dies later still shows what it did. */
      await flush();
    }

    /* 5. invitations that did not go out */
    if (enabled.has("CREATE_USER")) {
      for (const row of rows) {
        const account = row.account;
        const invite = account?.invite;
        if (
          account?.via !== "link" ||
          account.linkMethod !== "provisioned" ||
          account.status !== "invited" ||
          !invite ||
          invite.status === "sent" ||
          invite.attempts >= MAX_AUTOMATIC_INVITE_ATTEMPTS ||
          row.wovenStatus !== "active" ||
          !inBatch(row)
        ) {
          continue;
        }
        const sent = await sendInvite(account.appUserId, account.email, request.redirectTo, deps, setBy);
        bump(sent.ok ? "applied" : "failed", "INVITE_RETRY");
        recorded.push({
          external_employee_id: row.externalEmployeeId,
          app_user_id: account.appUserId,
          action: "CREATE_USER",
          is_primary: false,
          reason_codes: ["invite_retry"],
          before_values: { invite: invite.status },
          after_values: { invite: sent.ok ? "sent" : "failed" },
          woven_source_at: row.wovenSourceAt,
          result: sent.ok ? "applied" : "failed",
          result_code: sent.ok ? "invite_sent" : `invite_failed.${sent.code}`.slice(0, 80),
        });
      }
    }

    /* 6. the record */
    await flush();
    await deps.rpc("employee_access_finish_apply_run", {
      p_run: runId,
      p_status: "completed",
      p_guard_codes: [],
      p_counts: { actions: plan.counts, guard: plan.guard.details, mappings: plan.mappings, tally },
    });
    return { status: "completed", accessRunId: runId, tally };
  } catch {
    await flush().catch(() => undefined);
    await Promise.resolve(
      deps.rpc("employee_access_finish_apply_run", { p_run: runId, p_status: "failed", p_guard_codes: [], p_counts: { tally } }),
    ).catch(() => undefined);
    return { status: "failed", code: "apply_interrupted", accessRunId: runId };
  }
}

/* ---------------------------------------------------------- CREATE_USER -- */

interface StepOutcome {
  result: "applied" | "failed";
  code: string;
  appUserId?: string | null;
}

async function findAuthUser(email: string, deps: ApplyDeps) {
  const { data, error } = await deps.rpc("employee_access_auth_user_by_email", { p_email: email });
  if (error) return { error: true as const };
  const rows = (Array.isArray(data) ? data : []) as {
    id: string;
    email_confirmed: boolean;
    provisioned_external_employee_id: string | null;
    has_profile: boolean;
    banned: boolean;
  }[];
  return { error: false as const, user: rows[0] ?? null };
}

/**
 * The auth user for this employee: an existing one ONLY if this lifecycle
 * created it for this same EmployeeID (app_metadata, which only the service key
 * writes) and it was never confirmed; otherwise a new one, with no password.
 */
async function authUserFor(email: string, externalEmployeeId: string, deps: ApplyDeps): Promise<{ id: string } | { code: string }> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const found = await findAuthUser(email, deps);
    if (found.error) return { code: "auth_lookup_failed" };
    if (found.user) {
      if (found.user.provisioned_external_employee_id !== externalEmployeeId) return { code: "auth_user_exists_for_another_identity" };
      if (found.user.email_confirmed) return { code: "auth_user_already_confirmed" };
      if (found.user.banned) return { code: "auth_user_banned" };
      return { id: found.user.id };
    }
    const created = await deps.auth.createUser({
      email,
      email_confirm: false,
      app_metadata: { provisioned_by: "woven", external_employee_id: externalEmployeeId },
    });
    if (!created.error && created.data?.user?.id) return { id: created.data.user.id };
    /* Somebody created it a moment ago (a concurrent attempt): look again and resume it, or refuse. */
    if (created.error?.code !== "email_exists" && created.error?.status !== 422) return { code: "auth_create_failed" };
  }
  return { code: "auth_create_conflict" };
}

async function createUser(row: PlannedRow, request: ApplyRequest, deps: ApplyDeps, setBy: string): Promise<StepOutcome> {
  const after = row.after ?? {};
  const email = typeof after.email === "string" ? after.email : null;
  const role = typeof after.role === "string" ? after.role : null;
  const area = typeof after.scope_primary_area_id === "string" ? after.scope_primary_area_id : null;
  if (!row.externalEmployeeId || !email || !role || !area) return { result: "failed", code: "create_input_incomplete" };

  const auth = await authUserFor(email, row.externalEmployeeId, deps);
  if ("code" in auth) return { result: "failed", code: auth.code };

  const provisioned = await deps.rpc("employee_access_provision_account", {
    p_app_user_id: auth.id,
    p_external_employee_id: row.externalEmployeeId,
    p_email: email,
    p_display_name: typeof after.display_name === "string" ? after.display_name : email,
    p_role: role,
    p_primary_area_id: area,
    p_set_by: setBy,
  });
  if (provisioned.error) {
    /* Nothing is deleted. The password-less, unconfirmed auth user is resumed by the next run once the refusal clears. */
    return { result: "failed", code: refusalCode(provisioned.error, "provision_refused"), appUserId: null };
  }

  const sent = await sendInvite(auth.id, email, request.redirectTo, deps, setBy);
  return {
    result: "applied",
    code: `${provisioned.data === "already_provisioned" ? "resumed" : "created"}.${sent.ok ? "invite_sent" : `invite_failed.${sent.code}`}`.slice(0, 80),
    appUserId: auth.id,
  };
}

/**
 * Supabase sends the invitation to the address on the auth user — the Woven
 * email — and the link lets the person choose their own password. The link
 * never passes through this process. A confirmed or banned credential is not
 * invited.
 */
async function sendInvite(
  appUserId: string,
  email: string,
  redirectTo: string | null,
  deps: ApplyDeps,
  setBy: string,
): Promise<{ ok: boolean; code: string }> {
  let code: string | null = null;
  if (!redirectTo) {
    code = "redirect_not_configured";
  } else {
    const credential = await deps.auth.getUserById(appUserId);
    const user = credential.data?.user ?? null;
    if (credential.error || !user) code = "auth_lookup_failed";
    else if (user.email_confirmed_at) code = "already_confirmed";
    else if (user.banned_until && Date.parse(user.banned_until) > Date.now()) code = "auth_user_banned";
    else {
      const invited = await deps.auth.inviteUserByEmail(email, { redirectTo });
      if (invited.error) code = isRateLimit(invited.error) ? "email_rate_limited" : "provider_error";
    }
  }
  await deps.rpc("employee_access_record_invite", {
    p_app_user_id: appUserId,
    p_outcome: code ? "failed" : "sent",
    p_error_code: code,
    p_set_by: setBy,
  });
  return code ? { ok: false, code } : { ok: true, code: "sent" };
}

/* -------------------------------------------------------- LINK_EXISTING -- */

async function linkExisting(row: PlannedRow, deps: ApplyDeps, setBy: string): Promise<StepOutcome> {
  if (!row.account || !row.externalEmployeeId) return { result: "failed", code: "link_input_incomplete" };
  const { data, error } = await deps.rpc("employee_access_link_existing", {
    p_app_user_id: row.account.appUserId,
    p_external_employee_id: row.externalEmployeeId,
    p_set_by: setBy,
  });
  if (error) return { result: "failed", code: refusalCode(error, "link_refused"), appUserId: row.account.appUserId };
  return { result: "applied", code: String(data), appUserId: row.account.appUserId };
}

/* --------------------------------------------------- DISABLE_TERMINATED -- */

/**
 * Profile first (disabled, inside a transaction that re-checks Woven's
 * Terminated status), then the authentication layer (ban + every session and
 * refresh token), then the record. A partial failure leaves the account
 * disabled and the link without `access_revoked_at`, so the next run proposes
 * DISABLE_TERMINATED again and completes it; every step is idempotent.
 */
async function disableTerminated(row: PlannedRow, deps: ApplyDeps, setBy: string): Promise<StepOutcome> {
  const appUserId = row.account?.appUserId ?? null;
  if (!appUserId || !row.externalEmployeeId) return { result: "failed", code: "disable_input_incomplete" };
  const disabled = await deps.rpc("employee_access_disable_terminated", {
    p_app_user_id: appUserId,
    p_external_employee_id: row.externalEmployeeId,
    p_set_by: setBy,
  });
  if (disabled.error) return { result: "failed", code: refusalCode(disabled.error, "disable_refused"), appUserId };

  const revoked = await deps.revokeAuthAccess(appUserId);
  const recorded = await deps.rpc("employee_access_record_revocation", {
    p_app_user_id: appUserId,
    p_ok: revoked.ok,
    p_detail: revoked.ok ? "auth_ban,sessions_revoked" : `failed:${revoked.failed.join(",")}`,
    p_set_by: setBy,
  });
  if (!revoked.ok) return { result: "failed", code: `auth_revocation_incomplete.${revoked.failed.join("_")}`.slice(0, 80), appUserId };
  if (recorded.error) return { result: "failed", code: "revocation_not_recorded", appUserId };
  return { result: "applied", code: `${String(disabled.data)}.auth_revoked`, appUserId };
}
