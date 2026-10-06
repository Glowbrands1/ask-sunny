import type { Role, ScopeLevel } from "@/types";

import type { EmploymentStatus, LocationMapStatus, PositionMapStatus } from "../types";

/**
 * ============================================================================
 * THE ACCESS PLANNER'S VOCABULARY
 * ============================================================================
 *
 * What a Woven → Ask Sunny access sync WOULD do for one employee or account.
 * Five actions would change something (the MUTATING ones); everything else is
 * NO_CHANGE or a FLAG for a person to review. Only three are ever APPLIED —
 * the account lifecycle (`LIFECYCLE_ACTIONS`): CREATE_USER, LINK_EXISTING and
 * DISABLE_TERMINATED. UPDATE_ROLE and UPDATE_PRIMARY_LOCATION are preview
 * only; the apply engine refuses them (`apply.ts`).
 *
 * The list is mirrored by the CHECK constraint on
 * `employee_access_actions.action`; `plan.test.ts` keeps the two equal.
 */
export const ACCESS_ACTIONS = [
  "NO_CHANGE",
  "CREATE_USER",
  "LINK_EXISTING",
  "UPDATE_PRIMARY_LOCATION",
  "UPDATE_ROLE",
  "DISABLE_TERMINATED",
  "FLAG_LINK_REVIEW",
  "FLAG_DUPLICATE_EMAIL",
  "FLAG_MISSING_EMAIL",
  "FLAG_UNMAPPED_POSITION",
  "FLAG_UNMAPPED_LOCATION",
  "FLAG_UNKNOWN_STATUS",
  "FLAG_REHIRE_REVIEW",
  "FLAG_NOT_WOVEN_MANAGED",
  "FLAG_EMAIL_CHANGE_REVIEW",
  "FLAG_MISSING_FROM_WOVEN",
  "FLAG_ROLE_REVIEW",
  "FLAG_LOCATION_REVIEW",
  "FLAG_PROTECTED_ACCOUNT",
  "FLAG_LINKED_EMPLOYEE_NOT_FOUND",
  "FLAG_STATUS_CONFLICT",
] as const;

export type AccessAction = (typeof ACCESS_ACTIONS)[number];

/** The actions that would change an account or its link. */
export const MUTATING_ACTIONS = ["CREATE_USER", "LINK_EXISTING", "UPDATE_PRIMARY_LOCATION", "UPDATE_ROLE", "DISABLE_TERMINATED"] as const satisfies readonly AccessAction[];
export type MutatingAction = (typeof MUTATING_ACTIONS)[number];

export function isMutating(action: AccessAction): action is MutatingAction {
  return (MUTATING_ACTIONS as readonly string[]).includes(action);
}

/** The only actions the apply engine may ever perform. Role and location changes are not among them. */
export const LIFECYCLE_ACTIONS = ["CREATE_USER", "LINK_EXISTING", "DISABLE_TERMINATED"] as const satisfies readonly MutatingAction[];
export type LifecycleAction = (typeof LIFECYCLE_ACTIONS)[number];

export function isLifecycleAction(action: string): action is LifecycleAction {
  return (LIFECYCLE_ACTIONS as readonly string[]).includes(action);
}

/** What the Access Preview shows per person: the lifecycle outcome, with the planner's reasons underneath. */
export const LIFECYCLE_OUTCOMES = ["CREATE_USER", "LINK_EXISTING", "NO_CHANGE", "DISABLE_TERMINATED", "REVIEW_REQUIRED"] as const;
export type LifecycleOutcome = (typeof LIFECYCLE_OUTCOMES)[number];

export type InviteDeliveryStatus = "not_sent" | "sent" | "failed";

