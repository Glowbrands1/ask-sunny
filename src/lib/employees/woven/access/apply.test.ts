import { describe, expect, it, vi } from "vitest";

import { applyAccessLifecycle, refusalCode, type ApplyDeps } from "./apply";
import { buildAccessPlan, type AccessPlan } from "./build";
import type { WovenAccessConfig } from "./config";
import type { DirectoryRunFacts } from "./guards";
import type { PlannerAccount, PlannerEmployee, PlannerInput } from "./types";

/**
 * ============================================================================
 * THE APPLY ENGINE, WITH FAKE SERVICES
 * ============================================================================
 *
 * Every effect goes through `ApplyDeps`, so these tests see exactly what the
 * engine asks Supabase Auth and the database to do — and what it never asks.
 * The same engine runs against the real services in
 * `lifecycle.local-stack.test.ts`.
 */

const NOW = new Date("2026-10-06T12:00:00Z");
const positions: PlannerInput["positions"] = [
  { wovenPositionId: "P-SD", status: "mapped", isConfirmed: true, role: "salon_director", scopeLevel: "salon" },
  { wovenPositionId: "P-ASD", status: "mapped", isConfirmed: true, role: "assistant_salon_director", scopeLevel: "salon" },
];
const locations: PlannerInput["locations"] = [
  { wovenLocationId: "L-GI", status: "mapped", salonNumber: "0307", name: "NE Grand Island" },
  { wovenLocationId: "L-LIB", status: "mapped", salonNumber: "0394", name: "KC Liberty" },
];
const employee = (id: string, over: Partial<PlannerEmployee> = {}): PlannerEmployee => ({
  externalEmployeeId: id,
  name: `Person ${id}`,
  emailAddress: `${id.toLowerCase()}@gmail.com`,
  employmentStatus: "active",
  missingSyncCount: 0,
  positionId: "P-SD",
  positionName: "Salon Director",
  primaryWovenLocationId: "L-GI",
  primaryLocationName: "NE Grand Island",
  additionalLocationNames: [],
  issues: [],
  terminationDate: null,
  lastSyncedAt: "2026-10-06T11:17:50Z",
  ...over,
});
const account = (n: number, over: Partial<PlannerAccount> = {}): PlannerAccount => ({
  appUserId: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  email: `a${n}@gmail.com`,
  displayName: `Account ${n}`,
  role: "salon_director",
  status: "active",
  scopeLevel: "salon",
  primaryAreaId: "loc-0307",
  alsoCoversAreaIds: [],
  management: null,
  linkedExternalEmployeeId: null,
  linkMethod: null,
  managedStatus: false,
  managedLocation: false,
  managedRole: false,
  terminatedAt: null,
  accessRevokedAt: null,
  override: null,
  invite: null,
  ...over,
});
const healthyRuns: DirectoryRunFacts[] = [
  { status: "succeeded", finishedAt: "2026-10-06T11:18:30Z", employeesActive: 150, issueCounts: {} },
  { status: "succeeded", finishedAt: "2026-10-05T11:18:30Z", employeesActive: 150, issueCounts: {} },
];
const planOfAll = (employees: PlannerEmployee[], accounts: PlannerAccount[] = [], runs = healthyRuns): AccessPlan =>
  buildAccessPlan({ employees, positions, locations, accounts }, { runs, mappingBaseline: null, directoryRunId: "11111111-1111-4111-8111-111111111111", now: NOW });

const planOf = planOfAll;

const config = (over: Partial<WovenAccessConfig> = {}): WovenAccessConfig => ({
  mode: "apply",
  applyActions: ["CREATE_USER", "SEND_INVITE", "LINK_EXISTING", "DISABLE_TERMINATED"],
  employeeAllowlist: null,
  problem: null,
  ...over,
});
const REDIRECT = "https://ask-sunny.example/auth/accept";

