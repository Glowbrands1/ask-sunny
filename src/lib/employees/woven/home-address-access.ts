import { ADMIN_CONSOLE_ROLES } from "@/lib/permissions";
import type { Role } from "@/types";

/**
 * ============================================================================
 * WHO MAY SEE AN EMPLOYEE'S HOME ADDRESS FROM WOVEN (Pau, 26 Nov 2026, approved by Curt)
 * ============================================================================
 *
 * "only Admins and Managers", both apps. Managers are District Managers, Regional Managers and Salon Directors (Store
 * Directors in Ask Bubbles) — not assistant directors.
 *
 *   admins (the admin console roles)   the Employee Directory's "Show home address", any employee
 *   DM · RM · Salon Director           the exit form's Permanent Address only, for people at salons they cover
 *
 * The address is always read live from Woven and never stored: the directory still has no address column.
 */

export const HOME_ADDRESS_MANAGER_ROLES: readonly Role[] = ["district_manager", "regional_manager", "salon_director"];

/** May this role ever see a Woven home address (the exit form's Permanent Address included)? */
export function mayReadHomeAddress(role: Role | null | undefined): boolean {
  if (!role) return false;
  return ADMIN_CONSOLE_ROLES.includes(role) || HOME_ADDRESS_MANAGER_ROLES.includes(role);
}

/** May this role look up any employee's home address on the admin Employee Directory? Admins only. */
export function mayLookUpHomeAddress(role: Role | null | undefined): boolean {
  return !!role && ADMIN_CONSOLE_ROLES.includes(role);
}
