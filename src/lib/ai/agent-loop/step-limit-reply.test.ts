import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { cardMadeLine, stepLimitReply } from "./run";

/*
 * Port from the sibling app (its QA's live re-test, 21 Nov 2026): after "Create the coaching form with the information
 * given. Her name is <First> <Lasty> …" and a place answer, the step-limit reply asked "Please send the change you still
 * need again" though the card held the change. Invented person: the pack's Remy Calder (first typed "Remy Caldr").
 */
const DONE = "Here is the **Coaching Form** for **Remy Calder** for you to review.";

describe("stepLimitReply with a card made this turn", () => {
  it("says what the card's result recorded changed, its person and salon, and never asks for the change again", () => {
    const reply = stepLimitReply(DONE, false, { form: "Coaching Form", employee: "Remy Calder", salon: "NE Kearney", formFrom: "Corrective Action Form", nameFrom: "Remy Caldr" });
    expect(reply).toBe(`${DONE} I changed the form from the Corrective Action Form to the Coaching Form, and the name from Remy Caldr to Remy Calder. The card is for Remy Calder at NE Kearney. Tell me if anything else on the card should change.`);
    expect(reply).not.toMatch(/again/);
  });
  it("with nothing changed, still confirms the card's person and salon", () => {
    expect(cardMadeLine({ form: "Coaching Form", employee: "Remy Calder", salon: "NE Kearney", formFrom: null, nameFrom: null })).toBe("The card is for Remy Calder at NE Kearney.");
  });
  it("no card this turn: unchanged (a saved edit, or nothing done)", () => {
    expect(stepLimitReply("I saved the change on the form: Observed.", true)).toBe("I saved the change on the form: Observed. Please send the change you still need again, and I'll make it.");
  });
});
