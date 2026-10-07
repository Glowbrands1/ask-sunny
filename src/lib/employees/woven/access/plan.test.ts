import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { ACCESS_GUARD_LIMITS, evaluateAccessGuards, type DirectoryRunFacts } from "./guards";
import { countActions, planAccess, salonAreaId } from "./plan";
import { ACCESS_ACTIONS, isMutating, type PlannedRow, type PlannerAccount, type PlannerEmployee, type PlannerInput } from "./types";

/**
 * ============================================================================
 * THE ACCESS POLICY, CASE BY CASE — pure planner, no database
 * ============================================================================
 *
 * Numbers in the test names are the owner's test list (2 Oct 2026). The
 * authentication-layer cases (6, 20, 21) and history (7) are proven against a
 * real Supabase Auth server in `src/lib/auth/revocation.local-stack.test.ts`.
 */

/* ------------------------------------------------------------ fixtures -- */

const POS = { tc: "P-TC", asd: "P-ASD", sd: "P-SD", dm: "P-DM", ops: "P-OPS" };
const LOC = { grandIsland: "L-0307", omahaCenter: "L-0314", liberty: "L-0394", corporate: "L-CORP", omahaQ: "L-Q" };

const positions: PlannerInput["positions"] = [
  { wovenPositionId: POS.tc, status: "mapped", isConfirmed: true, role: "employee", scopeLevel: "salon" },
  { wovenPositionId: POS.asd, status: "mapped", isConfirmed: true, role: "assistant_salon_director", scopeLevel: "salon" },
  { wovenPositionId: POS.sd, status: "mapped", isConfirmed: true, role: "salon_director", scopeLevel: "salon" },
  { wovenPositionId: POS.dm, status: "mapped", isConfirmed: true, role: "district_manager", scopeLevel: "district" },
  { wovenPositionId: POS.ops, status: "unmapped", isConfirmed: false, role: null, scopeLevel: null },
];
const locations: PlannerInput["locations"] = [
  { wovenLocationId: LOC.grandIsland, status: "mapped", salonNumber: "0307", name: "NE Grand Island" },
  { wovenLocationId: LOC.omahaCenter, status: "mapped", salonNumber: "0314", name: "NE Omaha Center" },
  { wovenLocationId: LOC.liberty, status: "mapped", salonNumber: "0394", name: "KC Liberty" },
  { wovenLocationId: LOC.corporate, status: "ignored", salonNumber: null, name: "JB & Associates - Corporate" },
  { wovenLocationId: LOC.omahaQ, status: "unmapped", salonNumber: null, name: "NE Omaha Q" },
];

let seq = 0;
function employee(overrides: Partial<PlannerEmployee> = {}): PlannerEmployee {
  seq += 1;
  return {
    externalEmployeeId: `E${String(seq).padStart(3, "0")}`,
    name: `Person ${seq}`,
    emailAddress: `person${seq}@gmail.com`,
    employmentStatus: "active",
    missingSyncCount: 0,
    positionId: POS.sd,
    positionName: "Salon Director",
    primaryWovenLocationId: LOC.grandIsland,
    primaryLocationName: "NE Grand Island",
    additionalLocationNames: [],
    issues: [],
    terminationDate: null,
    lastSyncedAt: "2026-10-02T11:17:50Z",
    ...overrides,
  };
}

let userSeq = 0;
function account(overrides: Partial<PlannerAccount> = {}): PlannerAccount {
  userSeq += 1;
  return {
    appUserId: `00000000-0000-4000-8000-${String(userSeq).padStart(12, "0")}`,
    email: `account${userSeq}@gmail.com`,
    displayName: `Account ${userSeq}`,
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
    ...overrides,
  };
}

/** A confirmed, fully Woven-managed salon manager account for `e`. */
const linkedTo = (e: PlannerEmployee, overrides: Partial<PlannerAccount> = {}) =>
  account({
    email: e.emailAddress ?? "nobody@gmail.com",
    management: "woven_linked",
    linkedExternalEmployeeId: e.externalEmployeeId,
    linkMethod: "admin_confirmed_email",
    managedStatus: true,
    managedLocation: true,
    managedRole: true,
    ...overrides,
  });

const plan = (employees: PlannerEmployee[], accounts: PlannerAccount[] = []) => planAccess({ employees, positions, locations, accounts });
const rowOf = (rows: PlannedRow[], e: PlannerEmployee) => rows.find((r) => r.externalEmployeeId === e.externalEmployeeId && r.key.startsWith("employee:"))!;
const mutating = (rows: PlannedRow[]) => rows.flatMap((r) => r.actions.filter(isMutating));

