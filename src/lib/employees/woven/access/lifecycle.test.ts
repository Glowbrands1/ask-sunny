import { describe, expect, it } from "vitest";

import { countLifecycle, MAX_AUTOMATIC_INVITE_ATTEMPTS } from "./lifecycle";
import { planAccess } from "./plan";
import type { PlannedRow, PlannerAccount, PlannerEmployee, PlannerInput } from "./types";

/**
 * ============================================================================
 * THE FIVE LIFECYCLE OUTCOMES — what the Access Preview leads with
 * ============================================================================
 *
 * CREATE_USER, LINK_EXISTING, NO_CHANGE, DISABLE_TERMINATED, REVIEW_REQUIRED,
 * each with one reason. Case by case from the owner's lifecycle list
 * (6 Oct 2026). Pure: the planner and its lifecycle reading, no database.
 */

const positions: PlannerInput["positions"] = [
  { wovenPositionId: "P-TC", status: "mapped", isConfirmed: true, role: "employee", scopeLevel: "salon" },
  { wovenPositionId: "P-ASD", status: "mapped", isConfirmed: true, role: "assistant_salon_director", scopeLevel: "salon" },
  { wovenPositionId: "P-SD", status: "mapped", isConfirmed: true, role: "salon_director", scopeLevel: "salon" },
  { wovenPositionId: "P-DM", status: "mapped", isConfirmed: true, role: "district_manager", scopeLevel: "district" },
  { wovenPositionId: "P-HR", status: "unmapped", isConfirmed: false, role: null, scopeLevel: null },
];
const locations: PlannerInput["locations"] = [
  { wovenLocationId: "L-GI", status: "mapped", salonNumber: "0307", name: "NE Grand Island" },
  { wovenLocationId: "L-LIB", status: "mapped", salonNumber: "0394", name: "KC Liberty" },
];

let n = 0;
const employee = (over: Partial<PlannerEmployee> = {}): PlannerEmployee => {
  n += 1;
  return {
    externalEmployeeId: `E${String(n).padStart(3, "0")}`,
    name: `Person ${n}`,
    emailAddress: `p${n}@gmail.com`,
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
  };
};
let u = 0;
const account = (over: Partial<PlannerAccount> = {}): PlannerAccount => {
  u += 1;
  return {
    appUserId: `00000000-0000-4000-8000-${String(u).padStart(12, "0")}`,
    email: `a${u}@gmail.com`,
    displayName: `Account ${u}`,
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
  };
};
/** A linked SD whose status Woven manages — role and location NOT managed, as the lifecycle always sets them. */
const linked = (e: PlannerEmployee, over: Partial<PlannerAccount> = {}) =>
  account({
    email: e.emailAddress ?? "x@gmail.com",
    management: "woven_linked",
    linkedExternalEmployeeId: e.externalEmployeeId,
    linkMethod: "admin_manual",
    managedStatus: true,
    ...over,
  });

const plan = (employees: PlannerEmployee[], accounts: PlannerAccount[] = []) => planAccess({ employees, positions, locations, accounts });
const of = (rows: PlannedRow[], e: PlannerEmployee) => rows.find((r) => r.key === `employee:${e.externalEmployeeId}`)!;
const outcome = (rows: PlannedRow[], e: PlannerEmployee) => [of(rows, e).lifecycle, of(rows, e).lifecycleReason];

