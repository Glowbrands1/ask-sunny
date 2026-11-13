import { describe, expect, it } from "vitest";

import { NO_POLICY_NOTE, readerFindsPolicy, withNoPolicyQuestion } from "./no-policy-asks-which";

// QA's Bubbles 17n live test (12 Nov 2026, 4a), the manager's words (the employee invented).
const ISSUE = "**Issue:** he forgot to clsoe the register at night on 11/10 · **Salon:** the salon";
const CARD = {
  content: `I'll draft a **Corrective Action Form** for **Remy Calder**.\n\n${ISSUE}\n\nIs this a **Verbal Warning** or a **Written Warning**?`,
  formProposal: { templateName: "Corrective Action Form", status: "ready", employeeName: "Remy Calder" },
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

  it("Gate-Bubbles on Ask Bubbles #848: a reply with no card built yet never asks", () => {
    const nameAsk = {
      content: "Who is this Corrective Action Form for? I still need to know who this is for before I can make this card.",
      formProposal: { templateName: "Corrective Action Form", status: "needs_employee", employeeName: null },
    };
    expect(withNoPolicyQuestion(nameAsk)).toBe(nameAsk);
    const notReady = { ...CARD, formProposal: { ...CARD.formProposal, status: "needs_location" } };
    expect(withNoPolicyQuestion(notReady)).toBe(notReady);
  });

  it("Gate-Sunny-2 on Ask Sunny #914: a card whose policy the reader read never asks; the close-register account still does", () => {
    const late = "create verbal ca for marlo quist, she was 20 minutes late on 10-20-26 because she was on social media on her phone. no payroll deduct";
    expect(readerFindsPolicy(late)).toBe(true);
    expect(withNoPolicyQuestion(CARD, late)).toBe(CARD);
    const close = "create a corrective action for Remy Calder, he forgot to clsoe the register at night on 11/10";
    expect(readerFindsPolicy(close)).toBe(false);
    expect(withNoPolicyQuestion(CARD, close).content).toContain(NO_POLICY_NOTE);
    expect(readerFindsPolicy("create a corrective action for Remy Calder for violating the attendance policy")).toBe(true);
  });

  it("a reply that already cites a manual page has a policy", () => {
    const cited = { ...CARD, content: `${CARD.content}\n\nCell Phone/Smart Watch Policy, JBA Policy Manual p.19` };
    expect(withNoPolicyQuestion(cited)).toBe(cited);
  });

  it("a card still waiting for the account never asks (the Sunny whole-pack diff, 13 Nov 2026)", () => {
    const waiting = { ...CARD, content: `${CARD.content}\n\n**You haven't told me what happened yet**, so I can't cite the policy manual.` };
    expect(withNoPolicyQuestion(waiting, "make a CA for Remy Calder")).toBe(waiting);
  });
});
