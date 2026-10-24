import { describe, expect, it } from "vitest";

import { extractEmployeeNames, titleAfterJobTitleLabel } from "./proposal";
import { employeeNamedOnPurpose, rosterValidatedName, stripNonNameTokens } from "./roster-validated-name";
import { isFieldLabelWord, isOnlyFieldLabel, nameAfterNameLabel, stripFieldLabels } from "./name-words";

const ROSTER = [
  { id: "evangeline", firstName: "Evangeline", lastName: "Pembury", preferredFirstName: null, salonIds: ["loc-0463"] },
];
const SALONS = ["KS Shawnee Mission Pkwy"];

const NAME_LINE = "Name: Evangeline Pembury, job title tanning consultant";

describe("field label words", () => {
  it("treats job, title, position, role, location, salon and store as labels", () => {
    for (const word of ["job", "title", "position", "role", "location", "salon", "store"]) {
      expect(isFieldLabelWord(word)).toBe(true);
    }
    expect(stripFieldLabels("position role location salon store")).toBeNull();
  });

  it("s8: Job title is not a name", () => {
    expect(stripFieldLabels("Job title")).toBeNull();
    expect(stripFieldLabels("Title")).toBeNull();
    expect(rosterValidatedName("Job title", [], SALONS)).toBeNull();
    expect(rosterValidatedName("what does policy say about pets in salon", [], SALONS)).toBeNull();
    expect(rosterValidatedName("evangeline pembury, tanning consultant at shawnee", ROSTER, SALONS)).toBe(
      "Evangeline Pembury",
    );
    expect(extractEmployeeNames("evangeline pembury, tanning consultant at shawnee")).not.toContain("Job title");
  });

  it("s17: strips a trailing Job or Title only after a full name", () => {
    expect(stripFieldLabels("Larissa Venko Job")).toBe("Larissa Venko");
    expect(stripFieldLabels("Larissa Venko Job title")).toBe("Larissa Venko");
    expect(stripFieldLabels("Evangeline Pembury Title")).toBe("Evangeline Pembury");
    // One given name plus Job is the full name. The trailing word stays.
    expect(stripFieldLabels("Larissa Job")).toBe("Larissa Job");
    expect(stripFieldLabels("Jane Store")).toBe("Jane Store");
    expect(stripFieldLabels("Jane Salon")).toBe("Jane Salon");
    expect(stripFieldLabels("Location Corena Schardt")).toBe("Corena Schardt");
    expect(isOnlyFieldLabel("Job title")).toBe(true);
    expect(isOnlyFieldLabel("Store")).toBe(true);
    expect(isOnlyFieldLabel("Salon")).toBe(true);
    expect(isOnlyFieldLabel("Jane Store")).toBe(false);
    expect(isOnlyFieldLabel("Jane Salon")).toBe(false);
    expect(stripFieldLabels("Store")).toBeNull();
    expect(stripFieldLabels("Salon")).toBeNull();
    expect(stripNonNameTokens("Jane Store", SALONS)).toBe("Jane Store");
    expect(
      stripNonNameTokens("lawrence location tanning consultant, corena schardt", ["KS Lawrence"]),
    ).toBe("corena schardt");
    expect(
      rosterValidatedName(
        "create a coaching form for lawrence location tanning consultant, corena schardt, who was talking on her cell phone for 25 minutes on 9-29-26 when customers were waiting to check in",
        [],
        ["KS Lawrence"],
      ),
    ).toBe("Corena Schardt");
    expect(stripNonNameTokens("Jane Salon", SALONS)).toBe("Jane Salon");
    expect(stripNonNameTokens("Job title", SALONS)).toBeNull();
    expect(stripNonNameTokens("Store", SALONS)).toBeNull();
    expect(rosterValidatedName("create a corrective action for Jane Store, tanning consultant", [], SALONS)).toBe(
      "Jane Store",
    );
    expect(rosterValidatedName("create a corrective action for Jane Salon, tanning consultant", [], SALONS)).toBe(
      "Jane Salon",
    );
    expect(extractEmployeeNames("Larissa Venko Job title: Tanning Consultant")).toContain("Larissa Venko");
    expect(extractEmployeeNames("Larissa Venko Job title: Tanning Consultant")).not.toContain("Larissa Venko Job");
    expect(extractEmployeeNames("The employee is Larissa Venko. Job title: Tanning Consultant.")).not.toContain("Job title");
    expect(
      rosterValidatedName(
        "Betty Sue today under performance for September 270 tans below in PPTA, UPTA, LPSVA, CC% and Spa% verbal warning received Open Ended Questions Coaching 9/8/2026, Focus Item Coaching 9/15/2026, New Product Coaching 9/25/2026 not payroll deductible Tanning Consultant",
        [],
        SALONS,
      ),
    ).toBe("Betty Sue");
  });

  it("keeps the value after Name: Evangeline Pembury, job title tanning consultant", () => {
    expect(nameAfterNameLabel(NAME_LINE)).toBe("Evangeline Pembury");
    expect(stripFieldLabels(NAME_LINE)).toBe("Evangeline Pembury");
    expect(titleAfterJobTitleLabel(NAME_LINE)).toBe("tanning consultant");
    expect(rosterValidatedName(NAME_LINE, ROSTER, SALONS)).toBe("Evangeline Pembury");
    expect(employeeNamedOnPurpose(NAME_LINE, null, ROSTER, SALONS)).toBe("Evangeline Pembury");
    expect(extractEmployeeNames(NAME_LINE)).toContain("Evangeline Pembury");
    expect(extractEmployeeNames(NAME_LINE)).not.toContain("Job title");
    expect(extractEmployeeNames(NAME_LINE).join(" ")).not.toMatch(/\bjob\b/i);
  });
});
