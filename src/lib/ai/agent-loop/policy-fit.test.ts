import { describe, expect, it } from "vitest";

import { citesMustSee, dressCodeFit, saysMustSee } from "./policy-fit";

/* QA (16 Nov 2026, the 266 audit on train 4): c261, c263, c207, word for word; invented names. */
const HEADINGS = ["Attendance", "Standards of Conduct", "Late Opening", "Dress Code for The Company", "All Locations Dress Code", "Shoes"];
const DRESS = ["Dress Code for The Company", "All Locations Dress Code"];

describe("dressCodeFit", () => {
  it("reads dress code named, as the manager spells it (c261, c263)", () => {
    expect(dressCodeFit("Create a CA for Wren Ashdale being out of dresscode. Wren Ashdale was wearing her coat during her shift on 11/13 after previously being asked to take it off multiple times", HEADINGS)).toEqual(DRESS);
    expect(dressCodeFit("CA written warning for Wren Ashdale for being out of dresscode on 11/13. Wren Ashdale wore her coat during the shift", HEADINGS)).toEqual(DRESS);
    expect(dressCodeFit("CA for Wren Ashdale  not being in dress code on 11/13 and 11/6", HEADINGS)).toEqual(DRESS);
  });
  it("reads clothing worn on shift with no dress code said (c263's second turn)", () => {
    expect(dressCodeFit("having a black crewneck on during her shift, not a zip up jacket", HEADINGS)).toEqual(DRESS);
    expect(dressCodeFit("she wore a hoodie at work on 11/13", HEADINGS)).toEqual(DRESS);
  });
  it("reads nothing for other offenses, a manager who takes it off, or a manual with no Dress Code heading", () => {
    expect(dressCodeFit("CA for Wren Ashdale, she was late for her shift on 11/13", HEADINGS)).toBeNull();
    expect(dressCodeFit("she was the top seller on her shift but was rude to a guest", HEADINGS)).toBeNull();
    expect(dressCodeFit("it's not dress code, she was rude to a guest during her shift", HEADINGS)).toBeNull();
    expect(dressCodeFit("out of dresscode on 11/13", ["Attendance", "Standards of Conduct"])).toBeNull();
  });
});

describe("Must See Behaviors", () => {
  it("is cited only when the manager says it (c207)", () => {
    expect(citesMustSee("Other — Must See Behaviors")).toBe(true);
    expect(citesMustSee("Standards of Conduct")).toBe(false);
    expect(saysMustSee("a performace ca for an employee who did not meet their numbers for the month of october\nWren Ashdale, verbal")).toBe(false);
    expect(saysMustSee("verbal ca for Wren Ashdale for MSB")).toBe(true);
    expect(saysMustSee("create a ca for must see behaviors for wren")).toBe(true);
  });
});
