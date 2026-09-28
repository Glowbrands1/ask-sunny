import { describe, expect, it } from "vitest";

import { normalizeEmployee, readAffiliations, readDate, withDetails } from "./normalize";
import { SENSITIVE_MARKER, sensitiveFields, wovenDetails, wovenEmployee } from "./test-support";
import type { NormalizedEmployee } from "./types";

/**
 * ============================================================================
 * THE ALLOWLIST — what survives normalisation, and what never can
 * ============================================================================
 */

const OPTIONS = { workEmailDomains: [] as string[], today: "2026-09-28" };

function normalized(record: unknown, options: Partial<typeof OPTIONS> & { impliedStatus?: NormalizedEmployee["employmentStatus"] } = {}) {
  const result = normalizeEmployee(record, { ...OPTIONS, ...options });
  if (!result.ok) throw new Error(`rejected: ${result.reason}`);
  return result.employee;
}

describe("the allowlist", () => {
  it("keeps exactly the approved fields", () => {
    const employee = normalized(wovenEmployee("E1", { firstName: "Avery", lastName: "Stone" }));
    expect(Object.keys(employee).sort()).toEqual(
      [
        "affiliations",
        "employmentStatus",
        "externalEmployeeId",
        "firstName",
        "hasMultipleLocations",
        "hireDate",
        "issues",
        "lastName",
        "positionId",
        "positionName",
        "preferredName",
        "primaryLocationId",
        "primaryLocationName",
        "sourceUpdatedAt",
        "terminationDate",
        "workEmail",
      ].sort(),
    );
    expect(employee).toMatchObject({
      externalEmployeeId: "E1",
      firstName: "Avery",
      lastName: "Stone",
      workEmail: "employeee1@suntancity.test",
      employmentStatus: "active",
      hireDate: "2024-03-11",
      terminationDate: null,
      positionId: "POS-SC",
      positionName: "Salon Consultant",
      primaryLocationId: "WL-0306",
      primaryLocationName: "KS Manhattan",
    });
  });

  it("drops pay, DOB, personal contact, address, I-9, background, notes, documents, banking, payroll and leave data", () => {
    const employee = normalized(wovenEmployee("E1"));
    const withDetail = withDetails(
      { ...employee, affiliations: null },
      wovenDetails("E1", [{ id: "WL-0306", primary: true }, { id: "WL-0144", borrowed: true }]),
    );
    const serialized = JSON.stringify([employee, withDetail]);

    expect(serialized).not.toContain(SENSITIVE_MARKER);
    for (const key of Object.keys(sensitiveFields())) {
      expect(serialized).not.toContain(`"${key}"`);
    }
  });

  it("never reads a plain `Email` key as the work email", () => {
    const record = wovenEmployee("E1", { workEmail: null });
    expect(record.Email).toBeDefined();
    const employee = normalized(record);
    expect(employee.workEmail).toBeNull();
    expect(employee.issues).toContain("missing_work_email");
  });
});

describe("identity", () => {
  it("rejects a record with no employee id", () => {
    const record = wovenEmployee("E1");
    delete record.EmployeeID;
    expect(normalizeEmployee(record, OPTIONS)).toEqual({ ok: false, reason: "missing_employee_id" });
  });

  it("rejects an id outside the directory's pattern", () => {
    expect(normalizeEmployee({ EmployeeID: "has spaces; drop" }, OPTIONS)).toEqual({
      ok: false,
      reason: "invalid_employee_id",
    });
  });

  it("accepts a numeric id as its string form", () => {
    expect(normalized({ ...wovenEmployee("x"), EmployeeID: 4521 }).externalEmployeeId).toBe("4521");
  });

  it("rejects a non-object", () => {
    expect(normalizeEmployee(null, OPTIONS)).toEqual({ ok: false, reason: "not_an_object" });
    expect(normalizeEmployee(["E1"], OPTIONS)).toEqual({ ok: false, reason: "not_an_object" });
  });
});

describe("employment status", () => {
  it("reads Active and Terminated in any case", () => {
    expect(normalized(wovenEmployee("E1", { status: "ACTIVE" })).employmentStatus).toBe("active");
    expect(normalized(wovenEmployee("E1", { status: "terminated" })).employmentStatus).toBe("terminated");
  });

  it("never reads an unrecognised status — including Inactive — as terminated", () => {
    for (const status of ["Inactive", "On Leave", "Suspended", "Seasonal"]) {
      const employee = normalized(wovenEmployee("E1", { status }), { impliedStatus: "terminated" });
      expect(employee.employmentStatus).toBe("unknown");
      expect(employee.issues).toContain("unknown_status");
    }
  });

  it("uses the pass's implied status only when the record states none", () => {
    expect(normalized(wovenEmployee("E1", { status: null }), { impliedStatus: "terminated" }).employmentStatus).toBe(
      "terminated",
    );
  });

  it("falls back to a past termination date", () => {
    const employee = normalized(wovenEmployee("E1", { status: null, terminationDate: "2026-08-01T00:00:00" }));
    expect(employee.employmentStatus).toBe("terminated");
    expect(employee.terminationDate).toBe("2026-08-01");
  });

  it("does not terminate on a FUTURE termination date", () => {
    const employee = normalized(wovenEmployee("E1", { status: null, terminationDate: "2026-12-01" }));
    expect(employee.employmentStatus).toBe("unknown");
  });
});

