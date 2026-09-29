import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { changeToRow, employeeToRow, locationToRow, type EmployeeWrite } from "./store";

/**
 * ============================================================================
 * THE COMMIT PAYLOAD MATCHES THE MIGRATION, KEY FOR KEY
 * ============================================================================
 *
 * `employee_sync_commit_run` reads its payload with `jsonb_populate_recordset`
 * and `jsonb_to_recordset`, which IGNORE a key they do not know and NULL a
 * column they are not given — silently. A renamed key would store every
 * employee with no email, or no locations, and nothing would fail. So the
 * keys `store.ts` sends are asserted against the column lists in the
 * migration file itself.
 */

const MIGRATION = readFileSync(
  join(__dirname, "..", "..", "..", "..", "supabase", "migrations", "20260928002000_woven_employee_directory.sql"),
  "utf8",
);

function columnsOf(block: string): string[] {
  return block
    .split("\n")
    .map((line) => line.trim().match(/^([a-z_]+)\s+[a-z]/)?.[1])
    .filter((c): c is string => Boolean(c));
}

function recordsetAfter(marker: string): string[] {
  const start = MIGRATION.indexOf(marker);
  expect(start, marker).toBeGreaterThan(-1);
  const open = MIGRATION.indexOf("(", start + marker.length - 1);
  const rest = MIGRATION.slice(open + 1);
  /* The column list ends at the first line that is only a closing parenthesis. */
  const close = rest.search(/\n\s*\)/);
  return columnsOf(rest.slice(0, close));
}

const write: EmployeeWrite = {
  externalEmployeeId: "E1",
  employeeLoginId: null,
  externalHrisId: null,
  firstName: null,
  lastName: null,
  preferredFirstName: null,
  emailAddress: null,
  employmentStatus: "active",
  employmentStatusCode: 1,
  hireDate: null,
  startDate: null,
  terminationDate: null,
  terminationLastDayWorked: null,
  terminationTypeCode: null,
  positionId: null,
  positionName: null,
  primaryLocationId: null,
  primaryLocationName: null,
  hasMultipleLocationAccess: null,
  hasAllLocationAccess: null,
  wovenLoginAllowed: null,
  affiliations: [{ wovenLocationId: "L1", locationName: null, locationNumber: null, accessType: "primary", expiresOn: null }],
  issues: [],
  recordHash: "a".repeat(64),
};

describe("the commit payload", () => {
  it("sends exactly the columns of public.employee_sync_incoming", () => {
    const columns = recordsetAfter("create type public.employee_sync_incoming as (");
    expect(Object.keys(employeeToRow(write)).sort()).toEqual(columns.sort());
  });

  it("sends affiliation entries with exactly the columns step 3b reads", () => {
    const columns = recordsetAfter("cross join lateral jsonb_to_recordset(i.affiliations) as l(");
    expect(Object.keys((employeeToRow(write).affiliations as Record<string, unknown>[])[0]).sort()).toEqual(columns.sort());
  });

  it("sends null affiliations for a partial read, so SQL only asserts the primary", () => {
    expect(employeeToRow({ ...write, affiliations: null }).affiliations).toBeNull();
  });

  it("sends changes with exactly the columns step 4 reads", () => {
    const columns = recordsetAfter("from jsonb_to_recordset(p_changes) as c(");
    const row = changeToRow({
      externalEmployeeId: "E1",
      kind: "email_changed",
      fieldName: "email_address",
      fromValue: null,
      toValue: null,
      classification: null,
      effectiveDate: null,
      details: {},
    });
    expect(Object.keys(row).sort()).toEqual(columns.sort());
  });

  it("sends locations with exactly the columns step 5 reads", () => {
    const columns = recordsetAfter("from jsonb_to_recordset(p_locations) as l(");
    expect(Object.keys(locationToRow({ wovenLocationId: "L1" })).sort()).toEqual(columns.sort());
  });

  it("uses no retired key", () => {
    const text = JSON.stringify([employeeToRow(write), changeToRow({ externalEmployeeId: "E1", kind: "email_changed", fieldName: null, fromValue: null, toValue: null, classification: null, effectiveDate: null, details: {} })]);
    for (const retired of ["work_email", "preferred_name\"", "location_affiliations", "source_updated_at", "affiliations_verified\"", "\"kind\"", "starts_on"]) {
      expect(text).not.toContain(retired);
    }
  });
});
