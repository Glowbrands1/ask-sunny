import { describe, expect, it } from "vitest";

import { withCardObserved } from "./account-facts-kept";

/**
 * QA's live L4/L5 on prod 14fed8c (22 Nov 2026): the saved coaching_details must say what the card said. The drafting
 * model's text is QA's saved text; the card's is QA's card. "Test Testy" → invented Remy Calder, <S1> → Corin Vale.
 */
describe("withCardObserved (L4/L5: the saved form is the card's account)", () => {
  it("L4: the card's \"the new puppy\", never the drafter's \"a new puppy\"", () => {
    const drafted = "Observed:\nRemy came into the salon to show the team a new puppy.\n\nExpectation:\nRemy keeps pets out of the salon.";
    const { text } = withCardObserved(drafted, "Remy came into the salon to show the team the new puppy.");
    expect(text).toBe("Observed:\nRemy came into the salon to show the team the new puppy.\n\nExpectation:\nRemy keeps pets out of the salon.");
  });
  it("L5: the card's \"The shift lead Corin Vale told Remy to go home and Remy refused.\" as it was", () => {
    const drafted = "Observed:\nShift lead Corin Vale told Remy to go home, and Remy refused.\n\nGoing Forward:\nRemy follows a lead's direction.";
    const { text } = withCardObserved(drafted, "The shift lead Corin Vale told Remy to go home and Remy refused.");
    expect(text).toMatch(/^Observed:\nThe shift lead Corin Vale told Remy to go home and Remy refused\.\n\nGoing Forward:\nRemy follows a lead's direction\.$/);
  });
  it("a write-up with no label or later part is the card's account", () => {
    expect(withCardObserved("Remy opened late.", "Remy opened the salon late on 10/1/26.").text).toBe("Remy opened the salon late on 10/1/26.");
  });
  it("an inline label stays inline", () => {
    expect(withCardObserved("Observed: Remy was late.", "Remy was late on 11/21.").text).toBe("Observed: Remy was late on 11/21.");
  });
  it("nothing to do: empty card or the same text", () => {
    expect(withCardObserved("Observed:\nRemy was late.", "").replaced).toBe(false);
    expect(withCardObserved("Observed:\nRemy was late.", "Remy was late.").replaced).toBe(false);
  });
});
