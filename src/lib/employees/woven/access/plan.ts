import { ADMIN_CONSOLE_ROLES } from "@/lib/permissions";
import type { Role } from "@/types";

import { observedStatus } from "../status-evidence";
import type { AccessAction, PlannedRow, PlannerAccount, PlannerEmployee, PlannerInput, PlannerLocation, PlannerPosition } from "./types";

/**
 * ============================================================================
 * THE ACCESS PLANNER — pure, deterministic, and it changes nothing
 * ============================================================================
 *
 * Given the Woven directory, the approved mappings and the Ask Sunny accounts
 * with their links, it says what an access sync WOULD do for each person. It
 * reads no database and writes none: the same input always gives the same
 * plan, so running it ten times is running it once.
 *
 * THE POLICY (owner decisions, 2 Oct 2026)
 *
 *   IDENTITY. A confirmed link (Woven EmployeeID → account) is authoritative.
 *     Without one, an exact, case-insensitive email match to exactly ONE
 *     unclassified account is only PROPOSED (FLAG_LINK_REVIEW) — never acted
 *     on, never merged. Email is never used to re-match a linked account.
 *
 *   ACCOUNTS. Only a Woven position whose APPROVED mapping is Salon Director
 *     or Assistant Salon Director may get an account automatically, and only
 *     when active, with a usable unique email (personal addresses allowed)
 *     and a primary location mapped to a salon. Everyone else — Tanning
 *     Consultants, District Managers and above, corporate and unmapped
 *     positions — gets no account from Woven.
 *
 *   TERMINATION. Only Woven's own Terminated status, read in the latest run,
 *     disables a linked account whose status is Woven-managed. Absence from
 *     Woven is review only. Unknown status fails closed. Protected accounts
 *     and administrators are never disabled automatically.
 *
 *   LOCATION AND ROLE. Only for a linked Salon Director / Assistant Salon
 *     Director whose scope is a single salon, with the matching managed flag:
 *     the PRIMARY salon follows Woven's mapped primary location, and the role
 *     may move between those two roles. Additional, temporary or expiring
 *     locations never change access. A global, region or district account is
 *     never narrowed to a salon. Anything else that differs is flagged.
 *
 *   REHIRE. A linked account whose access was revoked and who is Active in
 *     Woven again is flagged for review, never re-enabled.
 *
 *   EMAIL. A different Woven email on a linked account is flagged; the login
 *     email is never changed.
 */

export const ACCESS_POLICY_VERSION = "access-policy-1";

/** The approved mapped roles that may be provisioned from Woven in this rollout. */
export const AUTO_PROVISION_ROLES: readonly Role[] = ["salon_director", "assistant_salon_director"];
/** The roles whose primary salon and role Woven may manage — the salon-level manager tier. */
export const SALON_MANAGED_ROLES: readonly Role[] = ["salon_director", "assistant_salon_director"];

const isSalonManagedRole = (role: Role | null): role is Role => role !== null && SALON_MANAGED_ROLES.includes(role);
const lower = (value: string | null) => (value ?? "").trim().toLowerCase();
export const salonAreaId = (salonNumber: string) => `loc-${salonNumber}`;

function accountView(account: PlannerAccount, via: NonNullable<PlannedRow["account"]>["via"]): NonNullable<PlannedRow["account"]> {
  return {
    appUserId: account.appUserId,
    email: account.email,
    role: account.role,
    status: account.status,
    scopeLevel: account.scopeLevel,
    primaryAreaId: account.primaryAreaId,
    management: account.management,
    isProtected: isProtected(account),
    via,
  };
}

/** The Woven EmployeeID an account is linked to: its link row, or (protected accounts) its override. */
function linkedIdOf(account: PlannerAccount): string | null {
  if (account.management === "woven_linked") return account.linkedExternalEmployeeId;
  if (account.management === null) return account.override?.externalEmployeeId ?? null;
  return null;
}

