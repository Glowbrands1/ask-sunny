import { describe, expect, it } from "vitest";

import { PRODUCTION_DISTRICTS, PRODUCTION_REGIONS } from "@/data/salons";

import { rosterScopeForManager } from "./roster-manager";

/**
 * Pau, 26 Nov 2026, on District Managers left on "whole company": "she should
 * though" — "rachel and sarah all district her salon and other salon and her
 * managers forms". The roster names each district after its manager, so a DM
 * on a global scope is matched to it. The accounts below are built from the
 * roster's own names, so the test types no person.
 */

const accountFor = (areaName: string) => {
  const [last, first] = areaName.split(",").map((part) => part.trim());
  return { email: `${first}.${last}@example.com`, firstOnly: first!, full: `${first} ${last}` };
};

describe("she should though: a DM on a global scope reads the district the roster names her on", () => {
  for (const district of PRODUCTION_DISTRICTS) {
    it(`the manager of ${district.id}, by email`, () => {
      const account = accountFor(district.name);
      expect(rosterScopeForManager("district_manager", account.email, account.firstOnly)).toEqual({
        level: "district",
        primaryAreaId: district.id,
        alsoCoversAreaIds: [],
      });
    });
    it(`the manager of ${district.id}, by display name on a personal email`, () => {
      const account = accountFor(district.name);
      expect(rosterScopeForManager("district_manager", "someone@example.com", account.full)?.primaryAreaId).toBe(
        district.id,
      );
    });
  }

  it("a Regional Manager reads the region the roster names them on", () => {
    const account = accountFor(PRODUCTION_REGIONS[0]!.name);
    expect(rosterScopeForManager("regional_manager", account.email, null)?.primaryAreaId).toBe(PRODUCTION_REGIONS[0]!.id);
  });

  it("fails closed: a first name alone, a stranger, or another role names no area", () => {
    const account = accountFor(PRODUCTION_DISTRICTS[0]!.name);
    expect(rosterScopeForManager("district_manager", "x@example.com", account.firstOnly)).toBeNull();
    expect(rosterScopeForManager("district_manager", "quintrell.marlowe@example.com", "Marlowe Quintrell")).toBeNull();
    expect(rosterScopeForManager("salon_director", account.email, account.full)).toBeNull();
    expect(rosterScopeForManager("district_manager", account.email, account.full)?.level).toBe("district");
  });
});
