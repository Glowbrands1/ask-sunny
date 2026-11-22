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

/*
 * Ask Bubbles' live re-run 2 (22 Nov 2026, A8; port of #1033): a global login's reply named two salons in one sentence
 * and asked "Which one is this coaching for?" right after it. The question goes with the sentence it follows.
 */
describe("withoutSalonGuess (A8, live re-run 2)", () => {
  const LIVE_T2 =
    "You have two Lincoln salons — NE Lincoln 27th Street and NE Lincoln O Street. Which one is this coaching for?\n\nThe team card now includes the new bed cleaning flow details. Once you confirm the salon, it's ready for Create.";

  it("drops the sentence naming the guessed salons and the question right after it, keeping the rest", () => {
    const out = withoutSalonGuess(LIVE_T2, salonsNamedNotSaid(LIVE_T2, [T1, T2], null));
    expect(out).not.toMatch(/Lincoln|Which one/);
    expect(out).toMatch(/^The team card now includes the new bed cleaning flow details\./);
  });

  it("keeps a question that does not follow a dropped sentence", () => {
    expect(withoutSalonGuess("Does this look right? Updated the card.", ["NE Lincoln 27th Street"])).toBe("Does this look right? Updated the card.");
  });
});
