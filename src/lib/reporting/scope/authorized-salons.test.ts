import { describe, expect, it } from "vitest";

import {
  admitsSalonNumber,
  authorizedLocationIds,
  authorizedSalonNumbers,
  narrowSalonSelection,
  reportingScopeOf,
  rosterSalonNumbers,
  salonNumberOf,
  scopeAreaLabel,
  scopeNoticeSentence,
} from "./authorized-salons";
import { PRODUCTION_SALONS } from "@/data/salons";
import type { AccessScope } from "@/types";

/**
 * ============================================================================
 * THE ACCOUNT THE 14 SEPTEMBER REVIEW TESTED
 * ============================================================================
 *
 * "The second employee view account is labeled Regional Manager but is scoped
 *  to MO Kansas City Wornall."
 *
 * Wornall is `loc-0306`, salon number `0306`, in the Patterson district. Every
 * assertion below is written against that account, because it is the one the
 * reviewer had in front of them.
 */
const WORNALL: AccessScope = {
  level: "salon",
  primaryAreaId: "loc-0306",
  alsoCoversAreaIds: [],
};

const ADMIN: AccessScope = {
  level: "global",
  primaryAreaId: null,
  alsoCoversAreaIds: [],
};

const DISTRICT_3: AccessScope = {
  level: "district",
  primaryAreaId: "dist-patterson-madeline",
  alsoCoversAreaIds: [],
};

const REGION_A: AccessScope = {
  level: "region",
  primaryAreaId: "reg-patterson-madeline",
  alsoCoversAreaIds: [],
};

describe("a salon-scoped account reaches exactly its own salon", () => {
  it("resolves MO Kansas City Wornall to one salon number", () => {
    expect(authorizedSalonNumbers(WORNALL)).toEqual(["0306"]);
  });

  it("is not unrestricted", () => {
    const scope = reportingScopeOf(WORNALL);
    expect(scope.unrestricted).toBe(false);
    expect(scope.salonNumbers).toEqual(["0306"]);
    expect(scope.areaLabel).toBe("MO Kansas City Wornall");
  });

  it("admits its own salon and refuses every other one on the roster", () => {
    const scope = reportingScopeOf(WORNALL);
    expect(admitsSalonNumber(scope, "0306")).toBe(true);
    for (const number of rosterSalonNumbers().filter((entry) => entry !== "0306")) {
      expect(admitsSalonNumber(scope, number)).toBe(false);
    }
  });

  it("refuses a row that carries no salon number at all", () => {
    // Unprovable is not permitted. An unrestricted reader still sees it.
    expect(admitsSalonNumber(reportingScopeOf(WORNALL), null)).toBe(false);
    expect(admitsSalonNumber(reportingScopeOf(ADMIN), null)).toBe(true);
  });
});

describe("an unrestricted account is not narrowed", () => {
  it("returns null for a global scope, which is not the same as an empty list", () => {
    expect(authorizedSalonNumbers(ADMIN)).toBeNull();
    expect(reportingScopeOf(ADMIN).unrestricted).toBe(true);
  });

  it("treats an absent scope as unenforced, matching the Forms posture", () => {
    // A demo actor has no verified identity, so there is no assignment to
    // enforce; live mode refuses an unauthenticated caller before this point.
    expect(authorizedSalonNumbers(null)).toBeNull();
    expect(reportingScopeOf(undefined).unrestricted).toBe(true);
  });
});

describe("district and region scopes resolve through the roster", () => {
  it("gives the Patterson district exactly the salons the roster puts in it", () => {
    const expected = PRODUCTION_SALONS.filter((entry) => entry.districtId === "dist-patterson-madeline")
      .map((entry) => salonNumberOf(entry.id))
      .sort();
    expect(authorizedSalonNumbers(DISTRICT_3)).toEqual(expected);
    expect(authorizedSalonNumbers(DISTRICT_3)).toContain("0306");
  });

  it("gives the region every salon, because production has exactly one", () => {
    /*
     * Reporting reports a single `region_label` across all fifteen rows, so a
     * region scope and the whole roster are the same set today. Asserted as
     * equality rather than as "more than nothing", so a second region arriving
     * in the data fails here instead of silently widening somebody's access.
     */
    const numbers = authorizedSalonNumbers(REGION_A)!;

    expect(numbers.sort()).toEqual(rosterSalonNumbers().sort());
    expect(PRODUCTION_SALONS.every((entry) => entry.regionId === "reg-patterson-madeline")).toBe(
      true,
    );
  });

  it("adds 'also covers' areas to the primary one", () => {
    const both = authorizedSalonNumbers({
      level: "region",
      primaryAreaId: "reg-patterson-madeline",
      alsoCoversAreaIds: ["dist-cotton-sarah"],
    })!;
    expect(both.sort()).toEqual(rosterSalonNumbers().sort());
  });
});

