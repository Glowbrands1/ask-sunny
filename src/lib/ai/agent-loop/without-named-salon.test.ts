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

/*
 * QA's live run on Sunny main (22 Nov 2026, nov22-r13-salon-with-state-leaves-account-whole): the manager typed "at
 * Kearney, NE. location." and the live account started "Location, on 10/16/26 …": the phrase and its state left, the
 * word that closed the manager's place phrase stayed. A word of the phrase itself (the salon's name or the place words
 * the phrase is already read with) after the state, up to the phrase's comma or full stop, leaves with it.
 */
describe("withoutNamedSalon: the phrase's own place word after the state", () => {
  it("takes \"At Kearney, NE location,\" out whole", () => {
    expect(withoutNamedSalon("At Kearney, NE location, on 10/16/26 Testy did not sanitize the tanning beds between guests.", "loc-0309")).toBe(
      "On 10/16/26 Testy did not sanitize the tanning beds between guests.",
    );
  });

  it("takes \"At Kearney, NE. location.\" out whole, as the manager typed it", () => {
    expect(withoutNamedSalon("At Kearney, NE. location. On 10/16/26 Testy did not sanitize the tanning beds between guests.", "loc-0309")).toBe(
      "On 10/16/26 Testy did not sanitize the tanning beds between guests.",
    );
  });

  it("takes \"at Kearney, NE location,\" out after the date (QA's live card: \"On 10/16/26 location, Testy …\")", () => {
    expect(withoutNamedSalon("On 10/16/26 at Kearney, NE location, Testy did not sanitize the tanning beds between guests.", "loc-0309")).toBe(
      "On 10/16/26 Testy did not sanitize the tanning beds between guests.",
    );
  });

  it("mid-account, keeps the sentence's own full stop once", () => {
    expect(withoutNamedSalon("Testy was late at Kearney, NE. location. She did not call.", "loc-0309")).toBe("Testy was late. She did not call.");
    expect(withoutNamedSalon("Testy was late at Kearney, NE location, on 10/16/26.", "loc-0309")).toBe("Testy was late on 10/16/26.");
  });

  it("keeps words after the state that are not the phrase's (\"NE on 10/16/26\", \"NE side\")", () => {
    expect(withoutNamedSalon("At Kearney, NE on 10/16/26 Testy was late.", "loc-0309")).toBe("On 10/16/26 Testy was late.");
    expect(withoutNamedSalon("Testy was late at the bank, NE side.", "loc-0309")).toBe("Testy was late at the bank, NE side.");
  });
});

/*
 * Port from Ask Bubbles (#1078, its QA's live re-run 23 Nov 2026, A1): T3 "… Her name is <P> and she is at <store>" got
 * the card's account "<First>, was 10 minutes late to the shift on 10/5.": the model wrote the store as an aside ("<P>,
 * at <store>, was …"), and the strip took the phrase and its closing comma but left the opening one. A salon phrase
 * between two commas leaves with one of them; a comma after the phrase that closes an earlier aside (", a tanning
 * consultant at Kearney, was") stays. Sunny's salon stands in for the sibling app's store; the person is invented.
 */
describe("withoutNamedSalon: commas around a salon phrase", () => {
  it("takes an aside \", at Kearney,\" out with one of its commas", () => {
    expect(withoutNamedSalon("Testy, at Kearney, was 10 minutes late to the shift on 10/5.", "loc-0309")).toBe("Testy was 10 minutes late to the shift on 10/5.");
  });

  it("takes an aside with its state (\", at Kearney, NE,\") out with one of its commas", () => {
    expect(withoutNamedSalon("Testy, at Kearney, NE, was 10 minutes late to the shift on 10/5.", "loc-0309")).toBe("Testy was 10 minutes late to the shift on 10/5.");
  });

  it("takes an aside with the salon's place words (\", at the Kearney salon,\") out with one of its commas", () => {
    expect(withoutNamedSalon("Testy, at the Kearney salon, was 10 minutes late to the shift on 10/5.", "loc-0309")).toBe("Testy was 10 minutes late to the shift on 10/5.");
  });

  it("keeps the comma that closes an earlier aside", () => {
    expect(withoutNamedSalon("Testy, a tanning consultant at Kearney, was 10 minutes late to the shift on 10/5.", "loc-0309")).toBe(
      "Testy, a tanning consultant, was 10 minutes late to the shift on 10/5.",
    );
  });

  it("an aside that ends the sentence keeps the full stop", () => {
    expect(withoutNamedSalon("Testy was 10 minutes late to the shift on 10/5, at Kearney. She did not call.", "loc-0309")).toBe(
      "Testy was 10 minutes late to the shift on 10/5. She did not call.",
    );
    expect(withoutNamedSalon("Testy was 10 minutes late to the shift on 10/5, at Kearney, NE. She did not call.", "loc-0309")).toBe(
      "Testy was 10 minutes late to the shift on 10/5. She did not call.",
    );
  });
});
