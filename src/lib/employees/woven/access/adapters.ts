import { ROLES } from "@/lib/permissions";
import type { Role, ScopeLevel } from "@/types";

import type { DirectoryRow, LocationMappingRow, PositionMappingRow } from "../view-types";
import { employeeName } from "../views";
import type { InviteDeliveryStatus, PlannerAccount, PlannerEmployee, PlannerLocation, PlannerPosition } from "./types";

/**
 * The planner's inputs, from the same read models the other Woven tabs use —
 * so the Access Preview and the directory can never disagree about a person.
 * Pure: shared by the real loader and the demo sample.
 */

const SCOPE_LEVELS: readonly ScopeLevel[] = ["global", "region", "district", "salon"];
const asRole = (v: unknown): Role | null => ((ROLES as readonly string[]).includes(String(v)) ? (v as Role) : null);
const asScope = (v: unknown): ScopeLevel | null => (SCOPE_LEVELS.includes(v as ScopeLevel) ? (v as ScopeLevel) : null);
const INVITE_STATUSES: readonly InviteDeliveryStatus[] = ["not_sent", "sent", "failed"];
const str = (v: unknown) => (typeof v === "string" && v.length > 0 ? v : null);

export function plannerEmployee(row: DirectoryRow): PlannerEmployee {
  return {
    externalEmployeeId: row.externalEmployeeId,
    name: employeeName(row),
    emailAddress: row.emailAddress,
    employmentStatus: row.employmentStatus,
    missingSyncCount: row.missingSyncCount,
    positionId: row.positionId,
    positionName: row.positionName,
    primaryWovenLocationId: row.primaryLocationId,
    primaryLocationName: row.primaryLocationName,
    additionalLocationNames: [...row.additionalLocations, ...row.temporaryOrExpiringLocations].map((l) => l.name ?? l.wovenLocationId),
    issues: row.dataIssues,
    terminationDate: row.terminationDate,
    lastSyncedAt: row.lastSyncedAt || null,
  };
}

export function plannerPosition(row: PositionMappingRow): PlannerPosition {
  return {
    wovenPositionId: row.wovenPositionId,
    status: row.status,
    isConfirmed: row.isConfirmed,
    role: asRole(row.role),
    scopeLevel: asScope(row.scopeLevel),
  };
}

export function plannerLocation(row: LocationMappingRow): PlannerLocation {
  return {
    wovenLocationId: row.wovenLocationId,
    status: row.status,
    salonNumber: row.status === "mapped" ? row.salonNumber : null,
    name: row.name,
  };
}

/** One row of `employee_access_accounts`. An unknown role or status never becomes a permissive one: such rows are dropped. */
export function plannerAccount(row: Record<string, unknown>): PlannerAccount | null {
  const role = asRole(row.role);
  const status = ["invited", "active", "disabled"].includes(String(row.status)) ? (row.status as PlannerAccount["status"]) : null;
  const scopeLevel = asScope(row.scope_level);
  if (!role || !status || !scopeLevel) return null;
  const management = row.management === "woven_linked" || row.management === "not_woven_managed" ? row.management : null;
  const lockedRole = asRole(row.locked_role);
  const lockedScope = asScope(row.locked_scope_level);
  return {
    appUserId: String(row.app_user_id),
    email: String(row.email ?? ""),
    displayName: String(row.display_name ?? ""),
    role,
    status,
    scopeLevel,
    primaryAreaId: str(row.scope_primary_area_id),
    alsoCoversAreaIds: Array.isArray(row.scope_also_covers_area_ids) ? row.scope_also_covers_area_ids.map(String) : [],
    management,
    linkedExternalEmployeeId: str(row.linked_external_employee_id),
    linkMethod: str(row.link_method),
    managedStatus: row.managed_status === true,
    managedLocation: row.managed_location === true,
    managedRole: row.managed_role === true,
    terminatedAt: str(row.terminated_at),
    accessRevokedAt: str(row.access_revoked_at),
    override: lockedRole && lockedScope ? { role: lockedRole, scopeLevel: lockedScope, externalEmployeeId: str(row.override_external_employee_id) } : null,
    invite: INVITE_STATUSES.includes(row.invite_delivery_status as InviteDeliveryStatus)
      ? {
          status: row.invite_delivery_status as InviteDeliveryStatus,
          sentAt: str(row.invite_sent_at),
          acceptedAt: str(row.invite_accepted_at),
          attempts: typeof row.invite_attempts === "number" ? row.invite_attempts : 0,
          error: str(row.invite_error),
        }
      : null,
  };
}
