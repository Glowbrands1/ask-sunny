import type { Role, ScopeLevel } from "@/types";

/**
 * ============================================================================
 * WHICH ASK SUNNY ROLE A WOVEN EMPLOYEE RESOLVES TO — and who is protected
 * ============================================================================
 *
 * ONE ORDER, EVERYWHERE:
 *
 *   1. a protected employee override (`employee_role_overrides`), then
 *   2. the CONFIRMED Woven position mapping (`woven_position_map`), then
 *   3. nothing — an unmapped or unconfirmed position resolves to no role.
 *
 * Location mapping is separate: it answers WHICH salon, never what role.
 *
 * `employee_access_preview` states the same order in SQL (effective_role,
 * role_source); `role-resolution.test.ts` and the migration verifier pin both.
 *
 * PHASE ONE WRITES NO ROLE. Nothing here changes an account. A later,
 * separately approved role-application step must call `roleWriteAllowed`
 * before it writes, so a protected account can never be demoted or replaced by
 * a Woven position — and nobody gains a role from sharing a protected person's
 * position, because an override belongs to one account, not to a position.
 */

export type RoleSource = "override" | "position" | "none";

export interface RoleOverride {
  role: Role;
  scopeLevel: ScopeLevel;
}

export interface PositionMapping {
  isConfirmed: boolean;
  role: Role | null;
  scopeLevel: ScopeLevel | null;
}

export interface ResolvedRole {
  role: Role | null;
  scopeLevel: ScopeLevel | null;
  source: RoleSource;
}

export function resolveEmployeeRole(override: RoleOverride | null, position: PositionMapping | null): ResolvedRole {
  if (override) return { role: override.role, scopeLevel: override.scopeLevel, source: "override" };
  if (position?.isConfirmed && position.role && position.scopeLevel) {
    return { role: position.role, scopeLevel: position.scopeLevel, source: "position" };
  }
  return { role: null, scopeLevel: null, source: "none" };
}

/**
 * Whether a role-application step may give this account `proposed`. A
 * protected account accepts only its own override; anyone else only a role
 * their confirmed position resolves to.
 */
export function roleWriteAllowed(proposed: Role, override: RoleOverride | null, position: PositionMapping | null): boolean {
  const resolved = resolveEmployeeRole(override, position);
  return resolved.role !== null && resolved.role === proposed;
}
