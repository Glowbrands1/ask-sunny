import { describe, expect, it } from "vitest";

import { suggestionForEmail } from "./invite-suggestion";
import type { DirectoryRow, LocationMappingRow, PositionMappingRow } from "./view-types";

/**
 * What Woven may SUGGEST for an invitation. The recurring theme: a suggestion
 * is only ever as strong as a decision a person already confirmed, it is never
 * broader than that, and anything unreliable is left out and explained.
 */

function row(overrides: Partial<DirectoryRow> = {}): DirectoryRow {
  return {
    id: "d1",
    externalEmployeeId: "E-1",
    firstName: "Carley",
    lastName: "Rowe",
    preferredFirstName: null,
    emailAddress: "carley.rowe@suntancity.com",
    employmentStatus: "active",
    positionId: "P-SD",
    positionName: "Salon Director",
    positionMappingStatus: "mapped",
    primaryLocationId: "L-0306",
    primaryLocationName: "KC Wornall",
    primaryLocationMappingStatus: "mapped",
    primarySalonNumber: "0306",
    additionalLocations: [],
    temporaryOrExpiringLocations: [],
    activeLocationCount: 1,
    hasUnmappedLocation: false,
    hasMultipleLocationAccess: false,
    hasAllLocationAccess: false,
    hireDate: null,
    terminationDate: null,
    dataIssues: [],
    missingSyncCount: 0,
    lastSeenAt: "",
    lastSyncedAt: "",
    lastChangeKind: null,
    lastChangeClassification: null,
    lastChangeAt: null,
    recentChangeKinds: [],
    ...overrides,
  };
}

function position(overrides: Partial<PositionMappingRow> = {}): PositionMappingRow {
  return {
    wovenPositionId: "P-SD",
    name: "Salon Director",
    employeeCount: 1,
    status: "mapped",
    role: "salon_director",
    scopeLevel: "salon",
    hierarchyRank: 1,
    isConfirmed: true,
    reviewedBy: "admin",
    reviewedAt: "2026-10-01T00:00:00Z",
    ...overrides,
  };
}

function location(id: string, salonNumber: string | null, status: LocationMappingRow["status"] = "mapped"): LocationMappingRow {
  return {
    wovenLocationId: id,
    name: id,
    displayName: null,
    number: salonNumber,
    districtName: null,
    regionName: null,
    isClosed: false,
    isNonLocation: false,
    employeeCount: 1,
    status,
    salonNumber: status === "mapped" ? salonNumber : null,
    salonName: null,
    suggestedSalonNumber: null,
    suggestedSalonName: null,
    reviewedBy: null,
    reviewedAt: null,
  };
}

const LOCATIONS = [
  location("L-0306", "0306"),
  location("L-0394", "0394"),
  location("L-0468", "0468"),
  location("L-NEW", null, "unmapped"),
  location("L-CORP", null, "ignored"),
];

const suggest = (r: DirectoryRow, positions = [position()], locations = LOCATIONS, email = r.emailAddress ?? "") =>
  suggestionForEmail(email, [r], positions, locations);

function found(result: ReturnType<typeof suggest>) {
  if (result.status !== "found") throw new Error(`expected found, got ${result.status}`);
  return result;
}

describe("a Woven employee with one location", () => {
  it("suggests name, role, scope and primary, with no additional locations", () => {
    const { suggestion, notes } = found(suggest(row()));
    expect(suggestion).toEqual({
      displayName: "Carley Rowe",
      role: "salon_director",
      scopeLevel: "salon",
      primaryAreaId: "loc-0306",
      additionalAreaIds: [],
    });
    expect(notes).toEqual([]);
  });

  it("matches the email case-insensitively and ignoring surrounding space", () => {
    expect(found(suggest(row(), undefined, undefined, "  CARLEY.Rowe@SunTanCity.com ")).suggestion?.role).toBe("salon_director");
  });
});

describe("additional locations", () => {
  it("suggests mapped additional locations by the reviewed Woven id", () => {
    const r = row({
      additionalLocations: [
        { wovenLocationId: "L-0394", name: "KC Liberty", number: "394" },
        { wovenLocationId: "L-0468", name: "Lawrence", number: "468" },
      ],
      activeLocationCount: 3,
    });
    expect(found(suggest(r)).suggestion?.additionalAreaIds).toEqual(["loc-0394", "loc-0468"]);
  });

  it("uses the mapping, never Woven's raw location number", () => {
    /* Woven's number says 0306 but the REVIEWED mapping says this is Liberty. */
    const r = row({ additionalLocations: [{ wovenLocationId: "L-0394", name: "x", number: "0306" }] });
    expect(found(suggest(r)).suggestion?.additionalAreaIds).toEqual(["loc-0394"]);
  });

  it("excludes the primary and de-duplicates", () => {
    const r = row({
      additionalLocations: [
        { wovenLocationId: "L-0306", name: "same as primary", number: null },
        { wovenLocationId: "L-0394", name: "a", number: null },
        { wovenLocationId: "L-0394", name: "a again", number: null },
      ],
    });
    expect(found(suggest(r)).suggestion?.additionalAreaIds).toEqual(["loc-0394"]);
  });

  it("does not guess an unmapped location: it is named in a note instead", () => {
    const r = row({ additionalLocations: [{ wovenLocationId: "L-NEW", name: "Brand New Salon", number: null }] });
    const { suggestion, notes } = found(suggest(r));
    expect(suggestion?.additionalAreaIds).toEqual([]);
    expect(notes.join(" ")).toContain("Brand New Salon");
  });

  it("skips a deliberate non-salon location (an office) silently", () => {
    const r = row({ additionalLocations: [{ wovenLocationId: "L-CORP", name: "Corporate", number: null }] });
    const { suggestion, notes } = found(suggest(r));
    expect(suggestion?.additionalAreaIds).toEqual([]);
    expect(notes).toEqual([]);
  });

  it("never suggests temporary or expiring access", () => {
    const r = row({ temporaryOrExpiringLocations: [{ wovenLocationId: "L-0394", name: "Borrowed", number: null, expiresOn: "2026-12-01" }] });
    const { suggestion, notes } = found(suggest(r));
    expect(suggestion?.additionalAreaIds).toEqual([]);
    expect(notes.join(" ")).toMatch(/temporary or expiring/i);
  });
});

