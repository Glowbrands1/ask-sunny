import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { onlyAsPossessivePlace, withPossessivePlaceNotPerson } from "./possessive-place";

/** POSSESSIVE_PLACE_NOT_PERSON_ENABLED, ported from the sibling app (QA's round-6 live test there, 9 Nov 2026): QA's wording, an invented place. */
const REPORTED = "create a CA for Hadley's Crossing Plaza, she was late on 10-20-26";
const card = (employeeName: string) => ({
  content: `I'll draft a **Corrective Action Form** for **${employeeName}** from what you've described.`,
  formProposal: { employeeName, templateName: "Corrective Action Form", status: "ready", supportsInlineDraft: true },
});

beforeEach(() => vi.stubEnv("POSSESSIVE_PLACE_NOT_PERSON_ENABLED", "true"));
afterEach(() => vi.unstubAllEnvs());

describe("onlyAsPossessivePlace", () => {
  it("QA's wording: \"Hadley\" is only the place's possessive", () => {
    expect(onlyAsPossessivePlace("Hadley", REPORTED)).toBe(true);
  });

  it("a possessive with a place word: \"<Name>'s Plaza\", \"<Name>'s Crossing Mall\"", () => {
    expect(onlyAsPossessivePlace("Hadley", "write up a coaching form for Hadley's Crossing Mall, late twice")).toBe(true);
  });

  it("a person named plainly anywhere is a person", () => {
    expect(onlyAsPossessivePlace("Hadley", "create a CA for Hadley, she was late at Hadley's Crossing Plaza")).toBe(false);
    expect(onlyAsPossessivePlace("Hadley", "create a CA for Hadley's late arrival on 10-20-26")).toBe(false);
    expect(onlyAsPossessivePlace("Remy", "create a CA for Remy's shift at Hadley's Crossing Plaza")).toBe(false);
  });
});

describe("withPossessivePlaceNotPerson", () => {
  it("off: the card as it was", () => {
    vi.stubEnv("POSSESSIVE_PLACE_NOT_PERSON_ENABLED", "");
    expect(withPossessivePlaceNotPerson(card("Hadley"), [REPORTED]).formProposal?.employeeName).toBe("Hadley");
  });

  it("on: QA's wording loses \"Hadley\" and asks who the form is for", () => {
    const answer = withPossessivePlaceNotPerson(card("Hadley"), [REPORTED]);
    expect(answer.formProposal).toMatchObject({ employeeName: null, status: "needs_employee", supportsInlineDraft: false });
    expect(answer.content).toMatch(/^Who is this \*\*Corrective Action Form\*\* for\?/);
  });
});
