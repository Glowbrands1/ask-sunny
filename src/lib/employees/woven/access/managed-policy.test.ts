import { describe, expect, it } from "vitest";

import { ROLES } from "@/lib/permissions";
import type { Role } from "@/types";

import { allowedManagedFlags, disallowedFlags, flagsLabel, isProtectedAccount, NO_FLAGS, SALON_TIER_ROLES } from "./managed-policy";

/** The owner's policy of 6 Oct 2026, as a table: role × scope × protected → what Woven may manage. */
describe("managed-flag policy", () => {
  const allowed = (role: Role, scopeLevel: string, isProtected = false) => allowedManagedFlags({ role, scopeLevel }, isProtected);

  it("salon tier (employee, ASD, SD) at a salon: status, primary salon and role", () => {
    for (const role of ["employee", "assistant_salon_director", "salon_director"] as const) {
      expect(allowed(role, "salon"), role).toEqual({ status: true, location: true, role: true });
    }
    expect([...SALON_TIER_ROLES].sort()).toEqual(["assistant_salon_director", "employee", "salon_director"]);
  });

  it("a salon-tier role held at a wider scope is never narrowed: status only", () => {
    expect(allowed("salon_director", "district")).toEqual({ status: true, location: false, role: false });
    expect(allowed("employee", "global")).toEqual({ status: true, location: false, role: false });
  });

  it("District and Regional Managers: status only, whatever their scope", () => {
    for (const role of ["district_manager", "regional_manager"] as const) {
      for (const scope of ["salon", "district", "region", "global"]) {
        expect(allowed(role, scope), `${role}@${scope}`).toEqual({ status: true, location: false, role: false });
      }
    }
  });

  it("administrative roles and protected accounts: nothing — never auto-disabled", () => {
    for (const role of ["admin", "owner", "developer"] as const) expect(allowed(role, "global"), role).toEqual(NO_FLAGS);
    expect(allowed("salon_director", "salon", true)).toEqual(NO_FLAGS);
    expect(isProtectedAccount({ role: "admin", override: null })).toBe(true);
    expect(isProtectedAccount({ role: "salon_director", override: { role: "salon_director" } })).toBe(true);
    expect(isProtectedAccount({ role: "district_manager", override: null })).toBe(false);
  });

  it("every role is covered, and no role ever gets location or role management outside the salon tier", () => {
    for (const role of ROLES) {
      const flags = allowed(role, "salon");
      if (!SALON_TIER_ROLES.includes(role)) expect(flags.location || flags.role, role).toBe(false);
    }
  });

  it("names exactly the refused flags, and labels a flag set for the audit trail", () => {
    expect(disallowedFlags({ status: true, location: true, role: false }, { status: true, location: false, role: false })).toEqual(["location"]);
    expect(disallowedFlags({ status: false, location: false, role: false }, NO_FLAGS)).toEqual([]);
    expect(flagsLabel({ status: true, location: false, role: true })).toBe("status:on,location:off,role:on");
  });
});