describe("it must not grant higher privileges", () => {
  it("never suggests an administrative role, whatever the mapping says", () => {
    for (const role of ["admin", "owner", "developer"]) {
      const { suggestion, notes } = found(suggest(row(), [position({ role })]));
      expect(suggestion?.role, role).toBeNull();
      expect(suggestion?.scopeLevel, role).toBeNull();
      expect(notes.join(" "), role).toMatch(/administrative or corporate role/);
    }
  });

  it("never suggests a global scope", () => {
    const { suggestion } = found(suggest(row(), [position({ scopeLevel: "global" })]));
    expect(suggestion?.scopeLevel).toBe("salon");
  });

  it("a mapping can narrow a role's reach but never widen it", () => {
    /* Salon Director mapped with a REGION scope: still one salon. */
    expect(found(suggest(row(), [position({ scopeLevel: "region" })])).suggestion?.scopeLevel).toBe("salon");
    /* District manager mapped to a salon scope: narrowed to a salon. */
    const dm = found(suggest(row(), [position({ role: "district_manager", scopeLevel: "salon" })]));
    expect(dm.suggestion?.role).toBe("district_manager");
    expect(dm.suggestion?.scopeLevel).toBe("salon");
  });

  it("suggests no role for a position a person has not confirmed", () => {
    for (const p of [position({ isConfirmed: false }), position({ status: "unmapped", role: null }), position({ status: "ignored", role: null })]) {
      const { suggestion, notes } = found(suggest(row(), [p]));
      expect(suggestion?.role).toBeNull();
      expect(suggestion?.scopeLevel).toBeNull();
      expect(suggestion?.primaryAreaId).toBeNull();
      expect(notes.join(" ")).toMatch(/not been confirmed/);
    }
  });

  it("suggests no role when the employee has no position", () => {
    const { suggestion } = found(suggest(row({ positionId: null, positionName: null })));
    expect(suggestion?.role).toBeNull();
  });

  it("does not guess a district or region: Woven names a salon, not an area", () => {
    const { suggestion, notes } = found(suggest(row(), [position({ role: "regional_manager", scopeLevel: "region" })]));
    expect(suggestion?.role).toBe("regional_manager");
    expect(suggestion?.scopeLevel).toBe("region");
    expect(suggestion?.primaryAreaId).toBeNull();
    expect(notes.join(" ")).toMatch(/choose the region yourself/);
  });
});

describe("primary location", () => {
  it("is left out when the Woven location is unmapped, ignored, missing or off the roster", () => {
    for (const r of [
      row({ primaryLocationId: "L-NEW" }),
      row({ primaryLocationId: "L-CORP" }),
      row({ primaryLocationId: null, primaryLocationName: null }),
      row({ primaryLocationId: "L-X" }),
    ]) {
      expect(found(suggest(r)).suggestion?.primaryAreaId, r.primaryLocationId ?? "none").toBeNull();
    }
    expect(found(suggest(row(), undefined, [location("L-0306", "9999")])).suggestion?.primaryAreaId).toBeNull();
  });
});

describe("who gets a suggestion at all", () => {
  it("an unknown email is simply not found", () => {
    expect(suggestionForEmail("nobody@suntancity.com", [row()], [position()], LOCATIONS)).toEqual({ status: "not_found" });
    expect(suggestionForEmail("", [row()], [position()], LOCATIONS)).toEqual({ status: "not_found" });
  });

  it("a Woven employee without an email is not matched by an empty address", () => {
    expect(suggestionForEmail("   ", [row({ emailAddress: null })], [position()], LOCATIONS)).toEqual({ status: "not_found" });
  });

  it("two Woven employees sharing the address suggest nothing", () => {
    const result = suggestionForEmail("carley.rowe@suntancity.com", [row(), row({ id: "d2", externalEmployeeId: "E-2" })], [position()], LOCATIONS);
    expect(result.status).toBe("ambiguous");
    expect(JSON.stringify(result)).not.toContain("salon_director");
  });

  it("a terminated employee is shown but nothing is suggested", () => {
    const result = found(suggest(row({ employmentStatus: "terminated" })));
    expect(result.suggestion).toBeNull();
    expect(result.notes.join(" ")).toMatch(/terminated/);
  });

  it("an employee Woven did not read this run is not treated as active", () => {
    const result = found(suggest(row({ missingSyncCount: 2 })));
    expect(result.suggestion).toBeNull();
    expect(result.notes.join(" ")).toMatch(/did not confirm/);
  });
});

describe("what the suggestion reveals", () => {
  it("carries no email, Woven id or internal location id", () => {
    const text = JSON.stringify(found(suggest(row({ additionalLocations: [{ wovenLocationId: "L-0394", name: "Liberty", number: null }] }))));
    expect(text).not.toContain("carley.rowe@");
    expect(text).not.toContain("E-1");
    expect(text).not.toContain("L-0394");
  });
});