/** A recording fake of every service the engine uses. */
function fakes(plan: AccessPlan, over: { rpc?: Record<string, (args: Record<string, unknown>) => { data: unknown; error: { message?: string; code?: string } | null }> } & Partial<Omit<ApplyDeps, "rpc">> = {}) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const recorded: Record<string, unknown>[] = [];
  const rpcHandlers: Record<string, (args: Record<string, unknown>) => { data: unknown; error: { message?: string; code?: string } | null }> = {
    employee_access_begin_apply_run: () => ({ data: "run-1", error: null }),
    employee_access_finish_apply_run: () => ({ data: null, error: null }),
    employee_access_record_apply_actions: (args) => {
      recorded.push(...(args.p_actions as Record<string, unknown>[]));
      return { data: 1, error: null };
    },
    employee_access_auth_user_by_email: () => ({ data: [], error: null }),
    employee_access_provision_account: () => ({ data: "created", error: null }),
    employee_access_record_invite: () => ({ data: true, error: null }),
    employee_access_link_existing: () => ({ data: "linked", error: null }),
    employee_access_disable_terminated: () => ({ data: "disabled", error: null }),
    employee_access_record_revocation: () => ({ data: null, error: null }),
    ...over.rpc,
  };
  const defaults = {
    createUser: vi.fn(async (attributes: unknown) => ({ data: { user: { id: "aaaaaaaa-0000-4000-8000-000000000001" } }, error: null, attributes })),
    inviteUserByEmail: vi.fn(async () => ({ data: {}, error: null })),
    getUserById: vi.fn(async () => ({ data: { user: { email_confirmed_at: null, banned_until: null } }, error: null })),
  };
  /* Overrides are vi.fn() too; typed as the defaults so `.mock` stays visible to the tests. */
  const auth = { ...defaults, ...(over.auth as object) } as typeof defaults;
  const deps: ApplyDeps = {
    loadPlan: over.loadPlan ?? (async () => plan),
    rpc: (fn, args) => {
      calls.push({ fn, args });
      const handler = rpcHandlers[fn];
      if (!handler) throw new Error(`unexpected rpc ${fn}`);
      return Promise.resolve(handler(args));
    },
    auth: auth as unknown as ApplyDeps["auth"],
    revokeAuthAccess: over.revokeAuthAccess ?? vi.fn(async () => ({ ok: true, failed: [] })),
  };
  const fnsCalled = () => calls.map((c) => c.fn);
  const callOf = (fn: string) => calls.find((c) => c.fn === fn)?.args;
  return { deps, auth, calls, recorded, fnsCalled, callOf };
}

const run = (f: ReturnType<typeof fakes>, over: Partial<WovenAccessConfig> = {}, redirectTo: string | null = REDIRECT) =>
  applyAccessLifecycle({ requestedBy: "cron", redirectTo, config: config(over), now: NOW }, f.deps);

describe("mode and lock", () => {
  it("does nothing at all unless the mode is apply", async () => {
    const f = fakes(planOf([employee("E1")]));
    expect(await run(f, { mode: "shadow" })).toEqual({ status: "off" });
    expect(await run(f, { mode: "off" })).toEqual({ status: "off" });
    expect(f.calls).toEqual([]);
    expect(f.auth.createUser).not.toHaveBeenCalled();
  });

  it("a second concurrent run is refused at the lock and touches nothing", async () => {
    const f = fakes(planOf([employee("E1")]), {
      rpc: { employee_access_begin_apply_run: () => ({ data: null, error: { message: "employee_access_apply_in_progress", code: "55P03" } }) },
    });
    expect(await run(f)).toEqual({ status: "busy" });
    expect(f.fnsCalled()).toEqual(["employee_access_begin_apply_run"]);
    expect(f.auth.createUser).not.toHaveBeenCalled();
  });
});

