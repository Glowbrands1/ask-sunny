import { describe, expect, it } from "vitest";

import {
  classifyNewEmployee,
  classifyPositionChange,
  diffEmployee,
  MISSING_THRESHOLD,
  missingChange,
  recordHash,
  type DiffOptions,
  type ResolvedEmployee,
} from "./diff";
import type { DirectoryRecord, LocationAffiliation, PositionMapEntry } from "./types";

/**
 * Change detection, one kind at a time — including the things that must NOT
 * be recorded as changes.
 */

const TODAY = "2026-09-29";

const PRIMARY: LocationAffiliation = {
  wovenLocationId: "WL-0306",
  locationName: "KS Manhattan",
  locationNumber: "0306",
  accessType: "primary",
  expiresOn: null,
};
const OTHER: LocationAffiliation = {
  wovenLocationId: "WL-0144",
  locationName: "NE Lincoln",
  locationNumber: "0144",
  accessType: "additional",
  expiresOn: null,
};
const EXPIRING: LocationAffiliation = {
  wovenLocationId: "WL-0500",
  locationName: "Somewhere",
  locationNumber: null,
  accessType: "temporary_or_expiring_access",
  expiresOn: "2026-09-27",
};

function resolved(overrides: Partial<ResolvedEmployee> = {}): ResolvedEmployee {
  return {
    externalEmployeeId: "E1",
    employeeLoginId: "L1",
    externalHrisId: "H1",
    firstName: "Avery",
    lastName: "Stone",
    preferredFirstName: null,
    emailAddress: "avery@suntancity.test",
    employmentStatus: "active",
    employmentStatusCode: 1,
    hireDate: "2024-03-11",
    startDate: "2024-03-18",
    terminationDate: null,
    terminationLastDayWorked: null,
    terminationTypeCode: null,
    positionId: "POS-SC",
    positionName: "Salon Consultant",
    primaryLocationId: "WL-0306",
    primaryLocationName: "KS Manhattan",
    hasMultipleLocationAccess: false,
    hasAllLocationAccess: false,
    wovenLoginAllowed: true,
    affiliations: [PRIMARY],
    affiliationsVerified: true,
    affiliationSource: "list_flag",
    issues: [],
    ...overrides,
  };
}

function onFile(overrides: Partial<DirectoryRecord> = {}): DirectoryRecord {
  const { affiliationsVerified: _v, affiliationSource: _s, issues: _i, ...base } = resolved();
  void _v;
  void _s;
  void _i;
  return { ...base, id: "row-1", affiliationsVerifiedAt: "2026-09-01T00:00:00Z", missingSyncCount: 0, recordHash: "x", ...overrides };
}

function positions(entries: Record<string, Partial<PositionMapEntry>>): Map<string, PositionMapEntry> {
  return new Map(
    Object.entries(entries).map(([id, e]) => [
      id,
      { wovenPositionId: id, status: "mapped", isConfirmed: true, hierarchyRank: null, ...e } as PositionMapEntry,
    ]),
  );
}

function opts(overrides: Partial<DiffOptions> = {}): DiffOptions {
  return { initialLoad: false, today: TODAY, newHireWindowDays: 30, positions: new Map(), ...overrides };
}

const kinds = (changes: ReturnType<typeof diffEmployee>) => changes.map((c) => c.kind);

describe("new employees", () => {
  it("are an initial load on the very first sync, with the hire date as effective date", () => {
    const [change] = diffEmployee(undefined, resolved(), opts({ initialLoad: true }));
    expect(change.kind).toBe("new_employee");
    expect(change.classification).toBe("initial_load");
    expect(change.effectiveDate).toBe("2024-03-11");
  });

  it("are a NEW HIRE only when hired or started within 30 days", () => {
    expect(classifyNewEmployee(resolved({ startDate: "2026-09-22", hireDate: "2026-09-20" }), opts())).toBe("new_hire");
    expect(classifyNewEmployee(resolved({ startDate: "2026-10-05" }), opts())).toBe("new_hire");
  });

  it("are NEWLY VISIBLE when the hire date is older, or missing", () => {
    expect(classifyNewEmployee(resolved(), opts())).toBe("newly_visible");
    expect(classifyNewEmployee(resolved({ startDate: null, hireDate: null }), opts())).toBe("newly_visible");
  });
});