describe("an area the roster cannot resolve fails CLOSED", () => {
  it("yields no salons rather than all of them", () => {
    const unknown = authorizedSalonNumbers({
      level: "district",
      primaryAreaId: "dist-does-not-exist",
      alsoCoversAreaIds: [],
    });
    // EMPTY, not null. Null would mean "unrestricted" and is the failure this
    // whole module exists to prevent.
    expect(unknown).toEqual([]);
    expect(reportingScopeOf({
      level: "district",
      primaryAreaId: "dist-does-not-exist",
      alsoCoversAreaIds: [],
    }).unrestricted).toBe(false);
  });

  it("yields no salons for a salon-level scope with no assignment", () => {
    expect(
      authorizedSalonNumbers({ level: "salon", primaryAreaId: null, alsoCoversAreaIds: [] }),
    ).toEqual([]);
  });

  it("says so in a sentence a reader can act on", () => {
    const scope = reportingScopeOf({
      level: "salon",
      primaryAreaId: null,
      alsoCoversAreaIds: [],
    });
    expect(scopeNoticeSentence(scope)).toMatch(/no salon assigned/i);
    expect(scopeNoticeSentence(scope)).toMatch(/User Management/);
  });
});

describe("a selection can never widen past the boundary", () => {
  const scope = reportingScopeOf(WORNALL);

  it("narrows an empty request to the allowlist rather than to everything", () => {
    expect(narrowSalonSelection(scope, [])).toEqual(["0306"]);
  });

  it("drops a salon the account may not see", () => {
    // The exact prompt-manipulation shape: ask for someone else's salon.
    expect(narrowSalonSelection(scope, ["0313", "0468"])).toEqual([]);
  });

  it("keeps only the intersection when a request mixes both", () => {
    expect(narrowSalonSelection(scope, ["0313", "0306", "0468"])).toEqual(["0306"]);
  });

  it("asking for an unauthorized salon yields NOTHING, never everything", () => {
    // A filter that falls through to "all" on an empty match is how a boundary
    // gets crossed by asking for something outside it.
    const result = narrowSalonSelection(scope, ["0999"]);
    expect(result).toEqual([]);
    expect(result).not.toEqual(scope.salonNumbers);
  });

  it("leaves an unrestricted request untouched", () => {
    const admin = reportingScopeOf(ADMIN);
    expect(narrowSalonSelection(admin, ["0313", "0306"])).toEqual(["0313", "0306"]);
    expect(narrowSalonSelection(admin, [])).toEqual([]);
  });
});

describe("the location-id spelling of the same entitlement", () => {
  it("maps salon numbers back to the form layer's location ids", () => {
    expect(authorizedLocationIds(WORNALL)).toEqual(["loc-0306"]);
  });

  it("is null for an unrestricted account", () => {
    expect(authorizedLocationIds(ADMIN)).toBeNull();
  });

  it("covers a district's salons", () => {
    expect(authorizedLocationIds(DISTRICT_3)).toContain("loc-0306");
    expect(authorizedLocationIds(DISTRICT_3)!.length).toBeGreaterThan(1);
  });
});

describe("salon ids keep their leading zeros", () => {
  it("strips the prefix as text and never parses the number", () => {
    expect(salonNumberOf("loc-0306")).toBe("0306");
    // `Number("0306")` is 306, which is a different salon's history.
    expect(salonNumberOf("loc-0306")).not.toBe("306");
  });

  it("returns null for an id that does not name a salon", () => {
    expect(salonNumberOf("dist-patterson-madeline")).toBeNull();
    expect(salonNumberOf("reg-patterson-madeline")).toBeNull();
    expect(salonNumberOf("loc-")).toBeNull();
  });
});

describe("the notice names the assignment", () => {
  it("labels a salon, a district and a region", () => {
    expect(scopeAreaLabel(WORNALL)).toBe("MO Kansas City Wornall");
    expect(scopeAreaLabel(DISTRICT_3)).toContain("Patterson");
    expect(scopeAreaLabel(REGION_A)).toContain("Patterson");
  });

  it("says nothing for an unrestricted account, which has no assignment", () => {
    expect(scopeAreaLabel(ADMIN)).toBeNull();
    expect(scopeNoticeSentence(reportingScopeOf(ADMIN))).toBeNull();
  });

  it("does not show an internal id to a reader", () => {
    expect(
      scopeAreaLabel({ level: "salon", primaryAreaId: "loc-9999", alsoCoversAreaIds: [] }),
    ).toBeNull();
  });
});
