import { describe, expect, it } from "vitest";

import type { GroundedPerson } from "../grounded-entities";
import { checkDate, checkReading, quoted, type CheckContext } from "./check";
import { mergeCheckedReading } from "./merge";
import { parseFormReading } from "./schema";

/**
 * AI_READS_CODE_CHECKS_ENABLED: the code keeps only what the manager's own
 * words support. The turns are QA's production seeds (27 Oct 2026), word for
 * word, with every person invented.
 */

const person = (id: string, firstName: string, lastName: string, salonIds: string[] = ["loc-0309"]): GroundedPerson => ({
  id,
  firstName,
  lastName,
  preferredFirstName: null,
  salonIds,
  title: null,
  primaryLocationName: null,
  primarySalonId: null,
});

const PEOPLE = [
  person("e-1", "Quinn", "Marlowe"),
  person("e-2", "Dale", "Ferris"),
  person("e-3", "Mara", "Quill"),
  person("e-4", "Ivy", "Hollis", ["loc-0462"]),
];

const S1 =
  "My employee quinn marlowe has was 10 minutes late on her last two shifts. On the first shift I verbally coached her on our policy and expectations. Then she was late again. Please create a CA form so I can document. She was late on 10/5 and 10/15";
const S2 = "create a ca for quinn marlowe at kearney, she was late on 10-5 and 10-15. i coached her on 10-16 about being late";

const context = (managerTurns: string[]): CheckContext => ({
  managerTurns,
  people: PEOPLE,
  locations: [
    { id: "loc-0309", name: "NE Kearney" },
    { id: "loc-0310", name: "NE Lincoln 27th Street" },
    { id: "loc-0311", name: "NE Lincoln O Street" },
  ],
  headings: ["Attendance", "Tardiness"],
  today: "2026-10-27",
});

const read = (fields: Record<string, unknown>) => parseFormReading(fields)!;

describe("the quote must be the manager's words", () => {
  it("ignores case, spacing and punctuation, never the assistant's lines", () => {
    expect(quoted("Quinn Marlowe", [S1])).toBe(true);
    expect(quoted("QUINN  MARLOWE,", [S1])).toBe(true);
    expect(quoted("Quinn Marlowe was late", [S1])).toBe(false);
    expect(quoted("", [S1])).toBe(false);
  });

  it("drops a value whose quote the manager never wrote", () => {
    const checked = checkReading(
      read({ employee: { value: "Dale Ferris", evidence: "for dale ferris" }, incidentDate: { value: "2026-10-15", evidence: "on 10/15" } }),
      context([S1]),
    );
    expect(checked.employee).toBeNull();
    expect(checked.incidentDate).toBeNull();
    expect(checked.rejected).toEqual(["employee", "incidentDate"]);
  });
});

describe("the employee is one person on the roster", () => {
  const name = (value: string, evidence: string, turn: string) =>
    checkReading(read({ employee: { value, evidence } }), context([turn])).employee?.name ?? null;

  it("reads a first name only, Last, First, and a one-letter typo", () => {
    expect(name("quinn", "My employee quinn has", S1.replace("quinn marlowe", "quinn"))).toBe("Quinn Marlowe");
    expect(name("Marlowe, Quinn", "for Marlowe, Quinn at", S2.replace("quinn marlowe", "Marlowe, Quinn"))).toBe("Quinn Marlowe");
    expect(name("quin marlowe", "for quin marlowe at", S2.replace("quinn", "quin"))).toBe("Quinn Marlowe");
  });

  it("keeps nobody when the words fit two people or none", () => {
    const twoQuinns = { ...context([S2]), people: [...PEOPLE, person("e-9", "Quinn", "Ferris")] };
    expect(checkReading(read({ employee: { value: "quinn", evidence: "quinn" } }), twoQuinns).employee).toBeNull();
    expect(name("dodge", "at dodge", "create a ca for the employee at dodge")).toBeNull();
    expect(name("quinn ferris", "quinn ferris", "create a ca for quinn ferris")).toBeNull();
  });
});

describe("dates", () => {
  it("accepts the shapes managers write, and only the day the quote says", () => {
    for (const evidence of ["10/15", "10-15", "10-15-26", "10.15", "oct 15", "october 15th", "15 october"]) {
      expect(checkDate("2026-10-15", evidence, "2026-10-27"), evidence).toBe("2026-10-15");
    }
    expect(checkDate("2026-10-15", "the 15th", "2026-10-27")).toBe("2026-10-15");
    expect(checkDate("2026-10-16", "10/15", "2026-10-27")).toBeNull();
    expect(checkDate("2025-10-15", "10/15", "2026-10-27")).toBeNull();
    expect(checkDate("2026-10-28", "10/28", "2026-10-27")).toBeNull();
  });

  it("an incident date the manager gave for a prior step is not the incident date", () => {
    const checked = checkReading(
      read({
        incidentDate: { value: "2026-10-16", evidence: "i coached her on 10-16" },
        priorSteps: [{ kind: "coaching", date: "2026-10-16", evidence: "i coached her on 10-16" }],
      }),
      context([S2]),
    );
    expect(checked.incidentDate).toBeNull();
    expect(checked.notIncidentDates).toEqual(["2026-10-16"]);
  });
});

