import { describe, expect, it, vi } from "vitest";

import { automaticInviteRedirectTarget } from "@/lib/admin/redirect-target";
import { ROLES } from "@/lib/permissions";
import type { Role } from "@/types";

import { applyAccessLifecycle, type ApplyDeps } from "./apply";
import { buildAccessPlan } from "./build";
import type { WovenAccessConfig } from "./config";
import { AUTO_PROVISION_ROLES, planAccess } from "./plan";
import type { PlannedRow, PlannerAccount, PlannerEmployee, PlannerInput, SalonAreaFact } from "./types";

/**
 * ============================================================================
 * AUTOMATIC WOVEN INVITATIONS ARE FOR ASD, SD, DM AND RM — AND NOBODY ELSE
 * ============================================================================
 *
 * The matrix of the 15 Oct 2026 instruction: each eligible role on its own,
 * multiple locations, every excluded role (never invited), every unmapped /
 * unknown input (never invited), and the apply layer's own role gate.
 */

const NOW = new Date("2026-10-15T12:00:00Z");

const ROLE_FOR: Record<string, Role> = { ASD: "assistant_salon_director", SD: "salon_director", DM: "district_manager", RM: "regional_manager" };
const positions: PlannerInput["positions"] = [
  { wovenPositionId: "P-ASD", status: "mapped", isConfirmed: true, role: "assistant_salon_director", scopeLevel: "salon" },
  { wovenPositionId: "P-SD", status: "mapped", isConfirmed: true, role: "salon_director", scopeLevel: "salon" },
  { wovenPositionId: "P-DM", status: "mapped", isConfirmed: true, role: "district_manager", scopeLevel: "district" },
  { wovenPositionId: "P-RM", status: "mapped", isConfirmed: true, role: "regional_manager", scopeLevel: "region" },
  /* excluded, even though confirmed and mapped */
  { wovenPositionId: "P-TC", status: "mapped", isConfirmed: true, role: "employee", scopeLevel: "salon" },
  { wovenPositionId: "P-ADMIN", status: "mapped", isConfirmed: true, role: "admin", scopeLevel: "global" },
  { wovenPositionId: "P-OWNER", status: "mapped", isConfirmed: true, role: "owner", scopeLevel: "global" },
  { wovenPositionId: "P-DEV", status: "mapped", isConfirmed: true, role: "developer", scopeLevel: "global" },
  /* excluded because not approved */
  { wovenPositionId: "P-UNCONF", status: "mapped", isConfirmed: false, role: "salon_director", scopeLevel: "salon" },
  { wovenPositionId: "P-UNMAPPED", status: "unmapped", isConfirmed: false, role: null, scopeLevel: null },
  { wovenPositionId: "P-IGNORED", status: "ignored", isConfirmed: false, role: null, scopeLevel: null },
];
const locations: PlannerInput["locations"] = [
  { wovenLocationId: "L-0307", status: "mapped", salonNumber: "0307", name: "NE Grand Island" },
  { wovenLocationId: "L-0309", status: "mapped", salonNumber: "0309", name: "NE Kearney" },
  { wovenLocationId: "L-0313", status: "mapped", salonNumber: "0313", name: "NE Omaha 132nd" },
  { wovenLocationId: "L-0394", status: "mapped", salonNumber: "0394", name: "MO KC Liberty" },
  { wovenLocationId: "L-X", status: "mapped", salonNumber: "0999", name: "Salon missing from reporting" },
  { wovenLocationId: "L-CORP", status: "ignored", salonNumber: null, name: "Corporate" },
  { wovenLocationId: "L-Q", status: "unmapped", salonNumber: null, name: "NE Omaha Q" },
];
/* 0307 + 0309 = district Dugan; 0313 = district Cotton; 0394 = district Patterson; Dugan/Cotton/Patterson share one region; 0888 is another region. */
const salonAreas: SalonAreaFact[] = [
  { salonNumber: "0307", districtId: "dist-dugan", regionId: "reg-one" },
  { salonNumber: "0309", districtId: "dist-dugan", regionId: "reg-one" },
  { salonNumber: "0313", districtId: "dist-cotton", regionId: "reg-one" },
  { salonNumber: "0394", districtId: "dist-patterson", regionId: "reg-two" },
];

