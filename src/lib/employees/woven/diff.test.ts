import { describe, expect, it } from "vitest";

import { diffEmployee, MISSING_THRESHOLD, missingChange, recordHash, type ResolvedEmployee } from "./diff";
import type { DirectoryRecord, LocationAffiliation } from "./types";

/**
 * Change detection, one kind at a time — including the things that must NOT
 * be recorded as changes.
 */

const PRIMARY: LocationAffiliation = {
  wovenLocationId: "WL-0306",
  locationName: "KS Manhattan",
  kind: "primary",
  startsOn: null,
  expiresOn: null,
};

function resolved(overrides: Partial<ResolvedEmployee> = {}): ResolvedEmployee {
  return {
    externalEmployeeId: "E1",
    firstName: "Avery",
    lastName: "Stone",
    preferredName: null,
    workEmail: "avery@suntancity.test",
    employmentStatus: "active",
    hireDate: "2024-03-11",
    terminationDate: null,
    positionId: "POS-SC",
    positionName: "Salon Consultant",
    primaryLocationId: "WL-0306",
    primaryLocationName: "KS Manhattan",
    affiliations: [PRIMARY],
    affiliationsVerified: true,
    hasMultipleLocations: false,
    sourceUpdatedAt: null,
    issues: [],
    ...overrides,
  };
}

function onFile(overrides: Partial<DirectoryRecord> = {}): DirectoryRecord {
  const { affiliationsVerified: _v, hasMultipleLocations: _h, issues: _i, sourceUpdatedAt: _s, ...base } = resolved();
  void _v;
  void _h;
  void _i;
  void _s;
  return { ...base, id: "row-1", affiliationsVerifiedAt: "2026-09-01T00:00:00Z", missingSyncCount: 0, recordHash: "x", ...overrides };
}

const kinds = (changes: ReturnType<typeof diffEmployee>) => changes.map((c) => c.kind);

describe("diffEmployee", () => {
  it("records a new employee, marked as initial load on the first sync", () => {
    const [change] = diffEmployee(undefined, resolved(), { initialLoad: true });
    expect(change.kind).toBe("new_employee");
    expect(change.details).toEqual({ initialLoad: true });
    expect(diffEmployee(undefined, resolved(), { initialLoad: false })[0].details).toEqual({ initialLoad: false });
  });

  it("records nothing when nothing changed", () => {
    expect(diffEmployee(onFile(), resolved(), { initialLoad: false })).toEqual([]);
  });

  it("records a termination, and says access was not changed", () => {
    const [change] = diffEmployee(
      onFile(),
      resolved({ employmentStatus: "terminated", terminationDate: "2026-09-20" }),
      { initialLoad: false },
    );
    expect(change.kind).toBe("terminated");
    expect(change.toValue).toEqual({ employmentStatus: "terminated", terminationDate: "2026-09-20" });
    expect(change.details).toEqual({ accessChanged: false });
  });

  it("records a reactivation", () => {
    const changes = diffEmployee(
      onFile({ employmentStatus: "terminated", terminationDate: "2026-01-01" }),
      resolved({ employmentStatus: "active", hireDate: "2026-09-01" }),
      { initialLoad: false },
    );
    expect(kinds(changes)).toEqual(["reactivated"]);
  });

  it("does not record a termination when the status is merely unknown", () => {
    expect(diffEmployee(onFile(), resolved({ employmentStatus: "unknown" }), { initialLoad: false })).toEqual([]);
  });

  it("records a position change as UNCLASSIFIED — never as a promotion", () => {
    const [change] = diffEmployee(
      onFile(),
      resolved({ positionId: "POS-SD", positionName: "Salon Director" }),
      { initialLoad: false },
    );
    expect(change.kind).toBe("position_changed");
    expect(change.details).toEqual({ direction: "unclassified" });
    expect(JSON.stringify(change)).not.toMatch(/promot|demot/i);
  });

  it("does not record a position change when PositionID is simply missing", () => {
    expect(diffEmployee(onFile(), resolved({ positionId: null }), { initialLoad: false })).toEqual([]);
  });

  it("does not record a rename of the same PositionID", () => {
    expect(diffEmployee(onFile(), resolved({ positionName: "Consultant II" }), { initialLoad: false })).toEqual([]);
  });

  it("records a primary-location change as a transfer", () => {
    const [change] = diffEmployee(
      onFile(),
      resolved({ primaryLocationId: "WL-0144", primaryLocationName: "NE Lincoln", affiliations: [{ ...PRIMARY, wovenLocationId: "WL-0144" }] }),
      { initialLoad: false },
    );
    expect(change.kind).toBe("primary_location_changed");
    expect(change.details).toEqual({ classification: "transfer" });
    expect(change.fromValue).toEqual({ primaryLocationId: "WL-0306", primaryLocationName: "KS Manhattan" });
  });

  it("records added and removed affiliations, noting temporary ones", () => {
    const additional: LocationAffiliation = { ...PRIMARY, wovenLocationId: "WL-0144", kind: "additional" };
    const borrowed: LocationAffiliation = { ...PRIMARY, wovenLocationId: "WL-0200", kind: "temporary", expiresOn: "2026-10-31" };

    const changes = diffEmployee(
      onFile({ affiliations: [PRIMARY, additional] }),
      resolved({ affiliations: [PRIMARY, borrowed] }),
      { initialLoad: false },
    );
    expect(changes.map((c) => [c.kind, c.details.temporary])).toEqual([
      ["location_affiliation_added", true],
      ["location_affiliation_removed", false],
    ]);
  });

  it("does NOT record a removal when this run did not read the affiliations", () => {
    const additional: LocationAffiliation = { ...PRIMARY, wovenLocationId: "WL-0144", kind: "additional" };
    const changes = diffEmployee(
      onFile({ affiliations: [PRIMARY, additional] }),
      resolved({ affiliations: [PRIMARY], affiliationsVerified: false }),
      { initialLoad: false },
    );
    expect(changes).toEqual([]);
  });

  it("records a work-email change without re-pointing a login", () => {
    const [change] = diffEmployee(onFile(), resolved({ workEmail: "avery.stone@suntancity.test" }), { initialLoad: false });
    expect(change.kind).toBe("work_email_changed");
    expect(change.details).toEqual({ loginLinkChanged: false });
  });

  it("does not record an email change when the email is missing from this read", () => {
    expect(diffEmployee(onFile(), resolved({ workEmail: null }), { initialLoad: false })).toEqual([]);
  });
});

describe("missingChange", () => {
  it("fires exactly once, at the threshold, and never changes the status", () => {
    const fired = [0, 1, 2, 3, 4].map((count) => missingChange(onFile({ missingSyncCount: count })));
    expect(fired.filter(Boolean)).toHaveLength(1);
    expect(fired[MISSING_THRESHOLD - 1]?.details).toEqual({ consecutiveMisses: MISSING_THRESHOLD, statusChanged: false });
  });
});

describe("recordHash", () => {
  it("is stable for the same content and differs when content differs", () => {
    expect(recordHash(resolved(), [])).toBe(recordHash(resolved(), []));
    expect(recordHash(resolved(), [])).not.toBe(recordHash(resolved({ positionId: "POS-SD" }), []));
    expect(recordHash(resolved(), ["missing_work_email"])).not.toBe(recordHash(resolved(), []));
    expect(recordHash(resolved(), [])).toMatch(/^[0-9a-f]{64}$/);
  });
});