describe("location, level, payroll and policy", () => {
  it("keeps what the quote names, and one location only", () => {
    const checked = checkReading(
      read({
        location: { value: "kearney", evidence: "at kearney" },
        warningLevel: { value: "verbal", evidence: "verbal" },
        payroll: { value: "no", evidence: "no payroll deduct" },
        policyHeading: { value: "Tardiness", evidence: "late" },
      }),
      context([S2, "verbal", "no payroll deduct"]),
    );
    expect(checked.location?.id).toBe("loc-0309");
    expect(checked.warningLevel).toBe("verbal");
    expect(checked.payroll).toBe("no");
    expect(checked.policyHeading).toBe("Tardiness");
    const lincoln = checkReading(read({ location: { value: "lincoln", evidence: "at lincoln" } }), context(["create a ca at lincoln"]));
    expect(lincoln.location).toBeNull();
    const madeUp = checkReading(read({ policyHeading: { value: "Late Arrival", evidence: "late" } }), context([S2]));
    expect(madeUp.policyHeading).toBeNull();
  });

  it("an amount must be in the quote", () => {
    const turn = "payroll deduct $3.25 for the shortage";
    expect(checkReading(read({ payrollAmount: { value: "3.25", evidence: "$3.25" } }), context([turn])).payrollAmount).toBe("$3.25");
    expect(checkReading(read({ payrollAmount: { value: "3", evidence: "$3.25" } }), context([turn])).payrollAmount).toBeNull();
  });
});

describe("the checked reading fills only what today's readers left open", () => {
  const code = {
    employee: { person: null, name: "Marlowe Quinn", ambiguous: [], typed: "Marlowe Quinn" },
    date: { iso: null, ambiguous: ["2026-10-05", "2026-10-15"] },
  };

  it("fills a field the code could not settle, and clears the numbered list", () => {
    const checked = checkReading(
      read({
        employee: { value: "Marlowe, Quinn", evidence: "Marlowe, Quinn" },
        incidentDate: { value: "2026-10-15", evidence: "10/15" },
      }),
      context([S2.replace("quinn marlowe", "Marlowe, Quinn"), "10/15"]),
    );
    const merge = mergeCheckedReading(checked);
    expect(merge.employee(code.employee).name).toBe("Quinn Marlowe");
    expect(merge.date(code.date)).toEqual({ iso: "2026-10-15", ambiguous: [] });
    expect(merge.filled).toEqual(["employee", "incidentDate"]);
  });

  it("never replaces a value today's readers settled; the disagreement is traced", () => {
    const checked = checkReading(read({ incidentDate: { value: "2026-10-05", evidence: "10-5" } }), context([S2]));
    const merge = mergeCheckedReading(checked);
    expect(merge.date({ iso: "2026-10-15", ambiguous: [] }).iso).toBe("2026-10-15");
    expect(merge.disputed).toEqual(["incidentDate"]);
    expect(merge.filled).toEqual([]);
  });

  it("with no checked reading every field is today's, the same object", () => {
    const merge = mergeCheckedReading(null);
    expect(merge.employee(code.employee)).toBe(code.employee);
    expect(merge.date(code.date)).toBe(code.date);
    expect(merge.title("Tanning Consultant")).toBe("Tanning Consultant");
  });

  it("S1 written \"10.5 and 10.15\", then \"10.15\": the newest answer moves past today's 10/05", () => {
    const turns = [S1.replace("10/5 and 10/15", "10.5 and 10.15"), "I already told you the employee name. She is at Kearney", "10.15"];
    const checked = checkReading(read({ incidentDate: { value: "2026-10-15", evidence: "10.15" } }), context(turns));
    expect(checked.incidentDateTurn).toBe(2);
    const merge = mergeCheckedReading(checked);
    expect(merge.date({ iso: "2026-10-05", ambiguous: [] }).iso).toBe("2026-10-15");
    expect(merge.filled).toEqual(["incidentDate"]);
  });

  it("a date stated again in the newest turn stays today's", () => {
    const turns = [S2, "10-15"];
    const checked = checkReading(read({ incidentDate: { value: "2026-10-05", evidence: "10-5" } }), context(turns));
    const merge = mergeCheckedReading(checked);
    expect(merge.date({ iso: "2026-10-15", ambiguous: [] }).iso).toBe("2026-10-15");
  });
});

describe("an amount is not a date", () => {
  it("\"$3.25\" states no March 25th", () => {
    expect(checkDate("2026-03-25", "short $3.25", "2026-10-27")).toBeNull();
  });
});