/** What an apply step WOULD do to the accounts — used only to prove a second plan is a no-op. */
function simulateApply(rows: PlannedRow[], accounts: PlannerAccount[], employees: PlannerEmployee[]): PlannerAccount[] {
  const next = accounts.map((a) => ({ ...a }));
  for (const row of rows) {
    const target = next.find((a) => a.appUserId === row.appUserId);
    if (row.actions.includes("DISABLE_TERMINATED") && target) {
      target.status = "disabled";
      target.accessRevokedAt = "2026-10-02T12:00:00Z";
      target.terminatedAt = "2026-10-02T12:00:00Z";
    }
    if (row.actions.includes("UPDATE_PRIMARY_LOCATION") && target) target.primaryAreaId = String(row.after!.scope_primary_area_id);
    if (row.actions.includes("UPDATE_ROLE") && target) target.role = row.after!.role as PlannerAccount["role"];
    if (row.actions.includes("CREATE_USER")) {
      const e = employees.find((x) => x.externalEmployeeId === row.externalEmployeeId)!;
      next.push(
        account({
          email: String(row.after!.email),
          role: row.after!.role as PlannerAccount["role"],
          status: "invited",
          primaryAreaId: String(row.after!.scope_primary_area_id),
          management: "woven_linked",
          linkedExternalEmployeeId: e.externalEmployeeId,
          linkMethod: "provisioned",
          managedStatus: true,
          managedLocation: true,
          managedRole: true,
        }),
      );
    }
  }
  return next;
}

/* --------------------------------------------------------------- cases -- */

describe("provisioning", () => {
  it("1. active Salon Director, approved mapping, email, mapped salon, no account → CREATE_USER (invited; status managed; role and salon never)", () => {
    const e = employee({ emailAddress: "Carley.R@Gmail.com" });
    const row = rowOf(plan([e]), e);
    expect(row.actions).toEqual(["CREATE_USER"]);
    expect(row.after).toEqual({
      email: "carley.r@gmail.com",
      display_name: e.name,
      role: "salon_director",
      status: "invited",
      scope_level: "salon",
      scope_primary_area_id: "loc-0307",
      scope_also_covers_area_ids: [],
      provisioned_by_source: "woven",
      external_employee_id: e.externalEmployeeId,
      link_method: "provisioned",
      managed_status: true,
      managed_location: false,
      managed_role: false,
      invite: "supabase_invitation_to_woven_email",
    });
    expect(row.lifecycle).toBe("CREATE_USER");
  });

  it("an Assistant Salon Director is provisioned too; a personal email is allowed", () => {
    const e = employee({ positionId: POS.asd, positionName: "Assistant Salon Director", emailAddress: "asd@icloud.com" });
    expect(rowOf(plan([e]), e).actions).toEqual(["CREATE_USER"]);
  });

  it.each([
    ["Tanning Consultant", POS.tc],
    ["District Manager", POS.dm],
  ])("a %s gets NO account from Woven in this rollout", (_name, positionId) => {
    const e = employee({ positionId });
    const row = rowOf(plan([e]), e);
    expect(row.actions).toEqual(["NO_CHANGE"]);
    expect(row.reasons).toContain("position_not_auto_provisioned");
  });

  it("10. missing email → FLAG_MISSING_EMAIL, no account", () => {
    const e = employee({ emailAddress: null, issues: ["missing_email"] });
    expect(rowOf(plan([e]), e).actions).toEqual(["FLAG_MISSING_EMAIL"]);
  });

  it("11. unmapped position → FLAG_UNMAPPED_POSITION, no account, no role", () => {
    const e = employee({ positionId: POS.ops, positionName: "Operations" });
    const row = rowOf(plan([e]), e);
    expect(row.actions).toEqual(["FLAG_UNMAPPED_POSITION"]);
    expect(row.proposedRole).toBeNull();
    const noPosition = employee({ positionId: null, positionName: "No Position Set" });
    expect(rowOf(plan([noPosition]), noPosition).actions).toEqual(["FLAG_UNMAPPED_POSITION"]);
  });

  it("12. unmapped location → FLAG_UNMAPPED_LOCATION; Corporate (not a salon) likewise — never an invented salon", () => {
    const unmapped = employee({ primaryWovenLocationId: LOC.omahaQ });
    const corporate = employee({ primaryWovenLocationId: LOC.corporate });
    const unknownLocation = employee({ primaryWovenLocationId: "L-NEVER-SEEN" });
    const rows = plan([unmapped, corporate, unknownLocation]);
    expect(rowOf(rows, unmapped)).toMatchObject({ actions: ["FLAG_UNMAPPED_LOCATION"], reasons: ["primary_location_unmapped"], proposedPrimaryAreaId: null });
    expect(rowOf(rows, corporate)).toMatchObject({ actions: ["FLAG_UNMAPPED_LOCATION"], reasons: ["primary_location_not_a_salon"] });
    expect(rowOf(rows, unknownLocation).actions).toEqual(["FLAG_UNMAPPED_LOCATION"]);
    expect(mutating(rows)).toEqual([]);
  });

  it("9. duplicate email between two Woven employees → FLAG_DUPLICATE_EMAIL on both, no account", () => {
    const a = employee({ emailAddress: "shared@gmail.com" });
    const b = employee({ emailAddress: "SHARED@gmail.com" });
    const rows = plan([a, b]);
    expect(rowOf(rows, a).actions).toEqual(["FLAG_DUPLICATE_EMAIL"]);
    expect(rowOf(rows, b).actions).toEqual(["FLAG_DUPLICATE_EMAIL"]);
  });

  it("9b. a duplicated email that also names an account: flagged, never linked or merged", () => {
    const a = employee({ emailAddress: "shared@gmail.com" });
    const b = employee({ emailAddress: "shared@gmail.com" });
    const existing = account({ email: "shared@gmail.com" });
    const rows = plan([a, b], [existing]);
    for (const e of [a, b]) {
      expect(rowOf(rows, e).actions).toEqual(["FLAG_DUPLICATE_EMAIL"]);
      expect(rowOf(rows, e).actions).not.toContain("FLAG_LINK_REVIEW");
    }
  });

  it("an active Woven record with a past termination date is held for review, not provisioned", () => {
    const e = employee({ issues: ["status_termination_conflict"] });
    expect(rowOf(plan([e]), e).actions).toEqual(["FLAG_STATUS_CONFLICT"]);
  });
});

