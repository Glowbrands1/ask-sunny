import { describe, expect, it } from "vitest";

import { parseEnums, statusResolver } from "./enums";
import { normalizeEmployee, readAffiliations, readCatalogLocation, readDate, readId, withDetails } from "./normalize";
import { FAKE_ENUMS, FAKE_STATUS, SENSITIVE_MARKER, wovenDetails, wovenEmployee, wovenLocation } from "./test-support";

/**
 * ============================================================================
 * THE ALLOWLIST, AGAINST RECORDS SHAPED LIKE THE OPENAPI EXPORT
 * ============================================================================
 */

const statuses = statusResolver(parseEnums(FAKE_ENUMS));
const TODAY = "2026-09-29";
const normalize = (record: unknown) => normalizeEmployee(record, { statuses, today: TODAY });

function ok(record: unknown) {
  const result = normalize(record);
  if (!result.ok) throw new Error(`expected ok, got ${result.reason}`);
  return result.employee;
}

describe("the allowlist", () => {
  it("keeps exactly the approved fields, read from their spec keys", () => {
    const e = ok(wovenEmployee("100", { preferredFirstName: "Sam", hasMultipleLocationAccess: false }));
    expect(Object.keys(e).sort()).toEqual(
      [
        "affiliationSource",
        "affiliations",
        "email" + "Address",
        "employeeLoginId",
        "employmentStatus",
        "employmentStatusCode",
        "externalEmployeeId",
        "externalHrisId",
        "firstName",
        "hasAllLocationAccess",
        "hasMultipleLocationAccess",
        "hireDate",
        "issues",
        "lastName",
        "positionId",
        "positionName",
        "preferredFirstName",
        "primaryLocationId",
        "primaryLocationName",
        "startDate",
        "terminationDate",
        "terminationLastDayWorked",
        "terminationTypeCode",
        "wovenLoginAllowed",
      ].sort(),
    );
    expect(e).toMatchObject({
      externalEmployeeId: "100",
      employeeLoginId: "LOGIN-100",
      externalHrisId: "HRIS-100",
      firstName: "First100",
      lastName: "Last100",
      preferredFirstName: "Sam",
      emailAddress: "employee100@suntancity.test",
      employmentStatus: "active",
      employmentStatusCode: 1,
      hireDate: "2024-03-11",
      startDate: "2024-03-18",
      positionId: "POS-SC",
      positionName: "Salon Consultant",
      primaryLocationId: "WL-0306",
      primaryLocationName: "KS Manhattan",
      hasMultipleLocationAccess: false,
      hasAllLocationAccess: false,
      wovenLoginAllowed: true,
    });
  });

  it("drops every sensitive field the list and details responses carry", () => {
    const e = ok(wovenEmployee("100"));
    const withLocations = withDetails({ ...e, affiliations: null, affiliationSource: null }, wovenDetails("100", [{ id: "WL-0306" }]));
    for (const value of [e, withLocations]) {
      expect(JSON.stringify(value)).not.toContain(SENSITIVE_MARKER);
    }
  });

  it("does not keep the rehire decision, the termination reason or Woven's role", () => {
    const text = JSON.stringify(ok(wovenEmployee("100")));
    for (const key of ["Rehire", "Reason", "RoleID", "RoleName", "Username", "CellPhone", "DateOfBirth"]) {
      expect(text).not.toContain(key);
    }
  });
});

describe("identity", () => {
  it("rejects a record with no EmployeeID", () => {
    const record = wovenEmployee("100");
    delete record.EmployeeID;
    expect(normalize(record)).toEqual({ ok: false, reason: "missing_employee_id" });
  });

  it("rejects an id outside the directory's pattern, and the all-zero GUID", () => {
    expect(normalize(wovenEmployee("has spaces"))).toEqual({ ok: false, reason: "invalid_employee_id" });
    expect(normalize(wovenEmployee("00000000-0000-0000-0000-000000000000"))).toEqual({ ok: false, reason: "invalid_employee_id" });
    expect(readId("00000000-0000-0000-0000-000000000000")).toBeNull();
  });

  it("accepts a GUID EmployeeID", () => {
    expect(ok(wovenEmployee("3f9c2a1e-0000-4000-8000-000000000001")).externalEmployeeId).toBe("3f9c2a1e-0000-4000-8000-000000000001");
  });

  it("rejects a non-object", () => {
    expect(normalize("nope")).toEqual({ ok: false, reason: "not_an_object" });
  });
});

