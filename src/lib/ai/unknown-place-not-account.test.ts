import { afterEach, describe, expect, it } from "vitest";

import { withoutPlaceAfterName } from "./unknown-place-not-account";

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
