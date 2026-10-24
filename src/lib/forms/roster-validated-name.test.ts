import { describe, expect, it } from "vitest";

import type { RosterEmployee } from "./employee-match";
import { explicitIncidentIso } from "./explicit-incident-date";
import { printedPageForPolicy } from "./printed-policy-pages";
import { employeeNamedOnPurpose, rosterValidatedName, stripNonNameTokens } from "./roster-validated-name";

const ROSTER: RosterEmployee[] = [
  { id: "colene", firstName: "Colene", lastName: "Schildt", preferredFirstName: null, salonIds: ["loc-0462"] },
  { id: "lisa", firstName: "Lisa", lastName: "Smith", preferredFirstName: null, salonIds: ["loc-0468"] },
  { id: "erin", firstName: "Erin", lastName: "Nelson", preferredFirstName: null, salonIds: ["loc-0313"] },
  { id: "paisley", firstName: "Paisley", lastName: "Peklo", preferredFirstName: null, salonIds: ["loc-0313"] },
  { id: "christiana", firstName: "Christiana", lastName: "Headley", preferredFirstName: null, salonIds: ["loc-0463"] },
];

const SALONS = ["KS Manhattan", "KS Lawrence", "KS Shawnee Mission Pkwy", "NE Kearney", "NE Omaha 132nd and Maple"];

describe("roster-validated name", () => {
  it("strips job title, salon, and promo tokens", () => {
    expect(stripNonNameTokens("Job title Lawrence PPTA", SALONS)).toBeNull();
    expect(stripNonNameTokens("tanning consultant at manhattan", SALONS)).toBeNull();
  });

  it("fills an exact roster name and keeps a typed miss and a person who is not on the roster", () => {
    expect(rosterValidatedName("employee name is colene schildt", ROSTER, SALONS)).toBe("Colene Schildt");
    expect(rosterValidatedName("lisa smith, tanning consultant at lawrence. use todays date", ROSTER, SALONS)).toBe("Lisa Smith");
    expect(
      rosterValidatedName("christiana headley, tanning consultant at shawnee", ROSTER, SALONS),
    ).toBe("Christiana Headley");
    expect(
      rosterValidatedName(
        "Betty Sue today under performance for September 270 tans below in PPTA, UPTA, LPSVA, CC% and Spa%",
        ROSTER,
        SALONS,
      ),
    ).toBe("Betty Sue");
    expect(rosterValidatedName("create a corrective action form for Pasiley Peklo", ROSTER, SALONS)).toBe("Pasiley Peklo");
    expect(
      rosterValidatedName(
        "create a corrective action for Colene Shildt, tanning consultant at manhattan",
        ROSTER,
        SALONS,
      ),
    ).toBe("Colene Shildt");
    expect(rosterValidatedName("name is test testy who is an assistant salon manager", [], SALONS)).toBe("Test Testy");
    expect(rosterValidatedName("name is TT and use todays date to create coaching form", [], SALONS)).toBe("TT");
    expect(
      rosterValidatedName(
        "create a CA form for ima employee, tan consultant at manhattan, for opening salon late on 9-28-26",
        [],
        SALONS,
      ),
    ).toBe("Ima");
    expect(
      rosterValidatedName("create a coaching form for Test Employee, Tanning Consultant at Manhattan", [], SALONS),
    ).toBe("Test Employee");
    expect(rosterValidatedName("Can you create me a performance CA?", [], SALONS)).toBeNull();
    expect(rosterValidatedName("show draft", [], SALONS)).toBeNull();
    expect(
      rosterValidatedName("The form is the Corrective Action Form.\nThe employee is Betty Sue. Job title: Tanning Consultant.", [], SALONS),
    ).toBe("Betty Sue");
    expect(rosterValidatedName("The form is the Coaching Form.\nThe employee is Lisa Smith. Job title: Tanning Consultant.", ROSTER, SALONS)).toBe(
      "Lisa Smith",
    );
    expect(rosterValidatedName("what does policy say about pets in salon", [], SALONS)).toBeNull();
    expect(
      rosterValidatedName("do verbal for team member sadie hoffart at empire, sd", [], SALONS),
    ).toBe("Sadie Hoffart");
    expect(
      rosterValidatedName(
        "for all expenses incurred. Managers or District Managers will be responsible for offering restitution",
        [],
        SALONS,
      ),
    ).toBeNull();
    expect(
      rosterValidatedName(
        "Betty Sue today under performance for September 270 tans below in PPTA, UPTA, LPSVA, CC% and Spa% verbal warning received Open Ended Questions Coaching 9/8/2026, Focus Item Coaching 9/15/2026, New Product Coaching 9/25/2026 not payroll deductible Tanning Consultant",
        [],
        SALONS,
      ),
    ).toBe("Betty Sue");
  });

  it("does not replace a stored name when the turn does not rename anyone", () => {
    expect(employeeNamedOnPurpose("create the ca", "Erin Nelson", ROSTER, SALONS)).toBeNull();
    expect(employeeNamedOnPurpose("erin", "Erin Nelson", ROSTER, SALONS)).toBeNull();
    expect(employeeNamedOnPurpose("employee name is colene schildt", "Test Testy", ROSTER, SALONS)).toBe("Colene Schildt");
    expect(
      employeeNamedOnPurpose(
        "Betty Sue today under performance for September 270 tans below in PPTA",
        null,
        ROSTER,
        SALONS,
      ),
    ).toBe("Betty Sue");
    expect(
      employeeNamedOnPurpose("last day worked was 9-20-26. management called her with no response on 9-27-26", "Christiana Headley", ROSTER, SALONS),
    ).toBeNull();
    expect(
      employeeNamedOnPurpose(
        "colene gave and worked 2 week notice. colene messaged management her resignation via woven",
        "Colene Schildt",
        ROSTER,
        SALONS,
      ),
    ).toBeNull();
    expect(employeeNamedOnPurpose("christiana headley, tanning consultant at shawnee", "Say Pets", ROSTER, SALONS)).toBe(
      "Christiana Headley",
    );
  });
});

