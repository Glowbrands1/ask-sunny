import { describe, expect, it } from "vitest";

import { matchEmployeeName } from "@/lib/forms/employee-match";

import { namedWholly, rosterMatches, withoutJobTitle } from "./tools";

/**
 * Owner, 28 Nov 2026: "sometimes manager types emma test, … test etc that means its a test form … just make sure
 * sunny and bubble recognize the test employee as a name". A typed "<First> Test" is a made-up person: it is kept
 * whole, as typed, and never becomes a real employee who shares the first name. Invented roster.
 */
const roster = [
  { id: "e-1", firstName: "Emma", lastName: "Hollister", preferredFirstName: null, salonIds: ["loc-0309"] },
  { id: "e-2", firstName: "Marlo", lastName: "Quenby", preferredFirstName: null, salonIds: ["loc-0309"] },
  { id: "e-3", firstName: "Tess", lastName: "Arlington", preferredFirstName: null, salonIds: ["loc-0309"] },
] as unknown as Parameters<typeof rosterMatches>[1];

describe('"<First> Test" is kept as the name the manager typed', () => {
  it.each(["Emma Test", "Marlo Test", "emma test", "Test Employee"])("%s matches nobody on the roster", (typed) => {
    expect(rosterMatches(typed, roster)).toEqual([]);
    expect(roster.some((person) => namedWholly(typed, person))).toBe(false);
  });

  it.each(["Emma Test", "Marlo Test"])("%s keeps its last word: Test is not a job title", (typed) => {
    expect(withoutJobTitle(typed)).toBe(typed);
  });

  it.each(["Emma Test", "Marlo Test"])("%s is never matched to the real Emma or Marlo", (typed) => {
    const match = matchEmployeeName(typed, roster);
    expect(match.kind).not.toBe("exact");
    if (match.kind === "confirm") expect(match.candidates.map((candidate) => candidate.employee.id)).not.toContain(typed.startsWith("Emma") ? "e-1" : "e-2");
  });
});
