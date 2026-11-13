import { describe, expect, it } from "vitest";

import { withBareFormNameQuestion } from "./bare-form-name";

// QA's Bubbles 17n live test (12 Nov 2026, 4c): a pasted bare "Corrective Action Form".
const EMPTY_CARD = { content: "Who is this form for? Tell me the employee's full name.", formProposal: { employeeName: null, templateName: "Corrective Action Form" } };

describe("BARE_FORM_NAME_ASKS_WHAT (the step itself; the route asks it only with the flag on)", () => {
  it.each(["Corrective Action Form", "Corrective Action Form."])("%j asks what the manager needs, with no card", (question) => {
    const out = withBareFormNameQuestion(EMPTY_CARD, question);
    expect(out.content).toBe("What do you need on the **Corrective Action Form**? Tell me who it's for and what happened, and I'll put the card together.");
    expect(out.formProposal).toBeUndefined();
  });

  it("a turn that says more, or names the person, is as before", () => {
    expect(withBareFormNameQuestion(EMPTY_CARD, "Corrective Action Form for Remy Calder")).toBe(EMPTY_CARD);
    const named = { ...EMPTY_CARD, formProposal: { employeeName: "Remy Calder", templateName: "Corrective Action Form" } };
    expect(withBareFormNameQuestion(named, "Corrective Action Form")).toBe(named);
  });

  it.each(["coaching form", "exit form", "corrective action form"])("a form asked for in words (%j) still starts its card", (question) => {
    expect(withBareFormNameQuestion(EMPTY_CARD, question)).toBe(EMPTY_CARD);
  });
});
