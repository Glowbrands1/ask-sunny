import { describe, expect, it } from "vitest";

import {
  EXCLUDED_EMPLOYEE_NAMES_ENV,
  configuredExcludedNames,
  excludedRecordsNote,
  isProductionRecord,
  nonProductionReason,
} from "./production-records";
import { DEMO_LOCATIONS } from "@/data/demo/locations";

/**
 * The 14 September review: "The Overview follow-up queue includes 'Jordan Vance
 * (test)', 'suzy sunshine', 'Ace Test', and a salon called Maple Crossing,
 * which is not one of our 15 salons. Let's get this cleaned up before rollout."
 *
 * Those are live rows created by testing against the deployment. What is tested
 * here is the MECHANISM that keeps such a record off a manager's summary — not
 * a list of those names, which are deliberately nowhere in the source.
 */

const REAL_SALON = DEMO_LOCATIONS[0].name;

describe("a salon that is not on the roster is not production data", () => {
  it("holds back a record filed against a salon the business does not operate", () => {
    /*
     * "Maple Crossing" is caught STRUCTURALLY, by not being one of the fifteen
     * — so the next invented salon is caught too, without anybody adding it to
     * a list.
     */
    const reason = nonProductionReason({
      employeeName: "Someone",
      locationName: "Maple Crossing",
    });
    expect(reason).toBe("salon_not_on_roster");
    expect(isProductionRecord({ employeeName: "Someone", locationName: "Maple Crossing" })).toBe(
      false,
    );
  });

  it("keeps every record filed against a real salon", () => {
    for (const location of DEMO_LOCATIONS) {
      expect(
        isProductionRecord({ employeeName: "Someone", locationName: location.name }),
      ).toBe(true);
    }
  });

  it("matches a roster name whatever its spacing or case", () => {
    expect(
      isProductionRecord({
        employeeName: "Someone",
        locationName: `  ${REAL_SALON.toUpperCase()}  `,
      }),
    ).toBe(true);
  });

  it("treats a record with NO salon as production data", () => {
    /*
     * A form can legitimately carry no salon: an administrator's account covers
     * every salon rather than one, and `proposeLocation` fills in nothing for
     * them. Treating a blank as suspicious would hide an administrator's own
     * real work.
     */
    expect(isProductionRecord({ employeeName: "Someone", locationName: null })).toBe(true);
  });
});

describe("the explicit exclusion list is configuration, and empty by default", () => {
  it("excludes nothing when the variable is unset", () => {
    expect(configuredExcludedNames({}).size).toBe(0);
    expect(configuredExcludedNames({ [EXCLUDED_EMPLOYEE_NAMES_ENV]: "" }).size).toBe(0);
  });

  it("reads a comma-separated list", () => {
    const names = configuredExcludedNames({
      [EXCLUDED_EMPLOYEE_NAMES_ENV]: "Test Person, Another Tester",
    });
    expect(names.has("test person")).toBe(true);
    expect(names.has("another tester")).toBe(true);
  });

  it("holds back a configured name filed against a real salon", () => {
    const excludedNames = configuredExcludedNames({
      [EXCLUDED_EMPLOYEE_NAMES_ENV]: "Test Person",
    });
    expect(
      nonProductionReason(
        { employeeName: "Test Person", locationName: REAL_SALON },
        { excludedNames },
      ),
    ).toBe("excluded_by_configuration");
    // And leaves everyone else alone.
    expect(
      isProductionRecord(
        { employeeName: "A Real Manager", locationName: REAL_SALON },
        { excludedNames },
      ),
    ).toBe(true);
  });

  it("compares names insensitively to case and spacing", () => {
    const excludedNames = configuredExcludedNames({
      [EXCLUDED_EMPLOYEE_NAMES_ENV]: "test person",
    });
    expect(
      isProductionRecord(
        { employeeName: "  TEST   PERSON ", locationName: REAL_SALON },
        { excludedNames },
      ),
    ).toBe(false);
  });
});

describe("no stakeholder example is compiled into the product", () => {
  it("names none of the four records the review found", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("src/lib/forms/production-records.ts", "utf8");
    /*
     * The review's examples appear in the header, where they record what this
     * mechanism is for. What must not exist is a hard-coded list — a name in a
     * source file is a guess that ages badly and cannot be changed without a
     * deploy. Stripping the comments is how the two are told apart.
     */
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    for (const name of ["Jordan Vance", "suzy sunshine", "Ace Test", "Maple Crossing"]) {
      expect(code).not.toContain(name);
    }
  });
});

describe("holding a record back is said out loud", () => {
  it("names the count and where the records still are", () => {
    expect(excludedRecordsNote(1)).toMatch(/1 record is/);
    expect(excludedRecordsNote(3)).toMatch(/3 records are/);
    expect(excludedRecordsNote(3)).toMatch(/still in Form Monitoring/);
    // Nothing is described as deleted, because nothing is.
    expect(excludedRecordsNote(3)).not.toMatch(/delet|remov/i);
  });
});

/**
 * ============================================================================
 * THE ID IS THE FIELD THAT SURVIVES ON THE LIVE TABLE
 * ============================================================================
 *
 * The roster guard originally read `locationName` only, and against the real
 * `form_instance_overview` that catches very little: on 14 September, thirteen
 * of the sixteen outstanding follow-ups carry a null `location_name`.
 *
 * One of those is `suzy sunshine`, which the review named by hand. It carries
 * `loc-109` — a salon id from the retired twelve-store demo roster — and no
 * name at all. The same roster rule applied to the ID catches it; applied to
 * the name it could not, because there was no name to apply it to.
 */
describe("the roster guard on the salon id", () => {
  it("refuses a record filed against a salon id the roster does not know", () => {
    // The retired demo roster's ids, which is what the live test rows carry.
    for (const locationId of ["loc-101", "loc-102", "loc-109", "loc-111"]) {
      expect(
        isProductionRecord({ employeeName: "Someone", locationName: null, locationId }),
        locationId,
      ).toBe(false);
      expect(
        nonProductionReason({ employeeName: "Someone", locationName: null, locationId }),
      ).toBe("salon_not_on_roster");
    }
  });

  it("catches suzy sunshine, which the name check could not", () => {
    expect(
      isProductionRecord({
        employeeName: "suzy sunshine",
        locationName: null,
        locationId: "loc-109",
      }),
    ).toBe(false);
  });

  it("keeps every record filed against a salon on the roster", () => {
    for (const location of DEMO_LOCATIONS) {
      expect(
        isProductionRecord({
          employeeName: "A Real Employee",
          locationName: null,
          locationId: location.id,
        }),
        location.id,
      ).toBe(true);
    }
  });

  it("keeps a record with NO salon at all", () => {
    /*
     * An administrator's form legitimately carries no salon — see
     * `proposeLocation` — so an absent id says nothing either way. Refusing it
     * would hide real work, which is worse than showing a test record.
     */
    expect(
      isProductionRecord({ employeeName: "An Administrator", locationName: null }),
    ).toBe(true);
    expect(
      isProductionRecord({ employeeName: "An Administrator", locationName: null, locationId: null }),
    ).toBe(true);
  });

  it("still refuses on the NAME when only the name is present", () => {
    // The original rule is unchanged; the id check is an addition, not a
    // replacement. Jordan Vance's row carries both.
    expect(
      isProductionRecord({
        employeeName: "Jordan Vance (test)",
        locationName: "Maple Crossing",
        locationId: "loc-102",
      }),
    ).toBe(false);
  });
});
