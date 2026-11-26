import { afterEach, describe, expect, it, vi } from "vitest";

import { HOME_ADDRESS_MANAGER_ROLES, mayLookUpHomeAddress, mayReadHomeAddress } from "./home-address-access";
import { lookUpWovenHomeAddress, type HomeAddressLookupDeps } from "./home-address-lookup";

/*
 * Pau, 26 Nov 2026, approved by Curt: "only Admins and Managers", both apps. Managers (DM, RM, Salon Director) see it on
 * the exit form only; admins can also look anyone up on the Employee Directory. Invented people and addresses only.
 */

describe("who may see a home address", () => {
  it("admins and DM/RM/Salon Directors may; nobody else", () => {
    for (const role of ["admin", "owner", "developer", "district_manager", "regional_manager", "salon_director"] as const) {
      expect(mayReadHomeAddress(role), role).toBe(true);
    }
    for (const role of ["assistant_salon_director", "employee", null, undefined] as const) {
      expect(mayReadHomeAddress(role), String(role)).toBe(false);
    }
  });

  it("only admins may look anyone up on the directory — managers may not", () => {
    expect(mayLookUpHomeAddress("admin")).toBe(true);
    for (const role of HOME_ADDRESS_MANAGER_ROLES) expect(mayLookUpHomeAddress(role), role).toBe(false);
    expect(mayLookUpHomeAddress("assistant_salon_director")).toBe(false);
    expect(mayLookUpHomeAddress(null)).toBe(false);
  });
});

describe("the directory's live lookup", () => {
  afterEach(() => vi.useRealTimers());

  const deps = (over: Partial<HomeAddressLookupDeps> = {}): HomeAddressLookupDeps => ({
    wovenIdOf: async (id) => (id === "d-1" ? "W-501" : null),
    readDetails: async () => ({
      Address: { Address1: "412 Invented Ln", City: "Faketown", State: "NE", PostalCode: "68000" },
      Locations: [{ LocationAddress: { Address1: "9 Salon Plaza", City: "Elsewhere" } }],
    }),
    ...over,
  });

  it("returns the employee's own address, never the salon's", async () => {
    expect(await lookUpWovenHomeAddress("d-1", deps())).toEqual({ status: "found", address: "412 Invented Ln, Faketown, NE 68000" });
  });

  it("says none when Woven has no address for them", async () => {
    expect(await lookUpWovenHomeAddress("d-1", deps({ readDetails: async () => ({ Address: null }) }))).toEqual({ status: "none" });
  });

  it("is unavailable — never throws — for an unknown row, an error or a slow Woven", async () => {
    expect(await lookUpWovenHomeAddress("d-unknown", deps())).toEqual({ status: "unavailable" });
    const failing = deps({
      readDetails: async () => {
        throw new Error("Woven is down");
      },
    });
    expect(await lookUpWovenHomeAddress("d-1", failing)).toEqual({ status: "unavailable" });
    vi.useFakeTimers();
    const pending = lookUpWovenHomeAddress("d-1", deps({ readDetails: () => new Promise(() => {}) }));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await pending).toEqual({ status: "unavailable" });
  });
});