/** Protected: a role override, or an administrative role. Never managed by Woven, whatever the flags say. */
function isProtected(account: PlannerAccount): boolean {
  return account.override !== null || (ADMIN_CONSOLE_ROLES as readonly Role[]).includes(account.role);
}

function proposedLocation(employee: PlannerEmployee, locations: Map<string, PlannerLocation>) {
  if (!employee.primaryWovenLocationId) return { areaId: null, problem: "primary_location_missing" } as const;
  const location = locations.get(employee.primaryWovenLocationId);
  if (!location || location.status === "unmapped") return { areaId: null, problem: "primary_location_unmapped" } as const;
  if (location.status === "ignored" || !location.salonNumber) return { areaId: null, problem: "primary_location_not_a_salon" } as const;
  return { areaId: salonAreaId(location.salonNumber), problem: null } as const;
}

function confirmedRole(employee: PlannerEmployee, positions: Map<string, PlannerPosition>): Role | null {
  if (!employee.positionId) return null;
  const position = positions.get(employee.positionId);
  return position && position.isConfirmed && position.status === "mapped" ? position.role : null;
}

export function planAccess(input: PlannerInput): PlannedRow[] {
  const positions = new Map(input.positions.map((p) => [p.wovenPositionId, p]));
  const locations = new Map(input.locations.map((l) => [l.wovenLocationId, l]));

  const byLinkedEmployee = new Map<string, PlannerAccount>();
  const byEmail = new Map<string, PlannerAccount[]>();
  for (const account of input.accounts) {
    const linked = linkedIdOf(account);
    if (linked) byLinkedEmployee.set(linked, account);
    const key = lower(account.email);
    if (key) byEmail.set(key, [...(byEmail.get(key) ?? []), account]);
  }

  const emailHolders = new Map<string, number>();
  for (const employee of input.employees) {
    const key = lower(employee.emailAddress);
    if (key) emailHolders.set(key, (emailHolders.get(key) ?? 0) + 1);
  }

  const covered = new Set<string>();
  const rows: PlannedRow[] = [];

  for (const employee of [...input.employees].sort((a, b) => a.externalEmployeeId.localeCompare(b.externalEmployeeId))) {
    const row = planEmployee(employee, { positions, locations, byLinkedEmployee, byEmail, emailHolders });
    if (row.account) covered.add(row.account.appUserId);
    rows.push(row);
  }

  const directoryIds = new Set(input.employees.map((e) => e.externalEmployeeId));
  for (const account of [...input.accounts].sort((a, b) => a.appUserId.localeCompare(b.appUserId))) {
    if (covered.has(account.appUserId)) continue;
    const linked = linkedIdOf(account);
    const base: PlannedRow = {
      key: `account:${account.appUserId}`,
      externalEmployeeId: linked,
      appUserId: account.appUserId,
      employeeName: account.displayName,
      emailAddress: account.email,
      wovenStatus: null,
      wovenPosition: null,
      wovenPrimaryLocation: null,
      wovenAdditionalLocations: [],
      account: accountView(account, "account_only"),
      proposedRole: null,
      proposedPrimaryAreaId: null,
      actions: [],
      reasons: [],
      before: null,
      after: null,
      wovenSourceAt: null,
    };
    if (linked && !directoryIds.has(linked)) {
      rows.push({ ...base, actions: ["FLAG_LINKED_EMPLOYEE_NOT_FOUND"], reasons: ["linked_employee_not_in_woven_directory"] });
    } else if (account.management === "not_woven_managed") {
      rows.push({ ...base, actions: ["FLAG_NOT_WOVEN_MANAGED"], reasons: ["marked_not_woven_managed"] });
    } else {
      rows.push({ ...base, actions: ["FLAG_NOT_WOVEN_MANAGED"], reasons: ["unclassified_no_woven_match"] });
    }
  }

  return rows;
}