describe("guards", () => {
  it.each([
    ["the Woven sync failed", [{ ...healthyRuns[0]!, status: "failed" as const }, ...healthyRuns]],
    ["the directory is stale", [{ ...healthyRuns[0]!, finishedAt: "2026-10-04T00:00:00Z" }, healthyRuns[1]!]],
    ["the terminated-status read failed", [{ ...healthyRuns[0]!, issueCounts: { terminated_status_read_failed_http: 1 } }, healthyRuns[1]!]],
    ["the status enum was unresolved", [{ ...healthyRuns[0]!, issueCounts: { enums_unavailable: 1 } }, healthyRuns[1]!]],
  ])("abort every mutation when %s: recorded as skipped, run aborted", async (_name, runs) => {
    const terminated = employee("E2", { employmentStatus: "terminated" });
    const linked = account(2, { email: "e2@gmail.com", management: "woven_linked", linkedExternalEmployeeId: "E2", managedStatus: true });
    const f = fakes(planOf([employee("E1"), terminated], [linked], runs));
    const outcome = await run(f);
    expect(outcome.status).toBe("aborted");
    expect(f.auth.createUser).not.toHaveBeenCalled();
    expect(f.fnsCalled()).not.toContain("employee_access_disable_terminated");
    expect(f.fnsCalled()).not.toContain("employee_access_provision_account");
    expect(f.recorded.filter((r) => r.is_primary && ["CREATE_USER", "DISABLE_TERMINATED"].includes(String(r.action))).map((r) => r.result_code)).toEqual([
      "guard_blocked",
      "guard_blocked",
    ]);
    expect(f.callOf("employee_access_finish_apply_run")).toMatchObject({ p_status: "aborted" });
  });

  it("terminations above the threshold abort the whole run — nobody is disabled", async () => {
    const employees = ["T1", "T2", "T3", "T4"].map((id) => employee(id, { employmentStatus: "terminated" }));
    const accounts = employees.map((e, i) => account(10 + i, { email: e.emailAddress!, management: "woven_linked", linkedExternalEmployeeId: e.externalEmployeeId, managedStatus: true }));
    const f = fakes(planOf(employees, accounts));
    const outcome = await run(f);
    expect(outcome).toMatchObject({ status: "aborted", guardCodes: expect.arrayContaining(["terminations_exceed_threshold"]) });
    expect(f.deps.revokeAuthAccess).not.toHaveBeenCalled();
  });
});

