import { afterEach, describe, expect, it } from "vitest";

import { FORM_OPPORTUNITY_LEAD_AT_END, formOpportunityLead } from "./form-opportunity";

/**
 * Pau via QA, 5 Nov 2026 (sf-b6 in the sibling app): the reply ended "Based on
 * what you've described, I can prepare:" with nothing after it.
 */
afterEach(() => {
  delete process.env.FORM_LEAD_FULL_SENTENCE_ENABLED;
});

describe("FORM_LEAD_FULL_SENTENCE_ENABLED: the line before the form cards", () => {
  it("off, it ends with a colon (the reported reply)", () => {
    expect(formOpportunityLead(["Corrective Action Form", "Coaching Form"])).toMatch(/:\s*$/);
  });

  it("on, it is a whole sentence naming the forms", () => {
    process.env.FORM_LEAD_FULL_SENTENCE_ENABLED = "true";
    expect(formOpportunityLead(["Corrective Action Form", "Coaching Form"])).toBe(
      "Based on what you've described, I can prepare the **Corrective Action Form** or the **Coaching Form** — pick one below.",
    );
    expect(formOpportunityLead(["Coaching Form"])).toBe("Based on what you've described, I can prepare the **Coaching Form**.");
    expect(formOpportunityLead([])).toMatch(/:\s*$/);
  });

  it("either form is found at the end of a reply, so an open draft drops it", () => {
    process.env.FORM_LEAD_FULL_SENTENCE_ENABLED = "true";
    for (const lead of [formOpportunityLead(["Coaching Form"]), "Based on what you've described, I can prepare:"]) {
      expect(`Some answer.\n\n${lead}`.replace(FORM_OPPORTUNITY_LEAD_AT_END, "")).toBe("Some answer.");
    }
  });
});
