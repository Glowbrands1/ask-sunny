import { afterEach, describe, expect, it } from "vitest";

import { leadingFormRequest } from "./template-intent";
import { leadingTitleLength, nameAfterTitle, sameNameAfterTitle, withoutLeadingTitle } from "./title-before-name";

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

  it("flag on: a roster state is never a title (\"NE Kearney\" is a place), and a title alone names nobody", () => {
    process.env[FLAG] = "true";
    // No roster salon is in South Dakota, so "SD" here is Salon Director, as `extractJobTitle` reads it.
    expect(leadingTitleLength(["NE", "Kearney"])).toBe(0);
    expect(leadingTitleLength(["Tanning", "Consultants"])).toBe(0);
  });

  it("flag on: \"Corrective action for Tanning Consultant Wren Tallis\" asks for the form for Wren Tallis", () => {
    process.env[FLAG] = "true";
    expect(leadingFormRequest("Corrective action for Tanning Consultant Wren Tallis")).toMatchObject({ templateKey: "dpoa", subject: ["Wren", "Tallis"] });
  });

  it("flag off: names are read as before", () => {
    // Off pins its own flag (QA's off-pins guard, 11 Nov 2026): it must hold once production turns the flag on.
    delete process.env[FLAG];
    expect(withoutLeadingTitle("Tanning Consultant Wren Tallis")).toBe("Tanning Consultant Wren Tallis");
    expect(leadingFormRequest("Corrective action for Tanning Consultant Wren Tallis")).toBeNull();
  });
});

describe("TITLE_BEFORE_NAME reads every job title this app prints", () => {
  it("each JOB_TITLES title, and each written short, is a leading title", async () => {
    process.env[FLAG] = "true";
    const { JOB_TITLES } = await import("./proposal");
    for (const said of ["SDIT", "TSD", "DMIT", "FTTC", "ASD", "TC", "SD", "DM", ...JOB_TITLES.map((entry) => entry.title)]) {
      expect(leadingTitleLength([...said.split(" "), "Wren", "Tallis"]), said).toBe(said.split(" ").length);
    }
  });
});

describe("nameAfterTitle (QA's ruling, 11 Nov 2026): the name a request gives after \"for <title>\"", () => {
  it("flag on: \"Corrective action for Salon Director Wren Tallis\" gives Wren Tallis", () => {
    process.env[FLAG] = "true";
    expect(nameAfterTitle("Corrective action for Salon Director Wren Tallis")).toBe("Wren Tallis");
    expect(nameAfterTitle("Create a CA for TC Wren Tallis, she was late")).toBe("Wren Tallis");
  });

  it("flag on: no title, lower-case words, or a title alone give nothing", () => {
    process.env[FLAG] = "true";
    expect(nameAfterTitle("Corrective action for Wren Tallis")).toBeNull();
    expect(nameAfterTitle("Corrective action for Salon Director being late")).toBeNull();
    expect(nameAfterTitle("Corrective action for Salon Directors")).toBeNull();
  });

  it("flag off: nothing", () => {
    expect(nameAfterTitle("Corrective action for Salon Director Wren Tallis")).toBeNull();
  });
});

describe("sameNameAfterTitle: the create check's reading \"Director <name>\" is the card's <name>", () => {
  const said = ["Corrective action for Salon Director Wren Tallis"];

  it("flag on: \"Director Wren Tallis\" read from \"for Salon Director Wren Tallis\" is Wren Tallis", () => {
    process.env[FLAG] = "true";
    expect(sameNameAfterTitle("Director Wren Tallis", "Wren Tallis", said)).toBe(true);
    expect(sameNameAfterTitle("Tanning Consultant Wren Tallis", "Wren Tallis", ["Corrective action for Tanning Consultant Wren Tallis"])).toBe(true);
  });

  it("flag on: another person, or a request that never put a title before the name, is not", () => {
    process.env[FLAG] = "true";
    expect(sameNameAfterTitle("Ronan Wren Tallis", "Wren Tallis", ["Corrective action for Ronan Wren Tallis"])).toBe(false);
    expect(sameNameAfterTitle("Maya Lund", "Wren Tallis", said)).toBe(false);
  });

  it("flag off: never", () => {
    expect(sameNameAfterTitle("Director Wren Tallis", "Wren Tallis", said)).toBe(false);
  });
});

describe("the sibling app's Gate-Bubbles R795T (12 Nov 2026): an award, a time or an event after a title is nobody", () => {
  it.each(["Create a CA for Tanning Consultant Of The Month", "Create a CA for Salon Director Of The Year", "Create a CA for TC Training", "Create a CA for DM Visit"])(
    "flag on: %j gives no name",
    (said) => {
      process.env[FLAG] = "true";
      expect(nameAfterTitle(said)).toBeNull();
    },
  );

  it("flag on: \"Tanning Consultant Of The Month\" is left whole on a card", () => {
    process.env[FLAG] = "true";
    expect(withoutLeadingTitle("Tanning Consultant Of The Month")).toBe("Tanning Consultant Of The Month");
    expect(withoutLeadingTitle("Tanning Consultant Wren Tallis")).toBe("Wren Tallis");
  });
});
