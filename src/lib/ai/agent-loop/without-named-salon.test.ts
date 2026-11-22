import { describe, expect, it } from "vitest";

import { withoutNamedSalon } from "./tools";

/*
 * Port from Ask Bubbles (#1027, R13; its QA's round 2, 22 Nov 2026): the salon the manager named leaves the account
 * whole, its state too ("NE" is a word of "NE Kearney"). Sunny's salon stands in for the sibling app's store.
 */
describe("withoutNamedSalon: a salon phrase with its state", () => {
  it("takes \"At Kearney, NE\" out whole at the start of the account", () => {
    expect(withoutNamedSalon("At Kearney, NE on 10/16/26 Testy did not sanitize the tanning beds between guests.", "loc-0309")).toBe(
      "On 10/16/26 Testy did not sanitize the tanning beds between guests.",
    );
  });

  it("keeps the sentence's full stop when the phrase ends one mid-account", () => {
    expect(withoutNamedSalon("Testy was late at Kearney, NE. She did not call.", "loc-0309")).toBe("Testy was late. She did not call.");
  });

  it("leaves a phrase whose word after the comma is not the salon's own (\"at Kearney, she …\")", () => {
    expect(withoutNamedSalon("At Kearney, she was late on 10/16/26.", "loc-0309")).toBe("She was late on 10/16/26.");
    expect(withoutNamedSalon("Testy was late at the bank, NE side.", "loc-0309")).toBe("Testy was late at the bank, NE side.");
  });
});