let seq = 0;
const employee = (over: Partial<PlannerEmployee> = {}): PlannerEmployee => {
  seq += 1;
  return {
    externalEmployeeId: `E${seq}`,
    name: `Person ${seq}`,
    emailAddress: `person${seq}@example.test`,
    employmentStatus: "active",
    missingSyncCount: 0,
    positionId: "P-SD",
    positionName: "Salon Director",
    primaryWovenLocationId: "L-0307",
    primaryLocationName: "NE Grand Island",
    additionalLocationNames: [],
    additionalLocationIds: [],
    temporaryLocationIds: [],
    issues: [],
    terminationDate: null,
    lastSyncedAt: "2026-10-15T11:00:00Z",
    ...over,
  };
};
const plan = (employees: PlannerEmployee[], over: Partial<PlannerInput> = {}) => planAccess({ employees, positions, locations, accounts: [], salonAreas, ...over });
const rowOf = (rows: PlannedRow[], e: PlannerEmployee) => rows.find((r) => r.key === `employee:${e.externalEmployeeId}`)!;
const creates = (rows: PlannedRow[]) => rows.filter((r) => r.actions.includes("CREATE_USER"));

describe("each eligible role, on its own", () => {
  it.each([
    ["ASD", "P-ASD", "salon", "loc-0307"],
    ["SD", "P-SD", "salon", "loc-0307"],
    ["DM", "P-DM", "district", "dist-dugan"],
    ["RM", "P-RM", "region", "reg-one"],
  ])("%s → CREATE_USER with %s scope at %s, nothing also-covered", (name, positionId, level, area) => {
    const e = employee({ positionId });
    const row = rowOf(plan([e]), e);
    expect(row.actions).toEqual(["CREATE_USER"]);
    expect(row.lifecycle).toBe("CREATE_USER");
    expect(row.after).toMatchObject({
      email: e.emailAddress,
      role: ROLE_FOR[name],
      scope_level: level,
      scope_primary_area_id: area,
      scope_also_covers_area_ids: [],
      external_employee_id: e.externalEmployeeId,
      managed_status: true,
      managed_location: false,
      managed_role: false,
    });
  });

  it("the allowlist is exactly four roles", () => {
    expect([...AUTO_PROVISION_ROLES].sort()).toEqual(["assistant_salon_director", "district_manager", "regional_manager", "salon_director"]);
  });
});