describe("employment status comes only from the Status integer, via /lists/enums", () => {
  it("resolves Active and Terminated", () => {
    expect(ok(wovenEmployee("1", { status: FAKE_STATUS.active })).employmentStatus).toBe("active");
    expect(ok(wovenEmployee("2", { status: FAKE_STATUS.terminated })).employmentStatus).toBe("terminated");
  });

  it("reads any other label — On Leave — as unknown, never as terminated", () => {
    const e = ok(wovenEmployee("3", { status: FAKE_STATUS.onLeave }));
    expect(e.employmentStatus).toBe("unknown");
    expect(e.issues).toContain("unknown_status");
  });

  it("reads an integer the enum list does not name as unknown", () => {
    expect(ok(wovenEmployee("4", { status: 99 })).employmentStatus).toBe("unknown");
  });

  it("reads every status as unknown when the enum list is unavailable", () => {
    const none = statusResolver(null);
    expect(none.source).toBe("none");
    const e = normalizeEmployee(wovenEmployee("5"), { statuses: none, today: TODAY });
    expect(e.ok && e.employee.employmentStatus).toBe("unknown");
  });

  it("does not infer termination from a date; flags the conflict instead", () => {
    const e = ok(wovenEmployee("6", { status: FAKE_STATUS.active, terminationDate: "2026-01-01T00:00:00" }));
    expect(e.employmentStatus).toBe("active");
    expect(e.issues).toContain("status_termination_conflict");
  });

  it("keeps the raw Status and TerminationType integers", () => {
    const e = ok(wovenEmployee("7", { status: FAKE_STATUS.terminated, terminationType: 2, lastDayWorked: "2026-09-25T00:00:00" }));
    expect(e.employmentStatusCode).toBe(2);
    expect(e.terminationTypeCode).toBe(2);
    expect(e.terminationLastDayWorked).toBe("2026-09-25");
  });
});

describe("dates", () => {
  it("reads the .NET unset date as null, never as year one", () => {
    expect(readDate("0001-01-01T00:00:00")).toBeNull();
    expect(ok(wovenEmployee("1")).terminationDate).toBeNull();
  });

  it("rejects impossible dates rather than rolling them over", () => {
    expect(readDate("2026-02-31T00:00:00")).toBeNull();
    expect(readDate("2026-02-28T00:00:00")).toBe("2026-02-28");
  });
});

describe("email is Woven's EmailAddress, as provided", () => {
  it("is stored trimmed and NOT lower-cased or filtered by domain", () => {
    expect(ok(wovenEmployee("1", { email: "  Sam.Smith@Personal-Mail.test " })).emailAddress).toBe("Sam.Smith@Personal-Mail.test");
  });

  it("missing email is an issue, not a failure", () => {
    const e = ok(wovenEmployee("1", { email: null }));
    expect(e.emailAddress).toBeNull();
    expect(e.issues).toContain("missing_email");
  });

  it("an address that is not an address is dropped with an issue", () => {
    const e = ok(wovenEmployee("1", { email: "not-an-email" }));
    expect(e.emailAddress).toBeNull();
    expect(e.issues).toContain("invalid_email");
  });
});

describe("other data-quality issues never fail the employee", () => {
  it("missing PositionID, including the all-zero GUID", () => {
    expect(ok(wovenEmployee("1", { positionId: null })).issues).toContain("missing_position_id");
    expect(ok(wovenEmployee("1", { positionId: "00000000-0000-0000-0000-000000000000" })).issues).toContain("missing_position_id");
  });

  it("missing primary location", () => {
    expect(ok(wovenEmployee("1", { primaryLocationId: null })).issues).toContain("missing_primary_location");
  });

  it("a vendor employee is flagged", () => {
    expect(ok(wovenEmployee("1", { vendorId: "VENDOR-1" })).issues).toContain("vendor_employee");
    expect(ok(wovenEmployee("1")).issues).not.toContain("vendor_employee");
  });
});