interface Context {
  positions: Map<string, PlannerPosition>;
  locations: Map<string, PlannerLocation>;
  byLinkedEmployee: Map<string, PlannerAccount>;
  byEmail: Map<string, PlannerAccount[]>;
  emailHolders: Map<string, number>;
}

function planEmployee(employee: PlannerEmployee, ctx: Context): PlannedRow {
  const status = observedStatus(employee);
  const role = confirmedRole(employee, ctx.positions);
  const location = proposedLocation(employee, ctx.locations);
  const actions: AccessAction[] = [];
  const reasons: string[] = [];
  let before: PlannedRow["before"] = null;
  let after: PlannedRow["after"] = null;
  let account: PlannedRow["account"] = null;

  const row = (): PlannedRow => ({
    key: `employee:${employee.externalEmployeeId}`,
    externalEmployeeId: employee.externalEmployeeId,
    appUserId: account?.appUserId ?? null,
    employeeName: employee.name,
    emailAddress: employee.emailAddress,
    wovenStatus: status,
    wovenPosition: employee.positionName,
    wovenPrimaryLocation: employee.primaryLocationName,
    wovenAdditionalLocations: employee.additionalLocationNames,
    account,
    proposedRole: role,
    proposedPrimaryAreaId: location.areaId,
    actions: actions.length > 0 ? sortActions(actions) : ["NO_CHANGE"],
    reasons,
    before,
    after,
    wovenSourceAt: employee.lastSyncedAt,
  });

  /* ------------------------------------------------- 1. which account ---- */
  const linked = ctx.byLinkedEmployee.get(employee.externalEmployeeId) ?? null;
  if (!linked) {
    const email = lower(employee.emailAddress);
    const sameEmail = email ? (ctx.byEmail.get(email) ?? []) : [];
    if (sameEmail.length > 0) {
      const unclassified = sameEmail.filter((a) => a.management === null && linkedIdOf(a) === null);
      const notManaged = sameEmail.filter((a) => a.management === "not_woven_managed");
      const linkedElsewhere = sameEmail.filter((a) => linkedIdOf(a) !== null);
      const shown = unclassified[0] ?? notManaged[0] ?? linkedElsewhere[0]!;
      account = accountView(shown, "email_candidate");

      if ((ctx.emailHolders.get(email) ?? 0) > 1 || employee.issues.includes("duplicate_email")) {
        actions.push("FLAG_DUPLICATE_EMAIL");
        reasons.push("email_shared_by_several_woven_employees");
      } else if (unclassified.length === 1) {
        actions.push("FLAG_LINK_REVIEW");
        reasons.push("exact_email_match_awaiting_confirmation");
        if (status === "terminated") reasons.push("terminated_in_woven");
      } else if (unclassified.length > 1) {
        actions.push("FLAG_DUPLICATE_EMAIL");
        reasons.push("email_shared_by_several_accounts");
      }
      if (notManaged.length > 0) {
        actions.push("FLAG_NOT_WOVEN_MANAGED");
        reasons.push("email_matches_account_marked_not_woven_managed");
      }
      if (linkedElsewhere.length > 0) {
        actions.push("FLAG_DUPLICATE_EMAIL");
        reasons.push("email_matches_account_linked_to_another_employee");
      }
      /* Nothing is created or changed for an employee whose email already names an account. */
      return row();
    }
    return planWithoutAccount(employee, status, role, location, actions, reasons, (b, a) => ((before = b), (after = a)), ctx, row);
  }

  account = accountView(linked, "link");

  /* ---------------------------------------------------- 2. status ---- */
  if (status === "unknown") {
    if (employee.employmentStatus === "unknown") {
      actions.push("FLAG_UNKNOWN_STATUS");
      reasons.push("woven_status_unknown");
    } else {
      actions.push("FLAG_MISSING_FROM_WOVEN");
      reasons.push("not_in_latest_woven_read");
    }
    return row();
  }

  if (status === "terminated") {
    if (linked.status === "disabled" && linked.accessRevokedAt) {
      reasons.push("access_already_revoked");
    } else if (isProtected(linked)) {
      actions.push("FLAG_PROTECTED_ACCOUNT");
      reasons.push("terminated_in_woven_protected_account");
    } else if (!linked.managedStatus) {
      actions.push("FLAG_PROTECTED_ACCOUNT");
      reasons.push("terminated_in_woven_status_not_woven_managed");
    } else {
      actions.push("DISABLE_TERMINATED");
      reasons.push("terminated_in_woven");
      before = { status: linked.status };
      after = { status: "disabled", auth_ban: true, sessions_revoked: true, terminated_on: employee.terminationDate };
    }
    return row();
  }

  /* status === "active" */
  if (linked.accessRevokedAt || (linked.terminatedAt && linked.status === "disabled")) {
    actions.push("FLAG_REHIRE_REVIEW");
    reasons.push("active_in_woven_after_revocation");
    return row();
  }
  if (linked.status === "disabled") {
    actions.push("FLAG_STATUS_CONFLICT");
    reasons.push("disabled_in_ask_sunny_active_in_woven");
    return row();
  }
  if (employee.issues.includes("status_termination_conflict")) reasons.push("woven_shows_past_termination_date");

  if (employee.emailAddress && lower(employee.emailAddress) !== lower(linked.email)) {
    actions.push("FLAG_EMAIL_CHANGE_REVIEW");
    reasons.push("woven_email_differs_from_login_email");
  }

  if (isProtected(linked)) {
    actions.push("FLAG_PROTECTED_ACCOUNT");
    reasons.push("protected_account_not_managed_by_woven");
    return row();
  }

  if (role === null) {
    actions.push("FLAG_UNMAPPED_POSITION");
    reasons.push("woven_position_not_confirmed");
    return row();
  }

  const salonTier = isSalonManagedRole(linked.role) && linked.scopeLevel === "salon";
  if (!salonTier) {
    reasons.push("scope_above_salon_level_not_managed_by_woven");
    if (role !== linked.role) {
      actions.push("FLAG_ROLE_REVIEW");
      reasons.push("woven_position_maps_to_a_different_role");
    }
    return row();
  }

  let locationBlocked = false;
  if (role !== linked.role) {
    if (isSalonManagedRole(role) && linked.managedRole) {
      actions.push("UPDATE_ROLE");
      reasons.push("woven_position_changed_within_salon_tier");
      before = { ...(before ?? {}), role: linked.role };
      after = { ...(after ?? {}), role };
    } else {
      actions.push("FLAG_ROLE_REVIEW");
      reasons.push(isSalonManagedRole(role) ? "role_not_woven_managed" : "woven_position_outside_automatic_tier");
      /* A pending role change outside the tier also holds the location: review the person, not one field. */
      locationBlocked = !isSalonManagedRole(role);
    }
  }

  if (!locationBlocked) {
    if (location.problem) {
      actions.push("FLAG_UNMAPPED_LOCATION");
      reasons.push(location.problem);
    } else if (location.areaId !== linked.primaryAreaId) {
      if (linked.managedLocation) {
        actions.push("UPDATE_PRIMARY_LOCATION");
        reasons.push("woven_primary_location_changed");
        before = { ...(before ?? {}), scope_primary_area_id: linked.primaryAreaId };
        after = { ...(after ?? {}), scope_primary_area_id: location.areaId };
      } else {
        actions.push("FLAG_LOCATION_REVIEW");
        reasons.push("location_not_woven_managed");
      }
    }
  }

  if (actions.length === 0) reasons.push("in_sync_with_woven");
  return row();
}

