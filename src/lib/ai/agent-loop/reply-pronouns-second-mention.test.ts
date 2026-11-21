import { describe, expect, it } from "vitest";

import { withoutPersonPronouns } from "./reply-pronouns";

/*
 * QA (20 Nov 2026, item 19; the production audit, names invented): the name-for-pronoun swap read clumsily, "<P> did not
 * come into <P>'s scheduled shift today". A second mention of the same person in one sentence reads naturally, and no
 * she/her is kept.
 */
describe("withoutPersonPronouns: the person's second mention in a sentence", () => {
  it("a possessive after a preposition is 'the'", () => {
    expect(withoutPersonPronouns("Remy did not come into her scheduled shift today.", "Remy").text).toBe(
      "Remy did not come into the scheduled shift today.",
    );
    expect(withoutPersonPronouns("She did not come in for her 9:30 shift.", "Remy").text).toBe("Remy did not come in for the 9:30 shift.");
  });

  it("a repeated subject after 'and' is dropped", () => {
    expect(withoutPersonPronouns("Remy came in late and she left early.", "Remy").text).toBe("Remy came in late and left early.");
  });

  it("the first mention, and a possessive that is not after a preposition, keep the name", () => {
    expect(withoutPersonPronouns("She said her car broke down.", "Remy").text).toBe("Remy said Remy's car broke down.");
    expect(withoutPersonPronouns("The form is ready. Her shift starts at 9.", "Remy").text).toBe("The form is ready. Remy's shift starts at 9.");
  });

  it("never keeps a pronoun", () => {
    for (const line of ["Remy did not come into her scheduled shift today.", "Remy came in late and she left early.", "She was late to her shift and she did not call."]) {
      expect(withoutPersonPronouns(line, "Remy").text).not.toMatch(/\b(?:she|her|he|him|his)\b/i);
    }
  });
});