describe("identity and linking", () => {
  it("19. an existing manually-created account with the same exact email → LINK_EXISTING, never a second account; the account is not changed", () => {
    const e = employee({ emailAddress: "manager@gmail.com", primaryWovenLocationId: LOC.liberty });
    const manual = account({ email: "Manager@Gmail.com", primaryAreaId: "loc-0307" });
    const rows = plan([e], [manual]);
    const row = rowOf(rows, e);
    expect(row.actions).toEqual(["LINK_EXISTING"]);
    expect(row.lifecycle).toBe("LINK_EXISTING");
    expect(row.account).toMatchObject({ appUserId: manual.appUserId, via: "email_candidate" });
    expect(row.after).toEqual({
      external_employee_id: e.externalEmployeeId,
      link_method: "email_discovery",
      managed_status: true,
      managed_location: false,
      managed_role: false,
    });
    expect(mutating(rows)).toEqual(["LINK_EXISTING"]);
  });

  it("19c. LINK_EXISTING manages status only for a salon-level SD/ASD in an approved SD/ASD position; nothing for a DM", () => {
    const dmEmployee = employee({ emailAddress: "dm@gmail.com", positionId: POS.dm });
    const dmAccount = account({ email: "dm@gmail.com", role: "district_manager", scopeLevel: "global", primaryAreaId: null });
    const tcEmployee = employee({ emailAddress: "sd-but-tc@gmail.com", positionId: POS.tc });
    const sdAccount = account({ email: "sd-but-tc@gmail.com" });
    const rows = plan([dmEmployee, tcEmployee], [dmAccount, sdAccount]);
    expect(rowOf(rows, dmEmployee)).toMatchObject({ actions: ["LINK_EXISTING"], after: { managed_status: false, managed_location: false, managed_role: false } });
    expect(rowOf(rows, tcEmployee)).toMatchObject({ actions: ["LINK_EXISTING"], after: { managed_status: false } });
  });

  it.each([
    ["a protected (override) account", { override: { role: "admin" as const, scopeLevel: "global" as const, externalEmployeeId: null }, role: "admin" as const, scopeLevel: "global" as const, primaryAreaId: null }, {}, "FLAG_PROTECTED_ACCOUNT", "email_matches_protected_account"],
    ["an administrator account", { role: "admin" as const, scopeLevel: "global" as const, primaryAreaId: null }, {}, "FLAG_PROTECTED_ACCOUNT", "email_matches_protected_account"],
    ["an employee Terminated in Woven", {}, { employmentStatus: "terminated" as const }, "FLAG_LINK_REVIEW", "email_match_terminated_in_woven"],
    ["an employee not read this run", {}, { missingSyncCount: 2 }, "FLAG_LINK_REVIEW", "email_match_status_not_read_this_run"],
    ["an Active employee with a past termination date", {}, { issues: ["status_termination_conflict"] }, "FLAG_STATUS_CONFLICT", "email_match_held_for_review"],
    ["a disabled account", { status: "disabled" as const }, {}, "FLAG_STATUS_CONFLICT", "disabled_in_ask_sunny_active_in_woven"],
  ])("19d. an exact email match to %s is REVIEW_REQUIRED, never linked", (_name, accountOver, employeeOver, flag, reason) => {
    const e = employee({ emailAddress: "match@gmail.com", ...employeeOver });
    const a = account({ email: "match@gmail.com", ...accountOver });
    const rows = plan([e], [a]);
    const row = rowOf(rows, e);
    expect(row.actions).toEqual([flag]);
    expect(row.reasons).toContain(reason);
    expect(row.lifecycle).toBe("REVIEW_REQUIRED");
    expect(mutating(rows)).toEqual([]);
  });

  it("19e. ambiguous: two accounts or two Woven employees with the email → REVIEW_REQUIRED, never linked", () => {
    const e = employee({ emailAddress: "two@gmail.com" });
    const twins = [employee({ emailAddress: "twin@gmail.com" }), employee({ emailAddress: "TWIN@gmail.com" })];
    const rows = plan([e, ...twins], [account({ email: "twin@gmail.com" })]);
    for (const t of twins) expect(rowOf(rows, t)).toMatchObject({ actions: ["FLAG_DUPLICATE_EMAIL"], lifecycle: "REVIEW_REQUIRED" });
    expect(mutating(rows)).toEqual(["CREATE_USER"]);
  });

  it("19b. once the link is confirmed, the EmployeeID is authoritative and the plan acts on that account", () => {
    const e = employee({ emailAddress: "manager@gmail.com", primaryWovenLocationId: LOC.liberty });
    const confirmed = linkedTo(e, { primaryAreaId: "loc-0307" });
    expect(rowOf(plan([e], [confirmed]), e).actions).toEqual(["UPDATE_PRIMARY_LOCATION"]);
  });

  it("8. Woven email changes for the same linked EmployeeID → same account, FLAG_EMAIL_CHANGE_REVIEW, never a new account", () => {
    const e = employee({ emailAddress: "new.address@gmail.com" });
    const linked = linkedTo(e, { email: "old.address@gmail.com" });
    const rows = plan([e], [linked]);
    const row = rowOf(rows, e);
    expect(row.account?.appUserId).toBe(linked.appUserId);
    expect(row.actions).toEqual(["FLAG_EMAIL_CHANGE_REVIEW"]);
    expect(mutating(rows)).toEqual([]);
    expect(rows.filter((r) => r.account?.appUserId === linked.appUserId)).toHaveLength(1);
  });

  it("a linked account is never re-matched by email to a different Woven employee", () => {
    const owner = employee({ emailAddress: "a@gmail.com" });
    const other = employee({ emailAddress: "b@gmail.com" });
    const linked = linkedTo(owner, { email: "b@gmail.com" });
    const rows = plan([owner, other], [linked]);
    expect(rowOf(rows, other).actions).toEqual(["FLAG_DUPLICATE_EMAIL"]);
    expect(rowOf(rows, other).reasons).toContain("email_matches_account_linked_to_another_employee");
  });

  it("an account marked NOT managed by Woven is never acted on — even when a Woven employee shares its email", () => {
    const e = employee({ emailAddress: "external@vendor.com" });
    const external = account({ email: "external@vendor.com", management: "not_woven_managed", role: "admin", scopeLevel: "global", primaryAreaId: null });
    const rows = plan([e], [external]);
    expect(rowOf(rows, e).actions).toEqual(["FLAG_NOT_WOVEN_MANAGED"]);
    expect(mutating(rows)).toEqual([]);
  });

  it("an account absent from Woven: not-woven-managed or unclassified is reported, never disabled", () => {
    const marked = account({ management: "not_woven_managed" });
    const unclassified = account();
    const rows = plan([], [marked, unclassified]);
    expect(rows.find((r) => r.appUserId === marked.appUserId)).toMatchObject({ actions: ["FLAG_NOT_WOVEN_MANAGED"], reasons: ["marked_not_woven_managed"] });
    expect(rows.find((r) => r.appUserId === unclassified.appUserId)).toMatchObject({ actions: ["FLAG_NOT_WOVEN_MANAGED"], reasons: ["unclassified_no_woven_match"] });
    expect(mutating(rows)).toEqual([]);
  });

  it("a linked account whose employee is no longer in the directory is flagged, not disabled", () => {
    const linked = account({ management: "woven_linked", linkedExternalEmployeeId: "GONE", managedStatus: true });
    const rows = plan([], [linked]);
    expect(rows[0]!.actions).toEqual(["FLAG_LINKED_EMPLOYEE_NOT_FOUND"]);
  });
});

