import { describe, expect, it } from "vitest";

import { NO_POLICY_NOTE, withNoPolicyQuestion } from "./no-policy-asks-which";

// QA's Bubbles 17n live test (12 Nov 2026, 4a), the manager's words (the employee invented).
const ISSUE = "**Issue:** he forgot to clsoe the register at night on 11/10 · **Salon:** the salon";
const CARD = {
  content: `I'll draft a **Corrective Action Form** for **Remy Calder**.\n\n${ISSUE}\n\nIs this a **Verbal Warning** or a **Written Warning**?`,
  formProposal: { templateName: "Corrective Action Form" },
};

describe("CA_NO_POLICY_ASKS_WHICH (the step itself; the route asks it only with the flag on)", () => {
  it("asks which policy applies, after the Issue, and keeps the Issue as typed", () => {
    const out = withNoPolicyQuestion(CARD);
    const parts = out.content.split("\n\n");
    expect(parts[1]).toBe(ISSUE);
    expect(parts[2]).toBe(NO_POLICY_NOTE);
    expect(out.content).toMatch(/^\*\*Which policy applies\?\*\*/m);
  });

  it("a card that cites a policy, or already asks, is as before", () => {
    const cited = { ...CARD, content: `${CARD.content}\n\n**Policy:** Late Opening — read from this request.` };
    expect(withNoPolicyQuestion(cited)).toBe(cited);
    const asks = { ...CARD, content: `${CARD.content}\n\n**Which policy applies?** Tell me which.` };
    expect(withNoPolicyQuestion(asks)).toBe(asks);
  });

  it("a Coaching card, or no card, is as before", () => {
    const coaching = { ...CARD, formProposal: { templateName: "Coaching Form" } };
    expect(withNoPolicyQuestion(coaching)).toBe(coaching);
    const none = { content: "Which form?" };
    expect(withNoPolicyQuestion(none)).toBe(none);
  });
});
