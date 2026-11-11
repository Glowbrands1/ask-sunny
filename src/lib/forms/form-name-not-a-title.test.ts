import { afterEach, describe, expect, it } from "vitest";

import { extractJobTitle } from "./proposal";

/** FORM_NAME_NOT_A_TITLE_ENABLED (QA's prod-env reading, 10 Nov 2026, D5): the EPP's program name is not a job title. */
const FLAG = "FORM_NAME_NOT_A_TITLE_ENABLED";

afterEach(() => {
  delete process.env[FLAG];
});

describe("FORM_NAME_NOT_A_TITLE", () => {
  it("flag off (as before): \"SDIT EPP\" reads as the SDIT title (expanded later on the card)", () => {
    expect(extractJobTitle("Create an SDIT EPP for Marnie Holloway at Kearney")).toBe("SDIT");
  });

  it("flag on: the form's name is not a title", () => {
    process.env[FLAG] = "true";
    expect(extractJobTitle("Create an SDIT EPP for Marnie Holloway at Kearney")).toBeNull();
    expect(extractJobTitle("create a tsd epp for marnie holloway")).toBeNull();
  });

  it("flag on, NEVER-BREAK: a title said of the person is still read", () => {
    process.env[FLAG] = "true";
    expect(extractJobTitle("Create an SDIT EPP for Marnie Holloway, she is an SDIT at Kearney")).toBe("SDIT");
    expect(extractJobTitle("coaching form for Marnie Holloway, SDIT at Kearney")).toBe("SDIT");
  });
});