describe("employment status", () => {
  it("records nothing when nothing changed", () => {
    expect(diffEmployee(onFile(), resolved(), opts())).toEqual([]);
  });

  it("records a termination with Woven's own dates, and says access was not changed", () => {
    const [change] = diffEmployee(
      onFile(),
      resolved({ employmentStatus: "terminated", terminationDate: "2026-09-26", terminationLastDayWorked: "2026-09-25", terminationTypeCode: 1 }),
      opts(),
    );
    expect(change.kind).toBe("terminated");
    expect(change.fieldName).toBe("employment_status");
    expect(change.effectiveDate).toBe("2026-09-26");
    expect(change.details).toMatchObject({ lastDayWorked: "2026-09-25", terminationTypeCode: 1, accessChanged: false });
  });

  it("records a termination that follows an unrecognised status, such as a leave", () => {
    expect(kinds(diffEmployee(onFile({ employmentStatus: "unknown" }), resolved({ employmentStatus: "terminated" }), opts()))).toEqual(["terminated"]);
  });

  it("records a reactivation as a rehire, dated by the new start date", () => {
    const [change] = diffEmployee(
      onFile({ employmentStatus: "terminated", terminationDate: "2026-01-01" }),
      resolved({ startDate: "2026-09-25" }),
      opts(),
    );
    expect(change.kind).toBe("reactivated");
    expect(change.classification).toBe("rehire");
    expect(change.effectiveDate).toBe("2026-09-25");
  });

  it("records NOTHING for a move into unknown, or from unknown to active", () => {
    expect(diffEmployee(onFile(), resolved({ employmentStatus: "unknown" }), opts())).toEqual([]);
    expect(diffEmployee(onFile({ employmentStatus: "unknown" }), resolved(), opts())).toEqual([]);
  });
});

describe("position changes", () => {
  it("are UNCLASSIFIED without a position map — never a promotion by default", () => {
    const [change] = diffEmployee(onFile(), resolved({ positionId: "POS-SD", positionName: "Salon Director" }), opts());
    expect(change.kind).toBe("position_changed");
    expect(change.classification).toBe("unclassified");
    expect(change.effectiveDate).toBeNull();
    expect(change.details).toMatchObject({ roleChanged: false });
  });

  it("are unclassified when either side is unconfirmed or unranked", () => {
    expect(classifyPositionChange("A", "B", positions({ A: { hierarchyRank: 10 } }))).toBe("unclassified");
    expect(classifyPositionChange("A", "B", positions({ A: { hierarchyRank: 10 }, B: { hierarchyRank: 30, isConfirmed: false } }))).toBe("unclassified");
    expect(classifyPositionChange("A", "B", positions({ A: { hierarchyRank: 10 }, B: { hierarchyRank: null } }))).toBe("unclassified");
    expect(classifyPositionChange(null, "B", positions({ B: { hierarchyRank: 30 } }))).toBe("unclassified");
  });

  it("are a CONFIRMED promotion or demotion only when both are confirmed and ranked", () => {
    const map = positions({ SC: { hierarchyRank: 10 }, SD: { hierarchyRank: 30 }, LEAD: { hierarchyRank: 10 } });
    expect(classifyPositionChange("SC", "SD", map)).toBe("promotion_confirmed");
    expect(classifyPositionChange("SD", "SC", map)).toBe("demotion_confirmed");
    expect(classifyPositionChange("SC", "LEAD", map)).toBe("lateral");
    const [change] = diffEmployee(onFile({ positionId: "SC" }), resolved({ positionId: "SD" }), opts({ positions: map }));
    expect(change.classification).toBe("promotion_confirmed");
  });

  it("are not recorded when PositionID is simply missing, or only the name changed", () => {
    expect(diffEmployee(onFile(), resolved({ positionId: null }), opts())).toEqual([]);
    expect(diffEmployee(onFile(), resolved({ positionName: "Renamed" }), opts())).toEqual([]);
  });
});

