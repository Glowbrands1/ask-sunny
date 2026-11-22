import { describe, expect, it } from "vitest";

import { salonsNamedNotSaid, withoutSalonGuess } from "./salon-guess";

/*
 * QA's re-run (22 Nov 2026, A8; found in Ask Bubbles): with the team card's salon not chosen, the reply narrowed the
 * question to one city's salons from a program's abbreviation no manager turn gave as a place.
 */
const T1 = "can you create a coaching form for my whole staff?";
const T2 = "coaching is on bed room operations for clean organization and flow. Corporate has flagged our BRC due to cleaning logs being signed within 0 minutes of the bed being used.";
const LIVE = "Updated the team card with the new BRC cleaning flow details. Still need the salon — which Lincoln location is this for, 27th Street or O Street?";

describe("salonsNamedNotSaid (A8)", () => {
  it("salons the reply names that no manager turn named are a guess", () => {
    expect(salonsNamedNotSaid(LIVE, [T1, T2], null).length).toBeGreaterThan(0);
  });

  it("a salon the manager named, or the card holds, is no guess", () => {
    expect(salonsNamedNotSaid("This is for the Lincoln salons.", [T1, "it's for lincoln"], null)).toEqual([]);
    expect(salonsNamedNotSaid("Which salon is this for?", [T1, T2], null)).toEqual([]);
  });

  it("only the guessing sentence is left out", () => {
    const guessed = salonsNamedNotSaid(LIVE, [T1, T2], null);
    expect(withoutSalonGuess(LIVE, guessed)).toBe("Updated the team card with the new BRC cleaning flow details.");
  });
});