function planWithoutAccount(
  employee: PlannerEmployee,
  status: ReturnType<typeof observedStatus>,
  role: Role | null,
  location: ReturnType<typeof proposedLocation>,
  actions: AccessAction[],
  reasons: string[],
  setValues: (before: PlannedRow["before"], after: PlannedRow["after"]) => void,
  ctx: Context,
  row: () => PlannedRow,
): PlannedRow {
  if (status === "unknown") {
    actions.push(employee.employmentStatus === "unknown" ? "FLAG_UNKNOWN_STATUS" : "FLAG_MISSING_FROM_WOVEN");
    reasons.push(employee.employmentStatus === "unknown" ? "woven_status_unknown" : "not_in_latest_woven_read");
    return row();
  }
  if (status === "terminated") {
    reasons.push("terminated_no_account");
    return row();
  }
  if (role === null) {
    actions.push("FLAG_UNMAPPED_POSITION");
    reasons.push(employee.positionId ? "woven_position_not_confirmed" : "woven_position_missing");
    return row();
  }
  if (!AUTO_PROVISION_ROLES.includes(role)) {
    reasons.push("position_not_auto_provisioned");
    return row();
  }
  if (employee.issues.includes("status_termination_conflict")) {
    actions.push("FLAG_STATUS_CONFLICT");
    reasons.push("woven_shows_past_termination_date");
    return row();
  }
  const email = lower(employee.emailAddress);
  if (!email || employee.issues.includes("invalid_email") || employee.issues.includes("missing_email")) {
    actions.push("FLAG_MISSING_EMAIL");
    reasons.push(email ? "woven_email_invalid" : "woven_email_missing");
    return row();
  }
  if ((ctx.emailHolders.get(email) ?? 0) > 1 || employee.issues.includes("duplicate_email")) {
    actions.push("FLAG_DUPLICATE_EMAIL");
    reasons.push("email_shared_by_several_woven_employees");
    return row();
  }
  if (location.problem) {
    actions.push("FLAG_UNMAPPED_LOCATION");
    reasons.push(location.problem);
    return row();
  }
  actions.push("CREATE_USER");
  reasons.push("eligible_salon_manager_without_account");
  setValues(null, {
    email,
    display_name: employee.name,
    role,
    status: "invited",
    scope_level: "salon",
    scope_primary_area_id: location.areaId,
    scope_also_covers_area_ids: [],
    provisioned_by_source: "woven",
    external_employee_id: employee.externalEmployeeId,
    invite_email: "not_sent",
  });
  return row();
}