describe("dates", () => {
  it("reads the .NET unset date as null, never as year one", () => {
    expect(readDate("0001-01-01T00:00:00")).toBeNull();
    expect(normalized(wovenEmployee("E1")).terminationDate).toBeNull();
  });

  it("rejects impossible dates rather than rolling them over", () => {
    expect(readDate("2026-02-31")).toBeNull();
    expect(readDate("not a date")).toBeNull();
    expect(readDate("2026-02-28T13:00:00Z")).toBe("2026-02-28");
  });
});

describe("data-quality issues never fail the employee", () => {
  it("missing email", () => {
    const employee = normalized(wovenEmployee("E1", { workEmail: null }));
    expect(employee.workEmail).toBeNull();
    expect(employee.issues).toContain("missing_work_email");
  });

  it("invalid email", () => {
    const employee = normalized(wovenEmployee("E1", { workEmail: "not-an-email" }));
    expect(employee.workEmail).toBeNull();
    expect(employee.issues).toContain("invalid_work_email");
  });

  it("an email outside the approved domains is not stored", () => {
    const employee = normalized(wovenEmployee("E1", { workEmail: "someone@gmail.test" }), {
      workEmailDomains: ["suntancity.test"],
    });
    expect(employee.workEmail).toBeNull();
    expect(employee.issues).toContain("work_email_not_approved_domain");
    expect(normalized(wovenEmployee("E2"), { workEmailDomains: ["suntancity.test"] }).workEmail).toBe(
      "employeee2@suntancity.test",
    );
  });

  it("lower-cases a work email", () => {
    expect(normalized(wovenEmployee("E1", { workEmail: "  Avery.Stone@SunTanCity.test " })).workEmail).toBe(
      "avery.stone@suntancity.test",
    );
  });

  it("missing PositionID", () => {
    const employee = normalized(wovenEmployee("E1", { positionId: null }));
    expect(employee.positionId).toBeNull();
    expect(employee.issues).toContain("missing_position_id");
  });

  it("missing primary location", () => {
    const employee = normalized(wovenEmployee("E1", { primaryLocationId: null, primaryLocationName: null }));
    expect(employee.primaryLocationId).toBeNull();
    expect(employee.issues).toContain("missing_primary_location");
  });
});

describe("locations", () => {
  it("settles affiliations from the list row when it says there is only one location", () => {
    const employee = normalized(wovenEmployee("E1", { hasMultipleLocations: false }));
    expect(employee.affiliations).toEqual([
      { wovenLocationId: "WL-0306", locationName: "KS Manhattan", kind: "primary", startsOn: null, expiresOn: null },
    ]);
  });

  it("leaves affiliations UNKNOWN when the list row says there are more, or says nothing", () => {
    expect(normalized(wovenEmployee("E1", { hasMultipleLocations: true })).affiliations).toBeNull();
    expect(normalized(wovenEmployee("E1", { hasMultipleLocations: null })).affiliations).toBeNull();
  });

  it("reads primary, additional and temporary (borrowed or expiring) affiliations from details", () => {
    const list = readAffiliations(
      wovenDetails("E1", [
        { id: "WL-0144", name: "NE Lincoln" },
        { id: "WL-0306", name: "KS Manhattan", primary: true },
        { id: "WL-0200", borrowed: true },
        { id: "WL-0300", expires: "2026-10-31T00:00:00" },
      ]),
      { primaryLocationId: "WL-0306", primaryLocationName: "KS Manhattan" },
    );
    expect(list?.map((a) => [a.wovenLocationId, a.kind, a.expiresOn])).toEqual([
      ["WL-0306", "primary", null],
      ["WL-0144", "additional", null],
      ["WL-0200", "temporary", null],
      ["WL-0300", "temporary", "2026-10-31"],
    ]);
  });

  it("keeps exactly one primary even when details flag two", () => {
    const list = readAffiliations(
      wovenDetails("E1", [
        { id: "WL-0144", primary: true },
        { id: "WL-0306", primary: true },
      ]),
      { primaryLocationId: "WL-0306", primaryLocationName: null },
    );
    expect(list?.filter((a) => a.kind === "primary").map((a) => a.wovenLocationId)).toEqual(["WL-0306"]);
  });

  it("adds the primary when details omit it", () => {
    const list = readAffiliations(wovenDetails("E1", [{ id: "WL-0144" }]), {
      primaryLocationId: "WL-0306",
      primaryLocationName: "KS Manhattan",
    });
    expect(list?.map((a) => a.wovenLocationId)).toEqual(["WL-0306", "WL-0144"]);
  });

  it("reads details with no Locations array as unknown, not as none", () => {
    expect(readAffiliations({ EmployeeID: "E1" }, { primaryLocationId: "WL-0306", primaryLocationName: null })).toBeNull();
  });

  it("unwraps a Data envelope", () => {
    const list = readAffiliations(
      { Data: wovenDetails("E1", [{ id: "WL-0144" }]) },
      { primaryLocationId: null, primaryLocationName: null },
    );
    expect(list?.map((a) => a.wovenLocationId)).toEqual(["WL-0144"]);
  });
});
