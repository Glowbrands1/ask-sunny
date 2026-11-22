import { describe, expect, it } from "vitest";

import { namedWholly, rosterMatches } from "./tools";

/**
 * Board f110 (QA handoff, 22 Nov 2026): partial names still matched staff on the card side ("Rowan Kes" seated Rowan
 * Kestrel with no question). rosterMatches still finds the people a partial name could be (for the Did-you-mean);
 * namedWholly says whether the words name them whole. Invented names.
 */
const ROWAN = { id: "e-4", firstName: "Rowan", lastName: "Kestrel", preferredFirstName: null, salonIds: ["loc-0309"] } as unknown as Parameters<typeof namedWholly>[1];
const RO = { id: "e-9", firstName: "Ro", lastName: "Kestrelle", preferredFirstName: "Roe", salonIds: ["loc-0309"] } as unknown as Parameters<typeof namedWholly>[1];

describe("namedWholly (f110)", () => {
  it.each(["Rowan", "rowan kestrel", "Kestrel", "ROWAN  KESTREL"])("%s names Rowan Kestrel whole", (typed) => {
    expect(namedWholly(typed, ROWAN)).toBe(true);
  });
  it.each(["Rowan Kes", "Row Kes", "Row", "Kestr", "Rowan Kestrels"])("%s only starts (or is not) a name: not whole", (typed) => {
    expect(namedWholly(typed, ROWAN)).toBe(false);
  });
  it("a preferred first name counts whole", () => {
    expect(namedWholly("Roe Kestrelle", RO)).toBe(true);
  });
  it("rosterMatches still finds the partial name's person, for the question", () => {
    expect(rosterMatches("Rowan Kes", [ROWAN]).map((row) => row.id)).toEqual(["e-4"]);
  });
});