describe("matching accounts", () => {
  it("2. active employee whose linked account already matches → NO_CHANGE", () => {
    const e = employee();
    const row = rowOf(plan([e], [linkedTo(e)]), e);
    expect(row.actions).toEqual(["NO_CHANGE"]);
    expect(row.reasons).toContain("in_sync_with_woven");
  });
});

describe("primary location", () => {
  it("3 / 14. primary location changes (0314 → 0394) → UPDATE_PRIMARY_LOCATION, old → new, and nothing else", () => {
    const e = employee({ primaryWovenLocationId: LOC.liberty, primaryLocationName: "KC Liberty" });
    const linked = linkedTo(e, { primaryAreaId: "loc-0314", alsoCoversAreaIds: ["loc-0307"] });
    const row = rowOf(plan([e], [linked]), e);
    /* The hand-granted extra salon is flagged, never changed: only the primary moves. */
    expect(row.actions).toEqual(["UPDATE_PRIMARY_LOCATION", "FLAG_LOCATION_REVIEW"]);
    expect(row.reasons).toContain("extra_salons_not_granted_by_woven");
    expect(row.before).toEqual({ scope_primary_area_id: "loc-0314" });
    expect(row.after).toEqual({ scope_primary_area_id: "loc-0394" });
    /* The old primary is REPLACED (not added); also-covers and role are not in the change at all. */
    expect(JSON.stringify(row.after)).not.toMatch(/also_covers|role/);
  });

  it("3b. a primary location change with no extra salons is UPDATE_PRIMARY_LOCATION and nothing else", () => {
    const e = employee({ primaryWovenLocationId: LOC.liberty, primaryLocationName: "KC Liberty" });
    const row = rowOf(plan([e], [linkedTo(e, { primaryAreaId: "loc-0314" })]), e);
    expect(row.actions).toEqual(["UPDATE_PRIMARY_LOCATION"]);
  });

  it("3c. extra salons on an otherwise in-sync salon-tier account are flagged for review, never removed", () => {
    const e = employee();
    const linked = linkedTo(e, { alsoCoversAreaIds: ["loc-0306", "loc-0462"] });
    const rows = plan([e], [linked]);
    expect(rowOf(rows, e).actions).toEqual(["FLAG_LOCATION_REVIEW"]);
    expect(rowOf(rows, e).reasons).toEqual(["extra_salons_not_granted_by_woven"]);
    expect(rowOf(rows, e).account?.extraSalonCount).toBe(2);
    expect(mutating(rows)).toEqual([]);
  });

  it("4 / 23. additional or temporary locations change → primary salon unchanged, no action", () => {
    const e = employee({ additionalLocationNames: ["KC Liberty", "NE Omaha Center"] });
    const row = rowOf(plan([e], [linkedTo(e)]), e);
    expect(row.actions).toEqual(["NO_CHANGE"]);
    expect(row.proposedPrimaryAreaId).toBe("loc-0307");
    expect(row.wovenAdditionalLocations).toEqual(["KC Liberty", "NE Omaha Center"]);
  });

  it("a location difference on an account whose location is not Woven-managed is flagged, not changed", () => {
    const e = employee({ primaryWovenLocationId: LOC.liberty });
    const row = rowOf(plan([e], [linkedTo(e, { managedLocation: false })]), e);
    expect(row.actions).toEqual(["FLAG_LOCATION_REVIEW"]);
  });

  it("12b. a linked manager whose Woven primary becomes unmapped keeps their salon; flagged", () => {
    const e = employee({ primaryWovenLocationId: LOC.omahaQ });
    const row = rowOf(plan([e], [linkedTo(e)]), e);
    expect(row.actions).toEqual(["FLAG_UNMAPPED_LOCATION"]);
  });

  it("22. District Manager, Regional Manager and admin accounts are NEVER narrowed to a salon by Woven's primary location", () => {
    const cases = [
      { role: "district_manager", scopeLevel: "global", positionId: POS.dm },
      { role: "district_manager", scopeLevel: "district", positionId: POS.dm },
      { role: "regional_manager", scopeLevel: "global", positionId: POS.ops },
      { role: "regional_manager", scopeLevel: "region", positionId: POS.dm },
    ] as const;
    for (const c of cases) {
      const e = employee({ positionId: c.positionId, primaryWovenLocationId: LOC.grandIsland });
      const senior = linkedTo(e, { role: c.role, scopeLevel: c.scopeLevel, primaryAreaId: c.scopeLevel === "global" ? null : "dist-x" });
      const rows = plan([e], [senior]);
      expect(mutating(rows), `${c.role}/${c.scopeLevel}`).toEqual([]);
      expect(rowOf(rows, e).actions).not.toContain("UPDATE_PRIMARY_LOCATION");
    }
  });

  it("a Salon Director whose account was given a wider scope by hand is not narrowed either", () => {
    const e = employee();
    const rows = plan([e], [linkedTo(e, { scopeLevel: "district", primaryAreaId: "dist-patterson-madeline" })]);
    expect(mutating(rows)).toEqual([]);
    expect(rowOf(rows, e).reasons).toContain("scope_above_salon_level_not_managed_by_woven");
  });
});