describe("account creation", () => {
  it("new eligible Woven employee (Active SD/ASD, approved position, email, mapped salon, no account) → CREATE_USER", () => {
    const sd = employee();
    const asd = employee({ positionId: "P-ASD" });
    const rows = plan([sd, asd]);
    expect(outcome(rows, sd)).toEqual(["CREATE_USER", "eligible_salon_manager_without_account"]);
    expect(outcome(rows, asd)[0]).toBe("CREATE_USER");
  });

  it("existing Ask Sunny account with the exact email → LINK_EXISTING, not a duplicate", () => {
    const e = employee({ emailAddress: "Existing@Gmail.com" });
    const rows = plan([e], [account({ email: "existing@gmail.com" })]);
    expect(outcome(rows, e)).toEqual(["LINK_EXISTING", "single_exact_email_match"]);
    expect(rows.filter((r) => r.lifecycle === "CREATE_USER")).toEqual([]);
  });

  it("duplicate email between Woven employees → REVIEW_REQUIRED, nothing created", () => {
    const a = employee({ emailAddress: "shared@gmail.com" });
    const b = employee({ emailAddress: "shared@gmail.com" });
    const rows = plan([a, b]);
    expect(outcome(rows, a)).toEqual(["REVIEW_REQUIRED", "email_shared_by_several_woven_employees"]);
    expect(outcome(rows, b)[0]).toBe("REVIEW_REQUIRED");
  });

  it("unmapped position → REVIEW_REQUIRED (flagged for admin), never created; no role is guessed from the position name", () => {
    const hr = employee({ positionId: "P-HR", positionName: "Salon Director (acting)" });
    const rows = plan([hr]);
    expect(outcome(rows, hr)).toEqual(["REVIEW_REQUIRED", "woven_position_not_confirmed"]);
    expect(of(rows, hr).proposedRole).toBeNull();
  });

  it("missing or invalid email → REVIEW_REQUIRED, never created", () => {
    const missing = employee({ emailAddress: null });
    const invalid = employee({ emailAddress: "not-an-email", issues: ["invalid_email"] });
    const rows = plan([missing, invalid]);
    expect(outcome(rows, missing)).toEqual(["REVIEW_REQUIRED", "woven_email_missing"]);
    expect(outcome(rows, invalid)).toEqual(["REVIEW_REQUIRED", "woven_email_invalid"]);
  });

  it("status conflict (Active with a historical TerminationDate — e.g. a rehire) → REVIEW_REQUIRED, never created", () => {
    const e = employee({ positionId: "P-ASD", terminationDate: "2025-05-17", issues: ["status_termination_conflict"] });
    expect(outcome(plan([e]), e)).toEqual(["REVIEW_REQUIRED", "woven_shows_past_termination_date"]);
  });

  it("a bare Supabase Auth user already holds the email (created outside the lifecycle) → REVIEW_REQUIRED, never created", () => {
    const e = employee({ emailAddress: "Kailey.Like@Gmail.com" });
    const rows = planAccess({ employees: [e], positions, locations, accounts: [], authOnly: [{ email: "kailey.like@gmail.com", provisionedExternalEmployeeId: null }] });
    expect(outcome(rows, e)).toEqual(["REVIEW_REQUIRED", "auth_user_exists_without_profile"]);
    expect(of(rows, e).actions).toEqual(["FLAG_AUTH_USER_EXISTS"]);
  });

  it("a bare Auth user this lifecycle created for THIS employee (an interrupted create) → CREATE_USER resumes it", () => {
    const e = employee();
    const rows = planAccess({ employees: [e], positions, locations, accounts: [], authOnly: [{ email: e.emailAddress!, provisionedExternalEmployeeId: e.externalEmployeeId }] });
    expect(outcome(rows, e)[0]).toBe("CREATE_USER");
  });

  it("terminated employee with no account → NO_CHANGE, never created", () => {
    const e = employee({ employmentStatus: "terminated" });
    expect(outcome(plan([e]), e)).toEqual(["NO_CHANGE", "terminated_no_account"]);
  });

  it("positions outside the approved pair get no account and are not reviews (Tanning Consultant, District Manager)", () => {
    const tc = employee({ positionId: "P-TC" });
    const dm = employee({ positionId: "P-DM" });
    const rows = plan([tc, dm]);
    expect(outcome(rows, tc)).toEqual(["NO_CHANGE", "position_not_auto_provisioned"]);
    expect(outcome(rows, dm)).toEqual(["NO_CHANGE", "position_not_auto_provisioned"]);
  });

  it("repeated run after creation → NO_CHANGE (the provisioned link is found by EmployeeID)", () => {
    const e = employee();
    const created = linked(e, { status: "invited", linkMethod: "provisioned", invite: { status: "sent", sentAt: "x", acceptedAt: null, attempts: 1, error: null } });
    expect(outcome(plan([e], [created]), e)).toEqual(["NO_CHANGE", "in_sync_with_woven"]);
  });

  it(`an invitation that failed ${MAX_AUTOMATIC_INVITE_ATTEMPTS} times → REVIEW_REQUIRED; fewer → still NO_CHANGE (retried by the run)`, () => {
    const e = employee();
    const failing = (attempts: number) =>
      linked(e, { status: "invited", linkMethod: "provisioned", invite: { status: "failed", sentAt: null, acceptedAt: null, attempts, error: "email_rate_limited" } });
    expect(outcome(plan([e], [failing(1)]), e)[0]).toBe("NO_CHANGE");
    expect(outcome(plan([e], [failing(MAX_AUTOMATIC_INVITE_ATTEMPTS)]), e)).toEqual(["REVIEW_REQUIRED", "invite_delivery_failed"]);
  });
});

