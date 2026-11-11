import { afterEach, describe, expect, it } from "vitest";

import { withUnknownPlaceSaid, withoutPlaceAfterName } from "./unknown-place-not-account";

/** UNKNOWN_PLACE_NOT_ACCOUNT_ENABLED (QA's D5 follow-up, 11 Nov 2026): QA's wording, an invented person. */
const FLAG = "UNKNOWN_PLACE_NOT_ACCOUNT_ENABLED";
const NAME = "Wren Tallis";

afterEach(() => {
  delete process.env[FLAG];
});

describe("withoutPlaceAfterName", () => {
  it.each([
    ["Create an SDIT EPP for Wren Tallis at IA Altoona", "Create an SDIT EPP for Wren Tallis"],
    ["Create a coaching form for Wren Tallis at IA Altoona", "Create a coaching form for Wren Tallis"],
    ["Create a coaching form for Wren Tallis in Altoona.", "Create a coaching form for Wren Tallis"],
  ])("flag on: %j loses the place", (said, kept) => {
    process.env[FLAG] = "true";
    expect(withoutPlaceAfterName(said, NAME)).toBe(kept);
  });

  it.each([
    "Wren Tallis was rude at the front desk",
    "Wren Tallis at IA Altoona was rude to a guest",
    "Create a coaching form for Wren Tallis at IA Altoona, she was rude to a guest",
    "she was late at Opening",
  ])("flag on: %j is unchanged", (said) => {
    process.env[FLAG] = "true";
    expect(withoutPlaceAfterName(said, NAME)).toBe(said);
  });

  it("flag off: unchanged", () => {
    expect(withoutPlaceAfterName("Create an SDIT EPP for Wren Tallis at IA Altoona", NAME)).toBe("Create an SDIT EPP for Wren Tallis at IA Altoona");
  });
});

describe("withUnknownPlaceSaid (UNKNOWN_PLACE_SAID_ENABLED)", () => {
  const SAID = "UNKNOWN_PLACE_SAID_ENABLED";
  const CARD = "Your account covers every salon, so this form won't name one. Create the draft here when you're ready.";
  const read = (turn: string, locationResolution = "not_applicable") =>
    withUnknownPlaceSaid({ content: CARD, turns: [turn], employeeName: NAME, locationResolution });
  afterEach(() => {
    delete process.env[SAID];
  });

  it("flag on: the place is said back", () => {
    process.env[SAID] = "true";
    expect(read("Create an SDIT EPP for Wren Tallis at IA Altoona")).toBe(
      "IA Altoona isn't one of our salons, so this form won't name one. Create the draft here when you're ready.",
    );
  });

  it("flag on: no place, a salon, or a resolved salon leaves the card as it was", () => {
    process.env[SAID] = "true";
    expect(read("Create an SDIT EPP for Wren Tallis")).toBe(CARD);
    expect(read("Create an SDIT EPP for Wren Tallis at Kearney")).toBe(CARD);
    expect(read("Create an SDIT EPP for Wren Tallis at IA Altoona", "resolved")).toBe(CARD);
  });

  it("flag off: unchanged", () => {
    expect(read("Create an SDIT EPP for Wren Tallis at IA Altoona")).toBe(CARD);
  });
});
