import { describe, expect, it } from "vitest";

import { namesForm, withCardOpening } from "./card-opening";

/* QA (23 Nov 2026, the u22 live records): a card reply that names no form gets the card's own opening. */
describe("a card reply names its form", () => {
  it("QA's RUN A reply: no opening, so the card's opening goes first", () => {
    const reply = "**Perpetua Lindqvist** shows as no longer active in Woven; I've used the name as you typed it.\n\n**How Employee Resigned:** Woven message\n\nLast day worked isn't set; tell me the date (you listed it as TBD).";
    expect(withCardOpening(reply, "Resignation/Exit Form", "Perpetua")).toBe(`Here's the Resignation/Exit Form for **Perpetua**.\n\n${reply}`);
  });

  it("a reply that names the form is left as it is (with or without \"Form\")", () => {
    const named = "Here's the Resignation/Exit Form for **Perpetua**.\n\n**How Employee Resigned:** Woven message";
    expect(withCardOpening(named, "Resignation/Exit Form", "Perpetua")).toBe(named);
    expect(namesForm("Updated the Corrective Action for **Thaddea**.", "Corrective Action Form")).toBe(true);
  });

  it("no card name or no reply name: nothing added", () => {
    expect(withCardOpening("Which salon is this about?", null, "Perpetua")).toBe("Which salon is this about?");
    expect(withCardOpening("Which salon is this about?", "Resignation/Exit Form", null)).toBe("Which salon is this about?");
  });
});