describe("explicit incident date", () => {
  it("keeps 9-28 when the next turn only dates a prior verbal ca", () => {
    expect(explicitIncidentIso("opening salon late on 9-28-26", "2026-10-23")).toBe("2026-09-28");
    expect(
      explicitIncidentIso("this should be a written and note a verbal ca was given on 9-1-26", "2026-10-23"),
    ).toBeNull();
    expect(explicitIncidentIso("jba manual 11-1-25", "2026-10-23")).toBeNull();
    expect(
      explicitIncidentIso(
        "Betty Sue today under performance for September 270 tans below in PPTA verbal warning received Open Ended Questions Coaching 9/8/2026, Focus Item Coaching 9/15/2026, New Product Coaching 9/25/2026",
        "2026-10-23",
      ),
    ).toBe("2026-10-23");
  });
});

describe("s8 and b12 turns", () => {
  it("keeps Christiana and Sadie across later turns", () => {
    const s8 = [
      "what does policy say about pets in salon",
      "assist with creating an exit form",
      "christiana headley, tanning consultant at shawnee",
      "last day worked was 9-20-26. management called her with no response on 9-27-26",
      "its a no call no show",
      "create exit form",
      "create exit: Christiana Headley, Tanning Consultant, KS Shawnee Mission Pkwy\nLast day worked 9/20/26\nNo call/no show; management attempted phone contact 9/27/26, no response",
    ];
    let named: string | null = null;
    for (const turn of s8) {
      const next = employeeNamedOnPurpose(turn, named, ROSTER, SALONS);
      if (next) named = next;
    }
    expect(named).toBe("Christiana Headley");

    const b12 = [
      "do verbal for team member sadie hoffart at empire, sd. payroll deduct does not apply. previous coaching jba manual 11-1-26. on 10-22-26 sadie was not scheduled to work and came into the store to show her team her new puppy. Sadie was in the store 45 min",
      "jba manual 11-1-25",
      "cite pets in workplace",
      "cite animals in the workplace policy",
    ];
    named = null;
    for (const turn of b12) {
      const next = employeeNamedOnPurpose(turn, named, ROSTER, SALONS);
      if (next) named = next;
    }
    expect(named).toBe("Sadie Hoffart");
  });
});

describe("printed policy pages", () => {
  it("maps the manual sections the cases cite", () => {
    expect(printedPageForPolicy("Attendance")).toBe(14);
    expect(printedPageForPolicy("Late Opening")).toBe(15);
    expect(printedPageForPolicy("Dress Code")).toBe(15);
    expect(printedPageForPolicy("Cell Phone/Smart Watch Policy")).toBe(19);
    expect(printedPageForPolicy("Standards of Conduct")).toBe(12);
    expect(printedPageForPolicy("Animals in the Workplace")).toBe(30);
  });
});