describe("CREATE_USER + invite", () => {
  it("creates an unconfirmed auth user with NO password, provisions profile + link, and Supabase emails the invitation to the Woven email", async () => {
    const f = fakes(planOf([employee("E1", { emailAddress: "Carley.R@Gmail.com" })]));
    const outcome = await run(f);
    expect(outcome).toMatchObject({ status: "completed", tally: { applied: { CREATE_USER: 1 } } });
    expect(f.auth.createUser).toHaveBeenCalledWith({
      email: "carley.r@gmail.com",
      email_confirm: false,
      app_metadata: { provisioned_by: "woven", external_employee_id: "E1" },
    });
    const created = f.auth.createUser.mock.calls[0]![0] as Record<string, unknown>;
    expect(Object.keys(created)).not.toContain("password");
    expect(f.callOf("employee_access_provision_account")).toMatchObject({
      p_app_user_id: "aaaaaaaa-0000-4000-8000-000000000001",
      p_external_employee_id: "E1",
      p_email: "carley.r@gmail.com",
      p_role: "salon_director",
      p_primary_area_id: "loc-0307",
    });
    expect(f.auth.inviteUserByEmail).toHaveBeenCalledWith("carley.r@gmail.com", { redirectTo: REDIRECT });
    expect(f.callOf("employee_access_record_invite")).toMatchObject({ p_outcome: "sent", p_error_code: null });
    expect(f.recorded.find((r) => r.action === "CREATE_USER")).toMatchObject({ result: "applied", result_code: "created.invite_sent", app_user_id: "aaaaaaaa-0000-4000-8000-000000000001" });
  });

  it("invite failure: the account stays (invited, recoverable), the failure is recorded with a code, and nothing is deleted", async () => {
    const f = fakes(planOf([employee("E1")]), {
      auth: {
        createUser: vi.fn(async () => ({ data: { user: { id: "aaaaaaaa-0000-4000-8000-000000000001" } }, error: null })),
        inviteUserByEmail: vi.fn(async () => ({ data: null, error: { code: "over_email_send_rate_limit", status: 429 } })),
        getUserById: vi.fn(async () => ({ data: { user: { email_confirmed_at: null, banned_until: null } }, error: null })),
      } as never,
    });
    await run(f);
    expect(f.callOf("employee_access_record_invite")).toMatchObject({ p_outcome: "failed", p_error_code: "email_rate_limited" });
    expect(f.recorded.find((r) => r.action === "CREATE_USER")).toMatchObject({ result: "applied", result_code: "created.invite_failed.email_rate_limited" });
  });

  it("the next run retries a failed invitation for a provisioned, still-invited account — and stops after three attempts", async () => {
    const e = employee("E1");
    const provisioned = (attempts: number) =>
      account(1, {
        email: "e1@gmail.com",
        status: "invited",
        management: "woven_linked",
        linkedExternalEmployeeId: "E1",
        linkMethod: "provisioned",
        managedStatus: true,
        invite: { status: "failed", sentAt: null, acceptedAt: null, attempts, error: "email_rate_limited" },
      });
    const retry = fakes(planOf([e], [provisioned(1)]));
    expect(await run(retry)).toMatchObject({ tally: { applied: { INVITE_RETRY: 1 } } });
    expect(retry.auth.inviteUserByEmail).toHaveBeenCalledWith("e1@gmail.com", { redirectTo: REDIRECT });
    expect(retry.auth.createUser).not.toHaveBeenCalled();

    const exhausted = fakes(planOf([e], [provisioned(3)]));
    await run(exhausted);
    expect(exhausted.auth.inviteUserByEmail).not.toHaveBeenCalled();
  });

  it("no site URL for the link → the account is created but no invitation is sent; recorded as redirect_not_configured", async () => {
    const f = fakes(planOf([employee("E1")]));
    await run(f, {}, null);
    expect(f.auth.inviteUserByEmail).not.toHaveBeenCalled();
    expect(f.callOf("employee_access_record_invite")).toMatchObject({ p_outcome: "failed", p_error_code: "redirect_not_configured" });
  });

  it("resumes an interrupted attempt: an unconfirmed auth user created for THIS EmployeeID is reused, never duplicated", async () => {
    const f = fakes(planOf([employee("E1")]), {
      rpc: {
        employee_access_auth_user_by_email: () => ({
          data: [{ id: "bbbbbbbb-0000-4000-8000-000000000002", email_confirmed: false, provisioned_external_employee_id: "E1", has_profile: false, banned: false }],
          error: null,
        }),
      },
    });
    await run(f);
    expect(f.auth.createUser).not.toHaveBeenCalled();
    expect(f.callOf("employee_access_provision_account")).toMatchObject({ p_app_user_id: "bbbbbbbb-0000-4000-8000-000000000002" });
  });

  it("an auth user with that email that this lifecycle did NOT create for this employee → failed, never taken over", async () => {
    const f = fakes(planOf([employee("E1")]), {
      rpc: {
        employee_access_auth_user_by_email: () => ({
          data: [{ id: "cccccccc-0000-4000-8000-000000000003", email_confirmed: true, provisioned_external_employee_id: null, has_profile: false, banned: false }],
          error: null,
        }),
      },
    });
    await run(f);
    expect(f.auth.createUser).not.toHaveBeenCalled();
    expect(f.fnsCalled()).not.toContain("employee_access_provision_account");
    expect(f.recorded.find((r) => r.action === "CREATE_USER")).toMatchObject({ result: "failed", result_code: "auth_user_exists_for_another_identity" });
  });

  it("a concurrent creator wins the email: createUser says email_exists, the engine looks again and resumes that same user", async () => {
    let lookups = 0;
    const f = fakes(planOf([employee("E1")]), {
      rpc: {
        employee_access_auth_user_by_email: () => {
          lookups += 1;
          return lookups === 1
            ? { data: [], error: null }
            : { data: [{ id: "dddddddd-0000-4000-8000-000000000004", email_confirmed: false, provisioned_external_employee_id: "E1", has_profile: true, banned: false }], error: null };
        },
        employee_access_provision_account: () => ({ data: "already_provisioned", error: null }),
      },
      auth: {
        createUser: vi.fn(async () => ({ data: { user: null }, error: { code: "email_exists", status: 422 } })),
        inviteUserByEmail: vi.fn(async () => ({ data: {}, error: null })),
        getUserById: vi.fn(async () => ({ data: { user: { email_confirmed_at: null, banned_until: null } }, error: null })),
      } as never,
    });
    await run(f);
    expect(f.recorded.find((r) => r.action === "CREATE_USER")).toMatchObject({ result: "applied", result_code: "resumed.invite_sent" });
  });

  it("the database's re-check refuses (e.g. a status conflict appeared since the plan) → failed with its code; nothing created in app_users", async () => {
    const f = fakes(planOf([employee("E1")]), {
      rpc: { employee_access_provision_account: () => ({ data: null, error: { message: "provision_status_conflict" } }) },
    });
    await run(f);
    expect(f.recorded.find((r) => r.action === "CREATE_USER")).toMatchObject({ result: "failed", result_code: "provision_status_conflict" });
    expect(f.auth.inviteUserByEmail).not.toHaveBeenCalled();
  });
});

