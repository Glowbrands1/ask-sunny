import { describe, expect, it } from "vitest";

import type { GroundedPerson } from "../grounded-entities";
import type { CheckedReading } from "./check";
import { mergeCheckedReading } from "./merge";

/**
 * AI_READS_CODE_CHECKS_ENABLED: THE INVARIANT — the reader only fills what the
 * rules left open. Every field the merge touches (`mergeCheckedReading`) keeps a
 * value today's readers settled, whatever the reader says, and traces the
 * disagreement; it fills only an open field. This fails if any field ever
 * overwrites a settled value.
 */
const person = (id: string, firstName: string, lastName: string): GroundedPerson => ({
  id,
  firstName,
  lastName,
  preferredFirstName: null,
  salonIds: ["loc-0309"],
  title: null,
  primaryLocationName: null,
  primarySalonId: null,
});

/** Every field the reader can fill, each different from what the rules settle below. */
const READER: CheckedReading = {
  employee: { name: "Tess Varga", person: person("e-2", "Tess", "Varga") },
  location: { id: "loc-0310", name: "Reader Location" },
  jobTitle: "Reader Title",
  incidentDate: "2026-10-03",
  incidentDateTurn: 0,
  dateTurns: { "2026-10-02": 0 },
  warningLevel: "written",
  payroll: "yes",
  payrollAmount: "99",
  policyHeading: "Reader Heading",
  notIncidentDates: [],
  priorSteps: [],
  rejected: [],
};

const RULES = {
  employee: { person: person("e-1", "Quinn", "Marlowe"), name: "Quinn Marlowe", ambiguous: [], typed: null },
  salon: { id: "loc-0309", name: "Rules Location", ambiguous: [] },
  title: "Rules Title",
  date: { iso: "2026-10-02", ambiguous: [] },
  warningLevel: { value: "verbal" as const, ambiguous: false },
  payrollAmount: "25",
  policyHeading: "Rules Heading",
};

describe("a value the rules settled is never replaced", () => {
  it("every field keeps the rules' value and the disagreement is traced", () => {
    const merge = mergeCheckedReading(READER);
    expect(merge.employee(RULES.employee)).toBe(RULES.employee);
    expect(merge.salon(RULES.salon)).toBe(RULES.salon);
    expect(merge.title(RULES.title)).toBe(RULES.title);
    expect(merge.date(RULES.date)).toBe(RULES.date);
    expect(merge.warningLevel(RULES.warningLevel)).toBe(RULES.warningLevel);
    expect(merge.payrollAmount(RULES.payrollAmount)).toBe(RULES.payrollAmount);
    expect(merge.policyHeading(RULES.policyHeading)).toBe(RULES.policyHeading);
    expect(merge.filled).toEqual([]);
    expect([...merge.disputed].sort()).toEqual(["employee", "incidentDate", "jobTitle", "location", "payrollAmount", "policyHeading", "warningLevel"]);
  });

  it("the same value is no dispute", () => {
    const merge = mergeCheckedReading({ ...READER, employee: { name: "Quinn Marlowe", person: RULES.employee.person }, incidentDate: "2026-10-02", warningLevel: "verbal", payrollAmount: "25" });
    expect(merge.employee(RULES.employee)).toBe(RULES.employee);
    expect(merge.date(RULES.date)).toBe(RULES.date);
    expect(merge.warningLevel(RULES.warningLevel)).toBe(RULES.warningLevel);
    expect(merge.payrollAmount(RULES.payrollAmount)).toBe(RULES.payrollAmount);
    expect(merge.disputed).not.toContain("employee");
    expect(merge.disputed).not.toContain("incidentDate");
  });
});

describe("an open field is filled", () => {
  it("every field the rules left open takes the reader's value", () => {
    const merge = mergeCheckedReading(READER);
    expect(merge.employee({ person: null, name: null, ambiguous: [], typed: null }).name).toBe("Tess Varga");
    expect(merge.salon({ id: null, name: null, ambiguous: [] }).id).toBe("loc-0310");
    expect(merge.title(null)).toBe("Reader Title");
    expect(merge.date({ iso: null, ambiguous: [] }).iso).toBe("2026-10-03");
    expect(merge.warningLevel({ value: null, ambiguous: false }).value).toBe("written");
    expect(merge.payrollAmount(null)).toBe("99");
    expect(merge.policyHeading(null)).toBe("Reader Heading");
    expect([...merge.filled].sort()).toEqual(["employee", "incidentDate", "jobTitle", "location", "payrollAmount", "policyHeading", "warningLevel"]);
  });
});