describe("role", () => {
  it("15. Assistant Salon Director → Salon Director (approved mapping, role managed) → UPDATE_ROLE", () => {
    const e = employee({ positionId: POS.sd });
    const linked = linkedTo(e, { role: "assistant_salon_director" });
    const row = rowOf(plan([e], [linked]), e);
    expect(row.actions).toEqual(["UPDATE_ROLE"]);
    expect(row.before).toEqual({ role: "assistant_salon_director" });
    expect(row.after).toEqual({ role: "salon_director" });
  });

  it("15b. a promotion OUT of the salon tier (Salon Director → District Manager) is review only, and holds the location too", () => {
    const e = employee({ positionId: POS.dm, primaryWovenLocationId: LOC.liberty });
    const row = rowOf(plan([e], [linkedTo(e)]), e);
    expect(row.actions).toEqual(["FLAG_ROLE_REVIEW"]);
    expect(row.reasons).toContain("woven_position_outside_automatic_tier");
  });

  it("15c. Tanning Consultant is in the salon tier (6 Oct policy): SD → employee is an UPDATE_ROLE only when role is Woven-managed", () => {
    const e = employee({ positionId: POS.tc });
    expect(rowOf(plan([e], [linkedTo(e)]), e).actions).toEqual(["UPDATE_ROLE"]);
    expect(rowOf(plan([e], [linkedTo(e)]), e).after).toEqual({ role: "employee" });
    expect(rowOf(plan([e], [linkedTo(e, { managedRole: false })]), e).actions).toEqual(["FLAG_ROLE_REVIEW"]);
  });

  it("15d. a move out of the salon tier (to District Manager) is review only — never automatic, and holds the location", () => {
    const e = employee({ positionId: POS.dm, primaryWovenLocationId: LOC.liberty });
    const rows = plan([e], [linkedTo(e, { primaryAreaId: "loc-0314" })]);
    expect(rowOf(rows, e).actions).toEqual(["FLAG_ROLE_REVIEW"]);
    expect(rowOf(rows, e).reasons).toContain("woven_position_outside_automatic_tier");
    expect(mutating(rows)).toEqual([]);
  });

  it("11b. a linked manager whose position becomes unmapped keeps their role; flagged", () => {
    const e = employee({ positionId: POS.ops });
    const rows = plan([e], [linkedTo(e)]);
    expect(rowOf(rows, e).actions).toEqual(["FLAG_UNMAPPED_POSITION"]);
    expect(mutating(rows)).toEqual([]);
  });

  it("a role difference on an account whose role is not Woven-managed is flagged", () => {
    const e = employee({ positionId: POS.sd });
    expect(rowOf(plan([e], [linkedTo(e, { role: "assistant_salon_director", managedRole: false })]), e).actions).toEqual(["FLAG_ROLE_REVIEW"]);
  });
});

