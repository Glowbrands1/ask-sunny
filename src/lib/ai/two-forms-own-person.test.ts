import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { ChatFormProposal } from "@/types";

import { withTwoFormsOwnPerson } from "./two-forms-own-person";
import type { AskResponse } from "./types";

/**
 * TWO_FORMS_OWN_PERSON_ENABLED (QA, Sunny tester after the flip, 6 Nov 2026,
 * row 6): "Coaching form for <R>. Also a CA for <R2>." gave one Coaching card
 * for R2. The people are invented and not on either directory.
 */
function card(employeeName: string | null, templateKey = "coaching", templateName = "Coaching Form"): ChatFormProposal {
  return {
    proposalId: "p-1",
    templateKey,
    templateName,
    supportsInlineDraft: true,
    variantKey: null,
    employeeName,
    employeeRole: employeeName ? "Tanning Consultant" : null,
    locationId: "loc-0309",
    locationName: null,
    locationResolution: "resolved",
    authorizedLocationIds: [],
    status: employeeName ? "ready" : "needs_employee",
    sourceMessageIds: [],
  } as unknown as ChatFormProposal;
}

function answer(employeeName: string | null, content = `Here is what I would put on a **Coaching Form** for **${employeeName}**.`): AskResponse {
  return { content, citations: [], coverage: "not_applicable", recommendedVideoIds: [], formProposal: card(employeeName) } as AskResponse;
}

const ROW_6 = "Coaching form for Peregrine Ashcombe. Also a CA for Tamsin Wexley.";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("TWO_FORMS_OWN_PERSON_ENABLED", () => {
  it("off (main): the Coaching card keeps the Corrective Action's person (the bug)", () => {
    const out = withTwoFormsOwnPerson(answer("Tamsin Wexley"), { question: ROW_6 });
    expect(out.formProposal?.employeeName).toBe("Tamsin Wexley");
  });

  it("on: the other form's person is cleared, the card asks who, and the CA request is named back", () => {
    vi.stubEnv("TWO_FORMS_OWN_PERSON_ENABLED", "true");
    const out = withTwoFormsOwnPerson(answer("Tamsin Wexley"), { question: ROW_6 });
    expect(out.formProposal).toMatchObject({ templateKey: "coaching", employeeName: null, employeeRole: null, status: "needs_employee" });
    expect(out.content).toMatch(/Who is this \*\*Coaching Form\*\* for\?/);
    expect(out.content).toContain("You also asked for a **Corrective Action Form** for **Tamsin Wexley**");
    expect(out.content).not.toMatch(/Coaching Form\*\* for \*\*Tamsin/);
  });

  it("on: the card's own person is kept, and the CA request is named back", () => {
    vi.stubEnv("TWO_FORMS_OWN_PERSON_ENABLED", "true");
    const out = withTwoFormsOwnPerson(answer("Peregrine Ashcombe"), { question: ROW_6 });
    expect(out.formProposal?.employeeName).toBe("Peregrine Ashcombe");
    expect(out.content).toContain("You also asked for a **Corrective Action Form** for **Tamsin Wexley**");
  });

  it("on, negative: one form in the message is left alone", () => {
    vi.stubEnv("TWO_FORMS_OWN_PERSON_ENABLED", "true");
    const before = answer("Tamsin Wexley");
    expect(withTwoFormsOwnPerson(before, { question: "Coaching form for Tamsin Wexley" })).toBe(before);
  });

  it("on, negative: a correction (\"actually make it a CA\") is one form, left alone", () => {
    vi.stubEnv("TWO_FORMS_OWN_PERSON_ENABLED", "true");
    const before = answer("Tamsin Wexley");
    expect(withTwoFormsOwnPerson(before, { question: "coaching form for Tamsin Wexley, actually make it a CA" })).toBe(before);
  });

  it("on: no card, and the other form's person offered (\"Is this for …?\"): both requests are named back, nobody is offered", () => {
    vi.stubEnv("TWO_FORMS_OWN_PERSON_ENABLED", "true");
    const asked = { content: "Is this for **Tamsin Wexley**? Tell me if that should change.", citations: [], coverage: "not_applicable", recommendedVideoIds: [] } as AskResponse;
    const out = withTwoFormsOwnPerson(asked, { question: "Coaching form for Peregrine. Also a CA for Tamsin." });
    expect(out.content).not.toMatch(/Is this for/);
    expect(out.content).toMatch(/\*\*Coaching Form\*\*[^\n]*\*\*Corrective Action Form\*\*/);
  });

  it("on, negative: \"a coaching form and a CA for <name>\" is one person for both: the card keeps them", () => {
    vi.stubEnv("TWO_FORMS_OWN_PERSON_ENABLED", "true");
    const out = withTwoFormsOwnPerson(answer("Peregrine Ashcombe"), { question: "I need a coaching form and a CA for Peregrine Ashcombe" });
    expect(out.formProposal?.employeeName).toBe("Peregrine Ashcombe");
  });
});