describe("employees with several locations", () => {
  it("SD / ASD: every approved ADDITIONAL salon is granted as also-covers (temporary ones are not); the primary stays the primary", () => {
    for (const positionId of ["P-SD", "P-ASD"]) {
      const e = employee({ positionId, additionalLocationIds: ["L-0309", "L-0394"], temporaryLocationIds: ["L-0313"] });
      const row = rowOf(plan([e]), e);
      expect(row.actions).toEqual(["CREATE_USER"]);
      expect(row.after).toMatchObject({
        scope_level: "salon",
        scope_primary_area_id: "loc-0307",
        scope_also_covers_area_ids: ["loc-0309", "loc-0394"],
        salon_numbers: ["0307", "0309", "0394"],
        additional_salon_numbers: ["0309", "0394"],
        locations_ignored_or_temporary: 1,
      });
    }
  });

  it("DM / RM whose salon reporting moved between its two newest periods are HELD, not granted a whole district / region", () => {
    const moved: SalonAreaFact[] = salonAreas.map((a) => (a.salonNumber === "0307" ? { ...a, districtStable: false, regionStable: false } : a));
    const dm = employee({ positionId: "P-DM" });
    const rm = employee({ positionId: "P-RM" });
    const rows = plan([dm, rm], { salonAreas: moved });
    expect(rowOf(rows, dm)).toMatchObject({ actions: ["FLAG_LOCATION_REVIEW"], reasons: ["salon_district_changed_recently"] });
    expect(rowOf(rows, rm)).toMatchObject({ actions: ["FLAG_LOCATION_REVIEW"], reasons: ["salon_region_changed_recently"] });
    /* An unmoved salon in the same fixture is fine; a Salon Director never needs reporting's areas. */
    const sd = employee({ primaryWovenLocationId: "L-0307" });
    expect(rowOf(plan([sd], { salonAreas: moved }), sd).actions).toEqual(["CREATE_USER"]);
  });

  it("DM with several salons in ONE district → district scope; spanning districts → held for a person, nothing invited", () => {
    const same = employee({ positionId: "P-DM", additionalLocationIds: ["L-0309"] });
    const span = employee({ positionId: "P-DM", additionalLocationIds: ["L-0313"] });
    const rows = plan([same, span]);
    expect(rowOf(rows, same).after).toMatchObject({ scope_level: "district", scope_primary_area_id: "dist-dugan", scope_also_covers_area_ids: [], salon_numbers: ["0307", "0309"] });
    expect(rowOf(rows, span)).toMatchObject({ actions: ["FLAG_LOCATION_REVIEW"], reasons: ["locations_span_several_districts"], lifecycle: "REVIEW_REQUIRED" });
  });

  it("RM with salons in several districts of one region → region scope; spanning regions → held", () => {
    const one = employee({ positionId: "P-RM", additionalLocationIds: ["L-0309", "L-0313"] });
    const two = employee({ positionId: "P-RM", additionalLocationIds: ["L-0394"] });
    const rows = plan([one, two]);
    expect(rowOf(rows, one).after).toMatchObject({ scope_level: "region", scope_primary_area_id: "reg-one", scope_also_covers_area_ids: [] });
    expect(rowOf(rows, two)).toMatchObject({ actions: ["FLAG_LOCATION_REVIEW"], reasons: ["locations_span_several_regions"] });
  });

  it("an unmapped, unknown or non-salon ADDITIONAL location blocks the invitation; an ignored one (Corporate) grants nothing and does not", () => {
    const unmapped = employee({ additionalLocationIds: ["L-Q"] });
    const unknown = employee({ additionalLocationIds: ["L-NEVER-SEEN"] });
    const corporate = employee({ additionalLocationIds: ["L-CORP"] });
    const rows = plan([unmapped, unknown, corporate]);
    expect(rowOf(rows, unmapped)).toMatchObject({ actions: ["FLAG_UNMAPPED_LOCATION"], reasons: ["additional_location_unmapped"] });
    expect(rowOf(rows, unknown)).toMatchObject({ actions: ["FLAG_UNMAPPED_LOCATION"], reasons: ["additional_location_unmapped"] });
    expect(rowOf(rows, corporate).actions).toEqual(["CREATE_USER"]);
    expect(rowOf(rows, corporate).after).toMatchObject({ scope_primary_area_id: "loc-0307", additional_salon_numbers: [], locations_ignored_or_temporary: 1 });
  });

  it("DM / RM fail CLOSED when reporting cannot say which district / region a salon is in", () => {
    const dm = employee({ positionId: "P-DM" });
    const rm = employee({ positionId: "P-RM" });
    for (const salonAreas of [null, undefined, [] as SalonAreaFact[]]) {
      const rows = plan([dm, rm], { salonAreas });
      expect(creates(rows)).toEqual([]);
      expect(rowOf(rows, dm).actions).toEqual(["FLAG_LOCATION_REVIEW"]);
      expect(rowOf(rows, rm).actions).toEqual(["FLAG_LOCATION_REVIEW"]);
    }
    const missing = employee({ positionId: "P-DM", primaryWovenLocationId: "L-X", primaryLocationName: "x" });
    expect(rowOf(plan([missing]), missing)).toMatchObject({ actions: ["FLAG_LOCATION_REVIEW"], reasons: ["salon_district_unknown"] });
    /* SD / ASD never need reporting's areas. */
    const sd = employee();
    expect(rowOf(plan([sd], { salonAreas: null }), sd).actions).toEqual(["CREATE_USER"]);
  });

  it("no usable primary location → nothing, for every eligible role", () => {
    const rows = plan(["P-ASD", "P-SD", "P-DM", "P-RM"].flatMap((positionId) => [employee({ positionId, primaryWovenLocationId: null, primaryLocationName: null }), employee({ positionId, primaryWovenLocationId: "L-CORP" }), employee({ positionId, primaryWovenLocationId: "L-Q" })]));
    expect(creates(rows)).toEqual([]);
    expect(rows.every((r) => r.actions.includes("FLAG_UNMAPPED_LOCATION"))).toBe(true);
  });
});