describe("termination", () => {
  it("5. Terminated in Woven, linked, status Woven-managed → DISABLE_TERMINATED (ban + sessions + disabled)", () => {
    const e = employee({ employmentStatus: "terminated", terminationDate: "2026-10-01" });
    const row = rowOf(plan([e], [linkedTo(e)]), e);
    expect(row.actions).toEqual(["DISABLE_TERMINATED"]);
    expect(row.before).toEqual({ status: "active" });
    expect(row.after).toEqual({ status: "disabled", auth_ban: true, sessions_revoked: true, terminated_on: "2026-10-01" });
  });

  it("missing from Woven is review only — NEVER a termination", () => {
    const e = employee({ missingSyncCount: 3 });
    const rows = plan([e], [linkedTo(e)]);
    expect(rowOf(rows, e).actions).toEqual(["FLAG_MISSING_FROM_WOVEN"]);
    /* Even if the last status on file was Terminated: not read this run, so not acted on. */
    const stale = employee({ employmentStatus: "terminated", missingSyncCount: 1 });
    expect(rowOf(plan([stale], [linkedTo(stale)]), stale).actions).toEqual(["FLAG_MISSING_FROM_WOVEN"]);
  });

  it("13. unknown Woven status → FLAG_UNKNOWN_STATUS, fail closed: no disable, no change", () => {
    const e = employee({ employmentStatus: "unknown" });
    const rows = plan([e], [linkedTo(e)]);
    expect(rowOf(rows, e).actions).toEqual(["FLAG_UNKNOWN_STATUS"]);
    expect(mutating(rows)).toEqual([]);
  });

  it("a protected (override) or administrative account terminated in Woven is flagged, never disabled automatically", () => {
    const a = employee({ employmentStatus: "terminated" });
    const b = employee({ employmentStatus: "terminated" });
    const rows = plan(
      [a, b],
      [
        linkedTo(a, { role: "admin", scopeLevel: "global", primaryAreaId: null, override: { role: "admin", scopeLevel: "global", externalEmployeeId: a.externalEmployeeId } }),
        linkedTo(b, { role: "admin", scopeLevel: "global", primaryAreaId: null }),
      ],
    );
    expect(rowOf(rows, a).actions).toEqual(["FLAG_PROTECTED_ACCOUNT"]);
    expect(rowOf(rows, b).actions).toEqual(["FLAG_PROTECTED_ACCOUNT"]);
  });

  it("a linked account whose status is NOT Woven-managed (e.g. a linked District Manager) is flagged on termination", () => {
    const e = employee({ employmentStatus: "terminated", positionId: POS.dm });
    const row = rowOf(plan([e], [linkedTo(e, { role: "district_manager", scopeLevel: "global", primaryAreaId: null, managedStatus: false })]), e);
    expect(row.actions).toEqual(["FLAG_PROTECTED_ACCOUNT"]);
    expect(row.reasons).toContain("terminated_in_woven_status_not_woven_managed");
  });

  it("already revoked → NO_CHANGE (idempotent)", () => {
    const e = employee({ employmentStatus: "terminated" });
    const row = rowOf(plan([e], [linkedTo(e, { status: "disabled", accessRevokedAt: "2026-10-02T12:00:00Z", terminatedAt: "2026-10-02T12:00:00Z" })]), e);
    expect(row.actions).toEqual(["NO_CHANGE"]);
    expect(row.reasons).toContain("access_already_revoked");
  });

  it("a terminated employee with no account needs nothing", () => {
    const e = employee({ employmentStatus: "terminated" });
    expect(rowOf(plan([e]), e).actions).toEqual(["NO_CHANGE"]);
  });
});