describe("termination", () => {
  it("explicit Woven Terminated, linked, status managed → DISABLE_TERMINATED", () => {
    const e = employee({ employmentStatus: "terminated", terminationDate: "2026-10-05" });
    expect(outcome(plan([e], [linked(e)]), e)).toEqual(["DISABLE_TERMINATED", "terminated_in_woven"]);
  });

  it("missing employee only (not in the latest read) → REVIEW_REQUIRED, never revoked — even if the last status on file was Terminated", () => {
    const missing = employee({ missingSyncCount: 1 });
    const staleTerminated = employee({ employmentStatus: "terminated", missingSyncCount: 2 });
    const rows = plan([missing, staleTerminated], [linked(missing), linked(staleTerminated)]);
    expect(outcome(rows, missing)).toEqual(["REVIEW_REQUIRED", "not_in_latest_woven_read"]);
    expect(outcome(rows, staleTerminated)).toEqual(["REVIEW_REQUIRED", "not_in_latest_woven_read"]);
    expect(rows.some((r) => r.lifecycle === "DISABLE_TERMINATED")).toBe(false);
  });

  it("past TerminationDate but Active → NO_CHANGE, never revoked", () => {
    const e = employee({ terminationDate: "2025-05-17", issues: ["status_termination_conflict"] });
    const row = of(plan([e], [linked(e)]), e);
    expect(row.lifecycle).toBe("NO_CHANGE");
    expect(row.actions).not.toContain("DISABLE_TERMINATED");
  });

  it("unknown Woven status → REVIEW_REQUIRED, fail closed", () => {
    const e = employee({ employmentStatus: "unknown" });
    expect(outcome(plan([e], [linked(e)]), e)).toEqual(["REVIEW_REQUIRED", "woven_status_unknown"]);
  });

  it("already disabled and revoked → NO_CHANGE (idempotent)", () => {
    const e = employee({ employmentStatus: "terminated" });
    const done = linked(e, { status: "disabled", terminatedAt: "t", accessRevokedAt: "t" });
    expect(outcome(plan([e], [done]), e)).toEqual(["NO_CHANGE", "access_already_revoked"]);
  });

  it("disabled but the auth-layer revocation never completed → DISABLE_TERMINATED again, to finish it", () => {
    const e = employee({ employmentStatus: "terminated" });
    const half = linked(e, { status: "disabled", terminatedAt: "t", accessRevokedAt: null });
    expect(outcome(plan([e], [half]), e)).toEqual(["DISABLE_TERMINATED", "terminated_in_woven_completing_revocation"]);
  });

  it("status NOT managed (a District Manager, an admin, a protected override) → REVIEW_REQUIRED, never revoked automatically", () => {
    const dm = employee({ employmentStatus: "terminated", positionId: "P-DM" });
    const admin = employee({ employmentStatus: "terminated" });
    const rows = plan(
      [dm, admin],
      [
        linked(dm, { role: "district_manager", scopeLevel: "global", primaryAreaId: null, managedStatus: false }),
        linked(admin, { role: "admin", scopeLevel: "global", primaryAreaId: null }),
      ],
    );
    expect(outcome(rows, dm)).toEqual(["REVIEW_REQUIRED", "terminated_in_woven_status_not_woven_managed"]);
    expect(outcome(rows, admin)).toEqual(["REVIEW_REQUIRED", "terminated_in_woven_protected_account"]);
  });

  it("rehire: revoked, now Active again → REVIEW_REQUIRED, never reactivated", () => {
    const e = employee();
    const revoked = linked(e, { status: "disabled", terminatedAt: "t", accessRevokedAt: "t" });
    expect(outcome(plan([e], [revoked]), e)).toEqual(["REVIEW_REQUIRED", "active_in_woven_after_revocation"]);
  });
});

describe("out of scope stays out of scope", () => {
  it("a role or salon that differs from Woven is NO_CHANGE for the lifecycle (never applied, never a review here)", () => {
    const moved = employee({ primaryWovenLocationId: "L-LIB" });
    const promoted = employee({ positionId: "P-SD" });
    const rows = plan([moved, promoted], [linked(moved), linked(promoted, { role: "assistant_salon_director" })]);
    expect(outcome(rows, moved)).toEqual(["NO_CHANGE", "role_and_location_not_managed_by_lifecycle"]);
    expect(outcome(rows, promoted)).toEqual(["NO_CHANGE", "role_and_location_not_managed_by_lifecycle"]);
  });

  it("accounts with no Woven employee: not-managed → NO_CHANGE; linked to a vanished EmployeeID → REVIEW_REQUIRED", () => {
    const vendor = account({ management: "not_woven_managed" });
    const orphan = account({ management: "woven_linked", linkedExternalEmployeeId: "GONE", managedStatus: true });
    const rows = plan([], [vendor, orphan]);
    expect(rows.find((r) => r.appUserId === vendor.appUserId)!.lifecycle).toBe("NO_CHANGE");
    expect(rows.find((r) => r.appUserId === orphan.appUserId)).toMatchObject({ lifecycle: "REVIEW_REQUIRED", lifecycleReason: "linked_employee_not_in_woven_directory" });
  });

  it("counts every row exactly once", () => {
    const rows = plan([employee(), employee({ positionId: "P-TC" }), employee({ positionId: "P-HR" })]);
    const counts = countLifecycle(rows);
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(rows.length);
    expect(counts).toMatchObject({ CREATE_USER: 1, NO_CHANGE: 1, REVIEW_REQUIRED: 1 });
  });
});