describe("excluded roles NEVER receive an automatic invitation", () => {
  const excluded: [string, string][] = [
    ["Tanning Consultant (employee)", "P-TC"],
    ["admin", "P-ADMIN"],
    ["owner", "P-OWNER"],
    ["developer", "P-DEV"],
    ["a mapped position that was never confirmed", "P-UNCONF"],
    ["an unmapped position", "P-UNMAPPED"],
    ["an ignored position", "P-IGNORED"],
    ["an unknown position id", "P-NEVER-SEEN"],
  ];

  it.each(excluded)("%s → no CREATE_USER, nothing mutating at all", (_name, positionId) => {
    const e = employee({ positionId, additionalLocationIds: ["L-0309"] });
    const row = rowOf(plan([e]), e);
    expect(row.actions).not.toContain("CREATE_USER");
    expect(row.lifecycle).not.toBe("CREATE_USER");
  });

  it("a person with NO position at all → no CREATE_USER", () => {
    const e = employee({ positionId: null, positionName: null });
    expect(rowOf(plan([e]), e).actions).not.toContain("CREATE_USER");
  });

  it("for every Ask Sunny role: only the four eligible ones can ever be created", () => {
    const eligible = new Set<Role>(AUTO_PROVISION_ROLES);
    for (const role of ROLES) {
      const pos: PlannerInput["positions"] = [{ wovenPositionId: "P", status: "mapped", isConfirmed: true, role, scopeLevel: "salon" }];
      const e = employee({ positionId: "P" });
      const rows = planAccess({ employees: [e], positions: pos, locations, accounts: [], salonAreas });
      expect(rows.some((r) => r.actions.includes("CREATE_USER")), role).toBe(eligible.has(role));
    }
  });

  it("an eligible role that fails ANY other requirement is not invited (missing email, terminated, unknown status)", () => {
    const noEmail = employee({ emailAddress: null, issues: ["missing_email"] });
    const badEmail = employee({ emailAddress: "not-an-email", issues: ["invalid_email"] });
    const terminated = employee({ employmentStatus: "terminated" });
    const unknown = employee({ employmentStatus: "unknown" });
    const rows = plan([noEmail, badEmail, terminated, unknown]);
    expect(creates(rows)).toEqual([]);
    expect(rowOf(rows, noEmail).actions).toEqual(["FLAG_MISSING_EMAIL"]);
    expect(rowOf(rows, badEmail).actions).toEqual(["FLAG_MISSING_EMAIL"]);
  });
});

