import { describe, expect, it } from "vitest";

import { saidOnlyAsFormName } from "./title-words";

/**
 * FORM_NAME_NOT_A_TITLE_ENABLED, the slot reader (QA's follow-up, 11 Nov 2026, D5 off-roster): the exact wording, an
 * invented person.
 */
describe("saidOnlyAsFormName: a title word said only as the form's name", () => {
  it.each([
    ["SDIT", "Create an SDIT EPP for Wren Tallis at IA Altoona"],
    ["TSD", "Create a TSD EPP for Wren Tallis at Kearney"],
    ["SDIT", "ASD/SDIT EPP for Wren Tallis"],
  ])("%s in %j is the form's name", (title, text) => {
    expect(saidOnlyAsFormName(title, text)).toBe(true);
  });

  it.each([
    ["SDIT", "Create an SDIT EPP for Wren Tallis at IA Altoona, she is an SDIT"],
    ["SDIT", "Wren Tallis is an SDIT, she was late"],
    ["SDIT", "Create an EPP for Wren Tallis"],
    ["Salon Director", "Create an SDIT EPP for Wren Tallis"],
  ])("%s in %j is not only the form's name", (title, text) => {
    expect(saidOnlyAsFormName(title, text)).toBe(false);
  });
});
