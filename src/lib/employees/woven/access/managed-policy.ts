import { ADMIN_CONSOLE_ROLES } from "@/lib/permissions";
import type { Role, ScopeLevel } from "@/types";

/**
 * ============================================================================
 * WHAT WOVEN MAY MANAGE FOR A LINKED ACCOUNT — the owner's policy (6 Oct 2026)
 * ============================================================================
 *
 *   salon tier (employee, assistant salon director, salon director) at salon
 *   scope, not protected:
 *       status   — yes: Woven's explicit Terminated revokes access
 *       location — yes: the PRIMARY salon follows Woven's primary location
 *                  (extra salons are never granted from Woven)
 *       role     — yes, within the salon tier only
 *
 *   district manager, regional manager, or any account above salon scope,
 *   not protected:
 *       status   — yes
 *       location — never (never narrowed to a salon)
 *       role     — never (a change is flagged for review)
 *
 *   protected — an administrative role (admin, owner, developer) or a role
 *   override:
 *       nothing. Never auto-disabled: a Woven termination is flagged for a
 *       person to review.
 *
 * Every flag defaults OFF and is turned on only by an administrator, per
 * account, audited (`managed_flags_changed`). The server refuses a flag this
 * policy does not allow, whatever a request asks for.
 */

/** The salon-level roles whose primary salon and role Woven may manage. */
export const SALON_TIER_ROLES: readonly Role[] = ["employee", "assistant_salon_director", "salon_director"];

export interface ManagedFlags {
  status: boolean;
  location: boolean;
  role: boolean;
}

export const NO_FLAGS: ManagedFlags = Object.freeze({ status: false, location: false, role: false });

export function isSalonTierRole(role: Role | null): role is Role {
  return role !== null && SALON_TIER_ROLES.includes(role);
}

/** Protected: a role override, or an administrative role. Never managed by Woven, whatever the flags say. */
export function isProtectedAccount(account: { role: Role; override: unknown }): boolean {
  return account.override !== null || (ADMIN_CONSOLE_ROLES as readonly Role[]).includes(account.role);
}

/** Which managed flags an account may carry at all. */
export function allowedManagedFlags(account: { role: Role; scopeLevel: ScopeLevel | string }, isProtected: boolean): ManagedFlags {
  if (isProtected || (ADMIN_CONSOLE_ROLES as readonly Role[]).includes(account.role)) return { ...NO_FLAGS };
  const salonTier = isSalonTierRole(account.role) && account.scopeLevel === "salon";
  return { status: true, location: salonTier, role: salonTier };
}

/** The flags a request asked for that this account may not carry. Empty when the request is allowed. */
export function disallowedFlags(requested: ManagedFlags, allowed: ManagedFlags): (keyof ManagedFlags)[] {
  return (Object.keys(requested) as (keyof ManagedFlags)[]).filter((key) => requested[key] && !allowed[key]);
}

/** "status:on,location:off,role:off" — how a flag set is written to the audit trail. */
export function flagsLabel(flags: ManagedFlags): string {
  return `status:${flags.status ? "on" : "off"},location:${flags.location ? "on" : "off"},role:${flags.role ? "on" : "off"}`;
}

/**
 * THE ONLY ROLES A WOVEN SYNC MAY CREATE AN ACCOUNT FOR AND INVITE (owner
 * instruction, 15 Oct 2026): Assistant Salon Director, Salon Director,
 * District Manager, Regional Manager — by the CONFIRMED position mapping.
 * Every other role, and every unmapped or unconfirmed position, is never
 * invited automatically. This restricts the AUTOMATIC path only: an
 * administrator may still invite anyone by hand (`admin/user-directory.ts`).
 * Mirrored in SQL by `employee_access_provision_account`.
 */
export const AUTO_PROVISION_ROLES: readonly Role[] = ["assistant_salon_director", "salon_director", "district_manager", "regional_manager"];
/** The scope level an automatically provisioned role receives. */
export const PROVISION_SCOPE_LEVEL: Partial<Record<Role, "salon" | "district" | "region">> = {
  assistant_salon_director: "salon",
  salon_director: "salon",
  district_manager: "district",
  regional_manager: "region",
};