describe("rehire", () => {
  it("16. revoked because Woven said Terminated, now Active again → FLAG_REHIRE_REVIEW only; never re-enabled", () => {
    const e = employee({ primaryWovenLocationId: LOC.liberty, positionId: POS.asd });
    const revoked = linkedTo(e, { status: "disabled", accessRevokedAt: "2026-09-01T00:00:00Z", terminatedAt: "2026-09-01T00:00:00Z" });
    const rows = plan([e], [revoked]);
    expect(rowOf(rows, e).actions).toEqual(["FLAG_REHIRE_REVIEW"]);
    expect(mutating(rows)).toEqual([]);
  });

  it("an account disabled by hand while Woven says Active is flagged, never re-enabled", () => {
    const e = employee();
    expect(rowOf(plan([e], [linkedTo(e, { status: "disabled" })]), e).actions).toEqual(["FLAG_STATUS_CONFLICT"]);
  });
});

describe("idempotency", () => {
  function estate() {
    seq = 500;
    const create = employee();
    const move = employee({ primaryWovenLocationId: LOC.liberty });
    const promote = employee({ positionId: POS.sd });
    const leave = employee({ employmentStatus: "terminated" });
    const steady = employee();
    const employees = [create, move, promote, leave, steady];
    const accounts = [
      linkedTo(move, { primaryAreaId: "loc-0314" }),
      linkedTo(promote, { role: "assistant_salon_director" }),
      linkedTo(leave),
      linkedTo(steady),
    ];
    return { employees, accounts };
  }

  it("17. the same input planned ten times gives the same plan", () => {
    const { employees, accounts } = estate();
    const first = planAccess({ employees, positions, locations, accounts });
    for (let i = 0; i < 9; i += 1) expect(planAccess({ employees, positions, locations, accounts })).toEqual(first);
  });

  it("17b. after the planned actions are applied, planning the same Woven payload again proposes ZERO mutations", () => {
    const { employees, accounts } = estate();
    const first = planAccess({ employees, positions, locations, accounts });
    expect(mutating(first).sort()).toEqual(["CREATE_USER", "DISABLE_TERMINATED", "UPDATE_PRIMARY_LOCATION", "UPDATE_ROLE"]);
    let state = accounts;
    for (let i = 0; i < 10; i += 1) {
      const rows = planAccess({ employees, positions, locations, accounts: state });
      state = simulateApply(rows, state, employees);
    }
    expect(mutating(planAccess({ employees, positions, locations, accounts: state }))).toEqual([]);
    /* And no duplicate account was ever "created". */
    expect(state.filter((a) => a.linkedExternalEmployeeId === employees[0]!.externalEmployeeId)).toHaveLength(1);
  });

  it("input order does not change the plan", () => {
    const { employees, accounts } = estate();
    expect(planAccess({ employees: [...employees].reverse(), positions, locations, accounts: [...accounts].reverse() })).toEqual(
      planAccess({ employees, positions, locations, accounts }),
    );
  });
});

/* -------------------------------------------------------------- guards -- */

const NOW = new Date("2026-10-02T12:00:00Z");
const run = (overrides: Partial<DirectoryRunFacts> = {}): DirectoryRunFacts => ({
  status: "succeeded",
  finishedAt: "2026-10-02T11:18:00Z",
  employeesActive: 150,
  issueCounts: {},
  ...overrides,
});
const healthy = { mappings: { mappedLocations: 15, confirmedPositions: 4 }, mappingBaseline: { mappedLocations: 15, confirmedPositions: 4 }, now: NOW };