/** Mutating actions first (in a fixed order), then flags, so the primary action is the consequential one. */
const ORDER: readonly AccessAction[] = [
  "DISABLE_TERMINATED",
  "CREATE_USER",
  "UPDATE_ROLE",
  "UPDATE_PRIMARY_LOCATION",
  "FLAG_REHIRE_REVIEW",
  "FLAG_PROTECTED_ACCOUNT",
  "FLAG_DUPLICATE_EMAIL",
  "FLAG_LINK_REVIEW",
  "FLAG_EMAIL_CHANGE_REVIEW",
  "FLAG_UNKNOWN_STATUS",
  "FLAG_STATUS_CONFLICT",
  "FLAG_MISSING_FROM_WOVEN",
  "FLAG_ROLE_REVIEW",
  "FLAG_LOCATION_REVIEW",
  "FLAG_UNMAPPED_POSITION",
  "FLAG_UNMAPPED_LOCATION",
  "FLAG_MISSING_EMAIL",
  "FLAG_LINKED_EMPLOYEE_NOT_FOUND",
  "FLAG_NOT_WOVEN_MANAGED",
  "NO_CHANGE",
];

function sortActions(actions: AccessAction[]): AccessAction[] {
  return [...new Set(actions)].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
}

/** Counts by action, over every row's actions. */
export function countActions(rows: readonly PlannedRow[]): Record<AccessAction, number> {
  const counts = Object.fromEntries(ORDER.map((a) => [a, 0])) as Record<AccessAction, number>;
  for (const row of rows) for (const action of row.actions) counts[action] += 1;
  return counts;
}