describe("locations", () => {
  it("records a primary move as a transfer, and a first primary as assigned", () => {
    const [transfer] = diffEmployee(
      onFile(),
      resolved({ primaryLocationId: "WL-0144", primaryLocationName: "NE Lincoln", affiliations: [{ ...OTHER, accessType: "primary" }] }),
      opts(),
    );
    expect(transfer.kind).toBe("primary_location_changed");
    expect(transfer.classification).toBe("transfer");
    const [assigned] = diffEmployee(onFile({ primaryLocationId: null, affiliations: [] }), resolved(), opts());
    expect(assigned.classification).toBe("assigned");
  });

  it("does not ALSO call the new primary 'added' or the old one 'removed'", () => {
    const changes = diffEmployee(
      onFile(),
      resolved({ primaryLocationId: "WL-0144", affiliations: [{ ...OTHER, accessType: "primary" }] }),
      opts(),
    );
    expect(kinds(changes)).toEqual(["primary_location_changed"]);
  });

  it("records location access added and removed, with the access type and expiry", () => {
    const changes = diffEmployee(onFile({ affiliations: [PRIMARY, EXPIRING] }), resolved({ affiliations: [PRIMARY, OTHER] }), opts());
    expect(kinds(changes).sort()).toEqual(["location_access_added", "location_access_removed"]);
    const added = changes.find((c) => c.kind === "location_access_added")!;
    const removed = changes.find((c) => c.kind === "location_access_removed")!;
    expect(added.fieldName).toBe("location:WL-0144");
    expect(added.classification).toBe("additional");
    expect(removed.classification).toBe("expired");
    expect(removed.effectiveDate).toBe("2026-09-27");
  });

  it("classifies new expiring access as temporary_or_expiring_access, and never as borrowed", () => {
    const [added] = diffEmployee(onFile(), resolved({ affiliations: [PRIMARY, { ...EXPIRING, expiresOn: "2026-10-12" }] }), opts());
    expect(added.classification).toBe("temporary_or_expiring_access");
    expect(JSON.stringify(added)).not.toMatch(/borrow/i);
  });

  it("calls a removal 'removed', not 'expired', when the expiry has not passed", () => {
    const [removed] = diffEmployee(onFile({ affiliations: [PRIMARY, { ...EXPIRING, expiresOn: "2026-12-31" }] }), resolved(), opts());
    expect(removed.classification).toBe("removed");
    expect(removed.effectiveDate).toBeNull();
  });

  it("records NO location change when this run did not read the list", () => {
    expect(diffEmployee(onFile({ affiliations: [PRIMARY, OTHER] }), resolved({ affiliationsVerified: false }), opts())).toEqual([]);
  });

  it("records nothing when only the access type changed", () => {
    expect(diffEmployee(onFile({ affiliations: [PRIMARY, OTHER] }), resolved({ affiliations: [PRIMARY, { ...OTHER, accessType: "temporary_or_expiring_access", expiresOn: "2026-12-01" }] }), opts())).toEqual([]);
  });
});

describe("email", () => {
  it("records an email change without re-pointing a login", () => {
    const [change] = diffEmployee(onFile(), resolved({ emailAddress: "new@suntancity.test" }), opts());
    expect(change.kind).toBe("email_changed");
    expect(change.fieldName).toBe("email_address");
    expect(change.details).toMatchObject({ loginLinkChanged: false });
  });

  it("compares case-insensitively, and ignores a missing email", () => {
    expect(diffEmployee(onFile(), resolved({ emailAddress: "AVERY@SunTanCity.test" }), opts())).toEqual([]);
    expect(diffEmployee(onFile(), resolved({ emailAddress: null }), opts())).toEqual([]);
  });
});

describe("the change vocabulary", () => {
  it("uses only the normalised names", () => {
    const every = [
      ...diffEmployee(undefined, resolved(), opts()),
      ...diffEmployee(onFile({ affiliations: [PRIMARY, EXPIRING] }), resolved({
        employmentStatus: "terminated",
        positionId: "POS-X",
        primaryLocationId: "WL-0144",
        emailAddress: "x@y.test",
        affiliations: [{ ...OTHER, accessType: "primary" }, { ...PRIMARY, accessType: "additional" }, { ...EXPIRING, wovenLocationId: "WL-9" }],
      }), opts()),
    ];
    for (const kind of kinds(every)) {
      expect(["new_employee", "terminated", "reactivated", "position_changed", "primary_location_changed", "location_access_added", "location_access_removed", "email_changed", "missing_from_source"]).toContain(kind);
    }
    expect(JSON.stringify(every)).not.toMatch(/location_affiliation_|work_email_changed/);
  });
});

describe("missingChange", () => {
  it("fires exactly once, at the threshold, and never changes the status", () => {
    expect(missingChange(onFile({ missingSyncCount: MISSING_THRESHOLD - 2 }))).toBeNull();
    const change = missingChange(onFile({ missingSyncCount: MISSING_THRESHOLD - 1 }));
    expect(change?.kind).toBe("missing_from_source");
    expect(change?.details).toMatchObject({ statusChanged: false });
    expect(missingChange(onFile({ missingSyncCount: MISSING_THRESHOLD }))).toBeNull();
  });
});

describe("recordHash", () => {
  it("is stable for the same content and differs when content differs", () => {
    expect(recordHash(resolved(), [])).toBe(recordHash(resolved(), []));
    expect(recordHash(resolved(), [])).not.toBe(recordHash(resolved({ positionId: "POS-SD" }), []));
    expect(recordHash(resolved(), [])).not.toBe(recordHash(resolved({ terminationTypeCode: 2 }), []));
    expect(recordHash(resolved(), ["missing_email"])).not.toBe(recordHash(resolved(), []));
  });
});