describe("SEND_INVITE is its own switch", () => {
  it("CREATE_USER without SEND_INVITE creates the account and emails nothing — no attempt is recorded", async () => {
    const f = fakes(planOf([employee("E1")]));
    await run(f, { applyActions: ["CREATE_USER"] });
    expect(f.auth.createUser).toHaveBeenCalledTimes(1);
    expect(f.fnsCalled()).toContain("employee_access_provision_account");
    expect(f.auth.inviteUserByEmail).not.toHaveBeenCalled();
    expect(f.fnsCalled()).not.toContain("employee_access_record_invite");
    expect(f.recorded.find((r) => r.action === "CREATE_USER")).toMatchObject({ result: "applied", result_code: "created.invite_not_sent" });
  });

  it("turning SEND_INVITE on later invites the waiting account (status not_sent) — and only then", async () => {
    const waiting = account(1, {
      email: "e1@gmail.com",
      status: "invited",
      management: "woven_linked",
      linkedExternalEmployeeId: "E1",
      linkMethod: "provisioned",
      managedStatus: true,
      invite: { status: "not_sent", sentAt: null, acceptedAt: null, attempts: 0, error: null },
    });
    const off = fakes(planOf([employee("E1")], [waiting]));
    await run(off, { applyActions: ["CREATE_USER"] });
    expect(off.auth.inviteUserByEmail).not.toHaveBeenCalled();
    const on = fakes(planOf([employee("E1")], [waiting]));
    await run(on, { applyActions: ["SEND_INVITE"] });
    expect(on.auth.inviteUserByEmail).toHaveBeenCalledWith("e1@gmail.com", { redirectTo: REDIRECT });
  });
});

describe("LINK_EXISTING", () => {
  it("stores the link through the database function, for the planner's candidate account only", async () => {
    const a = account(1, { email: "e1@gmail.com" });
    const f = fakes(planOf([employee("E1")], [a]));
    await run(f);
    expect(f.callOf("employee_access_link_existing")).toMatchObject({ p_app_user_id: a.appUserId, p_external_employee_id: "E1" });
    expect(f.auth.createUser).not.toHaveBeenCalled();
    expect(f.recorded.find((r) => r.action === "LINK_EXISTING")).toMatchObject({ result: "applied", result_code: "linked" });
  });
});

