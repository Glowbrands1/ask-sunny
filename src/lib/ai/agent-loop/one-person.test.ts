import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { fullNamesOf, sameRosterPerson } = await import("./tools");

/*
 * Batch G (QA's addition 2, 15 Nov 2026; Pau: "Preferred name is fine let it be flexible"): a preferred name and a
 * legal name are one person when Woven says so, and two roster people are never merged. Placeholder names only.
 */
const LEGAL_AND_PREFERRED = { id: "e-1", firstName: "Testina", lastName: "Employee", preferredFirstName: "Sample" };
const OTHER = { id: "e-2", firstName: "Trial", lastName: "Employee", preferredFirstName: null };
const SHARES_PREFERRED = { id: "e-3", firstName: "Trialina", lastName: "Employee", preferredFirstName: "Sample" };

describe("one person, by preferred or legal name", () => {
  it("lists the preferred and the legal full name", () => {
    expect(fullNamesOf(LEGAL_AND_PREFERRED)).toEqual(["Sample Employee", "Testina Employee"]);
    expect(fullNamesOf(OTHER)).toEqual(["Trial Employee"]);
  });

  it("treats the preferred and the legal name as one person, both ways", () => {
    const roster = [LEGAL_AND_PREFERRED, OTHER];
    expect(sameRosterPerson("Sample Employee", "Testina Employee", roster)).toBe(true);
    expect(sameRosterPerson("Testina Employee", "Sample Employee", roster)).toBe(true);
  });

  it("never merges two different roster people", () => {
    const roster = [LEGAL_AND_PREFERRED, OTHER];
    expect(sameRosterPerson("Sample Employee", "Trial Employee", roster)).toBe(false);
    expect(sameRosterPerson("Testina Employee", "Trial Employee", roster)).toBe(false);
  });

  it("decides nothing from a preferred name two roster people share", () => {
    const roster = [LEGAL_AND_PREFERRED, OTHER, SHARES_PREFERRED];
    expect(sameRosterPerson("Sample Employee", "Testina Employee", roster)).toBe(false);
    expect(sameRosterPerson("Sample Employee", "Trialina Employee", roster)).toBe(false);
    expect(sameRosterPerson("Testina Employee", "Trialina Employee", roster)).toBe(false);
  });

  it("does not merge off the roster", () => {
    expect(sameRosterPerson("Sample Employee", "Testina Employee", [])).toBe(false);
  });
});