describe("EXISTING accounts keep their manually assigned extra salons — nothing is added, removed or flagged for removal", () => {
  const linkedSd = (e: PlannerEmployee, alsoCoversAreaIds: string[]): PlannerAccount => ({
    appUserId: "00000000-0000-4000-8000-0000000000aa",
    email: e.emailAddress!,
    displayName: e.name,
    role: "salon_director",
    status: "active",
    scopeLevel: "salon",
    primaryAreaId: "loc-0307",
    alsoCoversAreaIds,
    management: "woven_linked",
    linkedExternalEmployeeId: e.externalEmployeeId,
    linkMethod: "admin_manual",
    managedStatus: true,
    managedLocation: false,
    managedRole: false,
    terminatedAt: null,
    accessRevokedAt: null,
    override: null,
    invite: null,
  });

  it("extras beyond Woven's approved additional salons are preserved (flagged for visibility only); there is no action that changes them", () => {
    const e = employee({ additionalLocationIds: ["L-0309"] });
    const rows = plan([e], { accounts: [linkedSd(e, ["loc-0309", "loc-0394"])] });
    const row = rowOf(rows, e);
    expect(row.actions.filter((a) => ["UPDATE_PRIMARY_LOCATION", "UPDATE_ROLE", "CREATE_USER"].includes(a))).toEqual([]);
    expect(row.reasons).toContain("extra_salons_not_granted_by_woven");
    expect(row.lifecycle).toBe("NO_CHANGE");
  });

  it("extras that equal Woven's approved additional salons raise no flag at all", () => {
    const e = employee({ additionalLocationIds: ["L-0309", "L-0394"] });
    const row = rowOf(plan([e], { accounts: [linkedSd(e, ["loc-0309", "loc-0394"])] }), e);
    expect(row.reasons).not.toContain("extra_salons_not_granted_by_woven");
    expect(row.actions).toEqual(["NO_CHANGE"]);
  });
});