/** One Woven employee, as the planner needs them (from `employee_directory_view`). */
export interface PlannerEmployee {
  externalEmployeeId: string;
  name: string;
  emailAddress: string | null;
  /** The status Woven last gave. The planner acts on `observedStatus`, which is `unknown` when not read in the latest run. */
  employmentStatus: EmploymentStatus;
  missingSyncCount: number;
  positionId: string | null;
  positionName: string | null;
  primaryWovenLocationId: string | null;
  primaryLocationName: string | null;
  /** Names only, for display. Additional and temporary locations never change access in this version. */
  additionalLocationNames: string[];
  issues: string[];
  terminationDate: string | null;
  lastSyncedAt: string | null;
}

export interface PlannerPosition {
  wovenPositionId: string;
  status: PositionMapStatus;
  isConfirmed: boolean;
  role: Role | null;
  scopeLevel: ScopeLevel | null;
}

export interface PlannerLocation {
  wovenLocationId: string;
  status: LocationMapStatus;
  /** The mapped salon's number, e.g. "0307". Null unless status is `mapped`. */
  salonNumber: string | null;
  name: string | null;
}

export type AccountManagement = "woven_linked" | "not_woven_managed" | null;

/** One Ask Sunny account, with its Woven link and protected override (from `employee_access_accounts`). */
export interface PlannerAccount {
  appUserId: string;
  email: string;
  displayName: string;
  role: Role;
  status: "invited" | "active" | "disabled";
  scopeLevel: ScopeLevel;
  primaryAreaId: string | null;
  alsoCoversAreaIds: string[];
  /** null: unclassified — no link row. */
  management: AccountManagement;
  linkedExternalEmployeeId: string | null;
  linkMethod: string | null;
  managedStatus: boolean;
  managedLocation: boolean;
  managedRole: boolean;
  terminatedAt: string | null;
  accessRevokedAt: string | null;
  override: { role: Role; scopeLevel: ScopeLevel; externalEmployeeId: string | null } | null;
  /** Woven-provisioned accounts only; null otherwise. */
  invite?: { status: InviteDeliveryStatus | null; sentAt: string | null; acceptedAt: string | null; attempts: number; error: string | null } | null;
}

export interface PlannerInput {
  employees: readonly PlannerEmployee[];
  positions: readonly PlannerPosition[];
  locations: readonly PlannerLocation[];
  accounts: readonly PlannerAccount[];
}

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

/** One row of the plan: a Woven employee (with or without an account), or an account no employee explains. */
export interface PlannedRow {
  key: string;
  externalEmployeeId: string | null;
  appUserId: string | null;
  employeeName: string;
  emailAddress: string | null;
  /** What the planner acted on: Woven's status if read in the latest run, else `unknown`. */
  wovenStatus: EmploymentStatus | null;
  wovenPosition: string | null;
  wovenPrimaryLocation: string | null;
  wovenAdditionalLocations: string[];
  account: {
    appUserId: string;
    email: string;
    role: Role;
    status: PlannerAccount["status"];
    scopeLevel: ScopeLevel;
    primaryAreaId: string | null;
    management: AccountManagement;
    /** A role override or an administrative role: never managed by Woven. */
    isProtected: boolean;
    /** What Woven may manage for this account (all off unless an administrator turned them on). */
    managed: { status: boolean; location: boolean; role: boolean };
    /** Salons held beyond the primary (`scope_also_covers_area_ids`). Never granted by Woven. */
    extraSalonCount: number;
    /** How this row found the account: a confirmed link, an unconfirmed email candidate, or nothing. */
    via: "link" | "email_candidate" | "account_only";
    linkMethod: string | null;
    invite: PlannerAccount["invite"] | null;
  } | null;
  proposedRole: Role | null;
  /** A salon area id (`loc-0307`) when a salon follows from Woven's primary location. */
  proposedPrimaryAreaId: string | null;
  /** Primary first. */
  actions: AccessAction[];
  reasons: string[];
  /** The account-lifecycle reading of `actions` — what the Access Preview leads with. See `lifecycle.ts`. */
  lifecycle: LifecycleOutcome;
  /** The one reason code behind `lifecycle`. */
  lifecycleReason: string;
  before: { [key: string]: Json } | null;
  after: { [key: string]: Json } | null;
  wovenSourceAt: string | null;
}