describe("locations", () => {
  it("settles locations from the list row when HasMultipleLocationAccess is false", () => {
    const e = ok(wovenEmployee("1", { hasMultipleLocationAccess: false }));
    expect(e.affiliationSource).toBe("list_flag");
    expect(e.affiliations).toEqual([
      { wovenLocationId: "WL-0306", locationName: "KS Manhattan", locationNumber: null, accessType: "primary", expiresOn: null },
    ]);
  });

  it("leaves locations UNKNOWN for multiple-location, all-location or unstated access", () => {
    for (const e of [
      ok(wovenEmployee("1", { hasMultipleLocationAccess: true })),
      ok(wovenEmployee("2", { hasMultipleLocationAccess: null })),
      ok(wovenEmployee("3", { hasMultipleLocationAccess: false, allLocationAccess: true })),
    ]) {
      expect(e.affiliations).toBeNull();
      expect(e.affiliationSource).toBeNull();
    }
  });

  it("reads primary, additional and temporary-or-expiring access from details — never 'borrowed'", () => {
    const details = wovenDetails("1", [
      { id: "WL-0306", name: "KS Manhattan", number: "0306" },
      { id: "WL-0144", name: "NE Lincoln", number: "0144" },
      { id: "WL-0500", name: "Somewhere", expires: "2026-10-12T00:00:00" },
    ]);
    const list = readAffiliations(details, { primaryLocationId: "WL-0306", primaryLocationName: "KS Manhattan" });
    expect(list).toEqual([
      { wovenLocationId: "WL-0306", locationName: "KS Manhattan", locationNumber: "0306", accessType: "primary", expiresOn: null },
      { wovenLocationId: "WL-0144", locationName: "NE Lincoln", locationNumber: "0144", accessType: "additional", expiresOn: null },
      { wovenLocationId: "WL-0500", locationName: "Somewhere", locationNumber: null, accessType: "temporary_or_expiring_access", expiresOn: "2026-10-12" },
    ]);
    expect(JSON.stringify(list)).not.toMatch(/borrow/i);
  });

  it("reads the .NET unset ExpiresOn as no expiry", () => {
    const list = readAffiliations(wovenDetails("1", [{ id: "WL-1" }]), { primaryLocationId: "WL-0", primaryLocationName: null });
    expect(list?.find((a) => a.wovenLocationId === "WL-1")?.accessType).toBe("additional");
  });

  it("adds the primary when details omit it", () => {
    const list = readAffiliations(wovenDetails("1", [{ id: "WL-0144" }]), { primaryLocationId: "WL-0306", primaryLocationName: "KS Manhattan" });
    expect(list?.map((a) => [a.wovenLocationId, a.accessType])).toEqual([
      ["WL-0306", "primary"],
      ["WL-0144", "additional"],
    ]);
  });

  it("reads details with no Locations array as unknown, not as none", () => {
    expect(readAffiliations({ EmployeeID: "1" }, { primaryLocationId: "WL-0306", primaryLocationName: null })).toBeNull();
  });

  it("reads an ALL-LOCATION employee's empty Locations[] as unknown, never as 'no locations'", () => {
    expect(readAffiliations({ Locations: [] }, { primaryLocationId: "WL-0306", primaryLocationName: null }, { allLocationAccess: true })).toBeNull();
    expect(readAffiliations({ Locations: [] }, { primaryLocationId: "WL-0306", primaryLocationName: null })?.length).toBe(1);
  });

  it("marks details-sourced locations as a full read", () => {
    const e = ok(wovenEmployee("1", { hasMultipleLocationAccess: true }));
    const merged = withDetails(e, wovenDetails("1", [{ id: "WL-0306" }, { id: "WL-0144" }]));
    expect(merged.affiliationSource).toBe("details");
    expect(merged.affiliations).toHaveLength(2);
  });
});

describe("the location catalog", () => {
  it("reads Number, district, region, closed and non-location — and nothing sensitive", () => {
    const entry = readCatalogLocation(wovenLocation("WL-0306", { name: "KS Manhattan", number: "0306", nonLocation: false }));
    expect(entry).toEqual({
      wovenLocationId: "WL-0306",
      name: "KS Manhattan",
      displayName: "KS Manhattan",
      number: "0306",
      districtId: "22222222-2222-2222-2222-222222222222",
      districtName: "North",
      regionId: "33333333-3333-3333-3333-333333333333",
      regionName: "Central",
      isClosed: false,
      isNonLocation: false,
    });
    expect(JSON.stringify(entry)).not.toContain(SENSITIVE_MARKER);
  });

  it("skips an entry with no LocationID", () => {
    expect(readCatalogLocation({ Name: "x" })).toBeNull();
  });
});