describe("the apply layer has its own role gate (defence in depth)", () => {
  const healthy = [
    { status: "succeeded" as const, finishedAt: "2026-10-15T11:30:00Z", employeesActive: 150, issueCounts: {} },
    { status: "succeeded" as const, finishedAt: "2026-10-14T11:30:00Z", employeesActive: 150, issueCounts: {} },
  ];
  const cfg: WovenAccessConfig = { mode: "apply", applyActions: ["CREATE_USER", "SEND_INVITE"], employeeAllowlist: null, problem: null };

  function harness(rows: PlannedRow[], accounts: PlannerAccount[] = []) {
    const base = buildAccessPlan({ employees: [], positions, locations, accounts, salonAreas }, { runs: healthy, mappingBaseline: null, directoryRunId: "11111111-1111-4111-8111-111111111111", now: NOW });
    const plan = { ...base, rows };
    const calls: { fn: string; args: Record<string, unknown> }[] = [];
    const deps: ApplyDeps = {
      loadPlan: async () => plan,
      rpc: (fn, args) => {
        calls.push({ fn, args });
        return Promise.resolve(fn === "employee_access_begin_apply_run" ? { data: "run", error: null } : fn === "employee_access_auth_user_by_email" ? { data: [], error: null } : { data: "created", error: null });
      },
      auth: {
        createUser: vi.fn(async () => ({ data: { user: { id: "aaaaaaaa-0000-4000-8000-000000000001" } }, error: null })),
        inviteUserByEmail: vi.fn(async () => ({ data: {}, error: null })),
        getUserById: vi.fn(async () => ({ data: { user: { email_confirmed_at: null, banned_until: null } }, error: null })),
      },
      revokeAuthAccess: vi.fn(async () => ({ ok: true, failed: [] })),
    };
    return { deps, calls };
  }
  const forcedCreate = (role: string, level: string): PlannedRow => ({
    ...rowOf(plan([employee()]), employee()),
    externalEmployeeId: "EX",
    key: "employee:EX",
    actions: ["CREATE_USER"],
    after: { email: "forced@example.test", display_name: "Forced", role, scope_level: level, scope_primary_area_id: "loc-0307", scope_also_covers_area_ids: [] },
  });
  const run = (deps: ApplyDeps) => applyAccessLifecycle({ requestedBy: "cron", redirectTo: "https://ask-sunny.example/auth/accept", config: cfg, now: NOW }, deps);

  it.each([
    ["employee", "salon"],
    ["admin", "global"],
    ["owner", "global"],
    ["developer", "global"],
    ["salon_director", "global"],
    ["district_manager", "salon"],
  ])("a forced CREATE_USER for %s at %s scope creates nothing and mails nothing", async (role, level) => {
    const h = harness([forcedCreate(role, level)]);
    await run(h.deps);
    expect(h.deps.auth.createUser).not.toHaveBeenCalled();
    expect(h.deps.auth.inviteUserByEmail).not.toHaveBeenCalled();
    expect(h.calls.map((c) => c.fn)).not.toContain("employee_access_provision_account");
  });

  it("passes the scope level to the database for each eligible role, and invites exactly once", async () => {
    for (const [role, level] of [["assistant_salon_director", "salon"], ["salon_director", "salon"], ["district_manager", "district"], ["regional_manager", "region"]]) {
      const h = harness([forcedCreate(role!, level!)]);
      await run(h.deps);
      expect(h.calls.find((c) => c.fn === "employee_access_provision_account")?.args).toMatchObject({ p_role: role, p_scope_level: level });
      expect(h.deps.auth.inviteUserByEmail).toHaveBeenCalledTimes(1);
    }
  });

  it("the retry step never re-invites an accepted account or one outside the four roles", async () => {
    const e = employee();
    const base = rowOf(plan([e]), e);
    const mk = (role: Role, acceptedAt: string | null, status: "invited" | "active"): PlannedRow => ({
      ...base,
      actions: ["NO_CHANGE"],
      wovenStatus: "active",
      account: {
        appUserId: "00000000-0000-4000-8000-000000000042",
        email: "x@example.test",
        role,
        status,
        scopeLevel: "salon",
        primaryAreaId: "loc-0307",
        management: "woven_linked",
        isProtected: false,
        managed: { status: true, location: false, role: false },
        extraSalonCount: 0,
        via: "link",
        linkMethod: "provisioned",
        invite: { status: "failed", sentAt: null, acceptedAt, attempts: 1, error: "provider_error" },
      },
    });
    for (const row of [mk("salon_director", "2026-10-15T00:00:00Z", "invited"), mk("salon_director", null, "active"), mk("employee", null, "invited"), mk("admin", null, "invited")]) {
      const h = harness([row]);
      await run(h.deps);
      expect(h.deps.auth.inviteUserByEmail).not.toHaveBeenCalled();
    }
    const h = harness([mk("district_manager", null, "invited")]);
    await run(h.deps);
    expect(h.deps.auth.inviteUserByEmail).toHaveBeenCalledTimes(1);
  });

  it("repeated syncs: once the account exists the plan has no CREATE_USER, so nothing is created or mailed again", () => {
    const e = employee({ positionId: "P-DM" });
    const created: PlannerAccount = {
      appUserId: "00000000-0000-4000-8000-000000000077",
      email: e.emailAddress!,
      displayName: e.name,
      role: "district_manager",
      status: "invited",
      scopeLevel: "district",
      primaryAreaId: "dist-dugan",
      alsoCoversAreaIds: [],
      management: "woven_linked",
      linkedExternalEmployeeId: e.externalEmployeeId,
      linkMethod: "provisioned",
      managedStatus: true,
      managedLocation: false,
      managedRole: false,
      terminatedAt: null,
      accessRevokedAt: null,
      override: null,
      invite: { status: "sent", sentAt: "2026-10-15T12:00:00Z", acceptedAt: null, attempts: 1, error: null },
    };
    const rows = plan([e], { accounts: [created] });
    expect(creates(rows)).toEqual([]);
    expect(rowOf(rows, e).lifecycle).toBe("NO_CHANGE");
  });
});

describe("the automatic invitation's landing page is pinned", () => {
  it("needs NEXT_PUBLIC_SITE_URL as an https origin (http only for localhost); otherwise no invitation", () => {
    expect(automaticInviteRedirectTarget({ NEXT_PUBLIC_SITE_URL: "https://ask-sunny.vercel.app/" })).toBe("https://ask-sunny.vercel.app/auth/accept");
    expect(automaticInviteRedirectTarget({ NEXT_PUBLIC_SITE_URL: "http://127.0.0.1:3000" })).toBe("http://127.0.0.1:3000/auth/accept");
    for (const bad of [undefined, "", "   ", "http://ask-sunny.vercel.app", "ftp://x", "not a url", "https://user:pw@ask-sunny.vercel.app"]) {
      expect(automaticInviteRedirectTarget({ NEXT_PUBLIC_SITE_URL: bad }), String(bad)).toBeNull();
    }
  });
});
