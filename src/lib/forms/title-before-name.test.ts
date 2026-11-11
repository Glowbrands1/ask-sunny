import { afterEach, describe, expect, it } from "vitest";

import { leadingFormRequest } from "./template-intent";
import { leadingTitleLength, withoutLeadingTitle } from "./title-before-name";

/** TITLE_BEFORE_NAME_ENABLED (ported from Ask Bubbles, 11 Nov 2026): this app's titles; the person is invented. */
const FLAG = "TITLE_BEFORE_NAME_ENABLED";

afterEach(() => {
  delete process.env[FLAG];
});

describe("TITLE_BEFORE_NAME: a job title before the name", () => {
  it.each([
    ["Tanning Consultant Wren Tallis", "Wren Tallis"],
    ["TC Wren Tallis", "Wren Tallis"],
    ["SDIT Wren Tallis", "Wren Tallis"],
    ["Assistant Salon Director Wren Tallis", "Wren Tallis"],
  ])("flag on: %j is %j", (typed, name) => {
    process.env[FLAG] = "true";
    expect(withoutLeadingTitle(typed)).toBe(name);
  });

  it("flag on: a state code is never a title (\"SD Sioux Falls\" is a place), and a title alone names nobody", () => {
    process.env[FLAG] = "true";
    expect(leadingTitleLength(["SD", "Sioux", "Falls"])).toBe(0);
    expect(leadingTitleLength(["Tanning", "Consultants"])).toBe(0);
  });

  it("flag on: \"Corrective action for Tanning Consultant Wren Tallis\" asks for the form for Wren Tallis", () => {
    process.env[FLAG] = "true";
    expect(leadingFormRequest("Corrective action for Tanning Consultant Wren Tallis")).toMatchObject({ templateKey: "dpoa", subject: ["Wren", "Tallis"] });
  });

  it("flag off: names are read as before", () => {
    expect(withoutLeadingTitle("Tanning Consultant Wren Tallis")).toBe("Tanning Consultant Wren Tallis");
    expect(leadingFormRequest("Corrective action for Tanning Consultant Wren Tallis")).toBeNull();
  });
});