describe("DISABLE_TERMINATED", () => {
  const terminated = employee("E9", { employmentStatus: "terminated" });
  const linked = account(9, { email: "e9@gmail.com", management: "woven_linked", linkedExternalEmployeeId: "E9", managedStatus: true });
  /* An active, in-sync colleague: a directory with nobody active trips the zero_active_employees guard. */
  const steady = employee("E8");
  const steadyAccount = account(8, { email: "e8@gmail.com", management: "woven_linked", linkedExternalEmployeeId: "E8", managedStatus: true });
  const planOf = (employees: PlannerEmployee[], accounts: PlannerAccount[]) => planOfAll([...employees, steady], [...accounts, steadyAccount]);

  it("disables the profile (database re-checks Terminated), then bans + revokes sessions, then records it", async () => {
    const f = fakes(planOf([terminated], [linked]));
    await run(f);
    expect(f.fnsCalled().filter((x) => x.startsWith("employee_access_disable") || x.startsWith("employee_access_record_revocation"))).toEqual([
      "employee_access_disable_terminated",
      "employee_access_record_revocation",
    ]);
    expect(f.deps.revokeAuthAccess).toHaveBeenCalledWith(linked.appUserId);
    expect(f.callOf("employee_access_record_revocation")).toMatchObject({ p_ok: true, p_detail: "auth_ban,sessions_revoked" });
    expect(f.recorded.find((r) => r.action === "DISABLE_TERMINATED")).toMatchObject({ result: "applied", result_code: "disabled.auth_revoked" });
  });

  it("a partial auth revocation is recorded as failed and incomplete — the next run completes it", async () => {
    const f = fakes(planOf([terminated], [linked]), { revokeAuthAccess: vi.fn(async () => ({ ok: false, failed: ["sessions"] })) });
    await run(f);
    expect(f.callOf("employee_access_record_revocation")).toMatchObject({ p_ok: false, p_detail: "failed:sessions" });
    expect(f.recorded.find((r) => r.action === "DISABLE_TERMINATED")).toMatchObject({ result: "failed", result_code: "auth_revocation_incomplete.sessions" });
  });

  it("the database refuses (no longer Terminated in the latest read) → nothing banned", async () => {
    const f = fakes(planOf([terminated], [linked]), {
      rpc: { employee_access_disable_terminated: () => ({ data: null, error: { message: "disable_not_terminated_in_latest_read" } }) },
    });
    await run(f);
    expect(f.deps.revokeAuthAccess).not.toHaveBeenCalled();
    expect(f.recorded.find((r) => r.action === "DISABLE_TERMINATED")).toMatchObject({ result: "failed", result_code: "disable_not_terminated_in_latest_read" });
  });
});