describe("the mass-change guards", () => {
  it("a healthy read and a small plan allow mutations", () => {
    const e = employee({ primaryWovenLocationId: LOC.liberty });
    const result = evaluateAccessGuards({ rows: plan([e], [linkedTo(e, { primaryAreaId: "loc-0314" })]), runs: [run(), run()], ...healthy });
    expect(result).toMatchObject({ mutationsAllowed: true, codes: [] });
  });

  it.each([
    ["no successful directory sync", [] as DirectoryRunFacts[], "no_successful_directory_sync"],
    ["the latest run failed", [run({ status: "failed" }), run()], "latest_directory_run_not_successful"],
    ["the directory is stale", [run({ finishedAt: "2026-09-30T11:18:00Z" })], "directory_sync_stale"],
    ["status enum unresolved", [run({ issueCounts: { enums_unavailable: 1 } })], "status_enum_unresolved"],
    ["terminated read failed", [run({ issueCounts: { terminated_status_read_failed_request_rejected: 1 } })], "terminated_read_failed"],
    ["terminated read skipped", [run({ issueCounts: { terminated_status_read_skipped_no_code: 1 } })], "terminated_read_failed"],
    ["active count dropped", [run({ employeesActive: 100 }), run({ employeesActive: 150 })], "active_count_dropped"],
  ])("%s → mutations blocked", (_name, runs, code) => {
    const e = employee();
    const result = evaluateAccessGuards({ rows: plan([e], [linkedTo(e)]), runs, ...healthy });
    expect(result.mutationsAllowed).toBe(false);
    expect(result.codes).toContain(code);
  });

  it("Woven unexpectedly shows zero active employees → blocked", () => {
    const rows = plan(Array.from({ length: 5 }, () => employee({ employmentStatus: "terminated" })));
    expect(evaluateAccessGuards({ rows, runs: [run(), run()], ...healthy }).codes).toContain("zero_active_employees");
  });

  it("terminations above max(3, 5%) → blocked", () => {
    const leavers = Array.from({ length: 4 }, () => employee({ employmentStatus: "terminated" }));
    const stayers = Array.from({ length: 20 }, () => employee());
    const rows = plan([...leavers, ...stayers], [...leavers, ...stayers].map((e) => linkedTo(e)));
    const result = evaluateAccessGuards({ rows, runs: [run(), run()], ...healthy });
    expect(countActions(rows).DISABLE_TERMINATED).toBe(4);
    expect(result.codes).toContain("terminations_exceed_threshold");
  });

  it("24. a location MAPPING change that would move a whole salon's managers is visible and blocked", () => {
    const managers = Array.from({ length: 6 }, () => employee({ primaryWovenLocationId: LOC.grandIsland }));
    const accounts = managers.map((e) => linkedTo(e, { primaryAreaId: "loc-0307" }));
    const steady = plan(managers, accounts);
    expect(mutating(steady)).toEqual([]);

    /* Someone re-maps the Grand Island Woven location to salon 0394 by mistake. */
    const remapped = locations.map((l) => (l.wovenLocationId === LOC.grandIsland ? { ...l, salonNumber: "0394" } : l));
    const rows = planAccess({ employees: managers, positions, locations: remapped, accounts });
    expect(countActions(rows).UPDATE_PRIMARY_LOCATION).toBe(6);
    expect(rows.every((r) => r.after?.scope_primary_area_id === salonAreaId("0394"))).toBe(true);
    const result = evaluateAccessGuards({ rows, runs: [run(), run()], ...healthy });
    expect(result.codes).toContain("location_moves_exceed_threshold");
    expect(result.details).toMatchObject({ locationMoves: 6, locationMoveLimit: ACCESS_GUARD_LIMITS.maxLocationMoves.absolute });
  });

  it("mappings that suddenly disappear → blocked", () => {
    const e = employee();
    const rows = plan([e], [linkedTo(e)]);
    expect(evaluateAccessGuards({ rows, runs: [run()], ...healthy, mappings: { mappedLocations: 3, confirmedPositions: 4 } }).codes).toContain(
      "mappings_disappeared",
    );
    expect(
      evaluateAccessGuards({ rows, runs: [run()], now: NOW, mappingBaseline: null, mappings: { mappedLocations: 0, confirmedPositions: 0 } }).codes,
    ).toContain("mappings_disappeared");
  });

  it("Auth users that could not be read block every CREATE_USER (auth_users_unverified)", async () => {
    const { buildAccessPlan } = await import("./build");
    const e = employee();
    const plan = buildAccessPlan({ employees: [e], positions, locations, accounts: [], authOnly: null }, { runs: [run(), run()], mappingBaseline: null, directoryRunId: null, now: NOW });
    expect(plan.guard.codes).toContain("auth_users_unverified");
    expect(plan.guard.mutationsAllowed).toBe(false);
  });

  it("more than the create batch limit → blocked", () => {
    const rows = plan(Array.from({ length: ACCESS_GUARD_LIMITS.maxCreates + 1 }, () => employee()));
    expect(evaluateAccessGuards({ rows, runs: [run()], ...healthy }).codes).toContain("creates_exceed_batch_limit");
  });
});

describe("the vocabulary matches the database", () => {
  it("every action is in the employee_access_actions CHECK constraint, and nothing else is", () => {
    /* The latest definition of the constraint: the lifecycle migration replaces stage 1's. */
    const sql = readFileSync("supabase/migrations/20261006002000_woven_account_lifecycle.sql", "utf8");
    const block = sql.slice(sql.indexOf("add constraint employee_access_actions_action_check"));
    const listed = [...block.slice(0, block.indexOf("))")).matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]).sort();
    expect(listed).toEqual([...ACCESS_ACTIONS].sort());
  });
});