describe("controlled rollout", () => {
  it("only the enabled capabilities run; the rest are recorded as skipped (capability_off)", async () => {
    const terminated = employee("E9", { employmentStatus: "terminated" });
    const linked = account(9, { email: "e9@gmail.com", management: "woven_linked", linkedExternalEmployeeId: "E9", managedStatus: true });
    const f = fakes(planOf([employee("E1"), terminated], [linked]));
    await run(f, { applyActions: ["CREATE_USER"] });
    expect(f.auth.createUser).toHaveBeenCalledTimes(1);
    expect(f.deps.revokeAuthAccess).not.toHaveBeenCalled();
    expect(f.recorded.find((r) => r.action === "DISABLE_TERMINATED")).toMatchObject({ result: "skipped", result_code: "capability_off" });
  });

  it("with a batch allowlist, only those EmployeeIDs are touched", async () => {
    const f = fakes(planOf([employee("E1"), employee("E2")]));
    await run(f, { employeeAllowlist: ["E2"] });
    expect(f.auth.createUser).toHaveBeenCalledTimes(1);
    expect((f.auth.createUser.mock.calls[0]![0] as { app_metadata: { external_employee_id: string } }).app_metadata.external_employee_id).toBe("E2");
    expect(f.recorded.find((r) => r.external_employee_id === "E1" && r.action === "CREATE_USER")).toMatchObject({ result: "skipped", result_code: "not_in_approved_batch" });
  });

  it("UPDATE_ROLE and UPDATE_PRIMARY_LOCATION are never applied, even on an account with role and location managed", async () => {
    const moved = employee("E5", { primaryWovenLocationId: "L-LIB" });
    const promoted = employee("E6", { positionId: "P-SD" });
    const accounts = [
      account(5, { email: "e5@gmail.com", management: "woven_linked", linkedExternalEmployeeId: "E5", managedStatus: true, managedLocation: true, managedRole: true }),
      account(6, { email: "e6@gmail.com", role: "assistant_salon_director", management: "woven_linked", linkedExternalEmployeeId: "E6", managedStatus: true, managedLocation: true, managedRole: true }),
    ];
    const plan = planOf([moved, promoted], accounts);
    expect(plan.rows.flatMap((r) => r.actions)).toEqual(expect.arrayContaining(["UPDATE_PRIMARY_LOCATION", "UPDATE_ROLE"]));
    const f = fakes(plan);
    await run(f);
    const skipped = f.recorded.filter((r) => r.is_primary && (r.action === "UPDATE_ROLE" || r.action === "UPDATE_PRIMARY_LOCATION"));
    expect(skipped.map((r) => [r.result, r.result_code])).toEqual([
      ["skipped", "not_a_lifecycle_action"],
      ["skipped", "not_a_lifecycle_action"],
    ]);
    /* Nothing but the run record was asked of the database. */
    expect(new Set(f.fnsCalled())).toEqual(new Set(["employee_access_begin_apply_run", "employee_access_record_apply_actions", "employee_access_finish_apply_run"]));
  });

  it("a repeated run over the applied state does nothing (idempotent)", async () => {
    const e = employee("E1");
    const done = account(1, {
      email: "e1@gmail.com",
      status: "invited",
      management: "woven_linked",
      linkedExternalEmployeeId: "E1",
      linkMethod: "provisioned",
      managedStatus: true,
      invite: { status: "sent", sentAt: "x", acceptedAt: null, attempts: 1, error: null },
    });
    const f = fakes(planOf([e], [done]));
    expect(await run(f)).toMatchObject({ status: "completed", tally: { applied: {}, failed: {} } });
    expect(f.auth.createUser).not.toHaveBeenCalled();
    expect(f.auth.inviteUserByEmail).not.toHaveBeenCalled();
  });

  it("an error mid-run closes the run as failed and keeps what was recorded", async () => {
    let loads = 0;
    const f = fakes(planOf([employee("E1")]), {
      loadPlan: async () => {
        loads += 1;
        if (loads > 1) throw new Error("db down");
        return planOf([employee("E1")]);
      },
    });
    expect(await run(f)).toMatchObject({ status: "failed", code: "apply_interrupted" });
    expect(f.callOf("employee_access_finish_apply_run")).toMatchObject({ p_status: "failed" });
    expect(f.auth.createUser).not.toHaveBeenCalled();
  });
});

describe("refusalCode", () => {
  it("passes only the database's own short codes, never a provider message", () => {
    expect(refusalCode({ message: "provision_status_conflict" }, "x")).toBe("provision_status_conflict");
    expect(refusalCode({ message: "duplicate key value violates unique constraint \"app_users_email_key\"" }, "provision_refused")).toBe("provision_refused");
    expect(refusalCode(null, "fallback")).toBe("fallback");
  });
});
