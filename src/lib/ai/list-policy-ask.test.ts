import { afterEach, describe, expect, it, vi } from "vitest";

import { asksOnlyToListPolicy, listPolicyIsEdit } from "./list-policy-ask";

/** LIST_POLICY_IS_EDIT_ENABLED (QA, 8 Nov 2026). */
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("asksOnlyToListPolicy", () => {
  it.each([
    "please list the policy",
    "please list the policy.",
    "list the policy",
    "add the policy",
    "can you list the policy",
    "can you list the policy?",
    "could you please add the policy to the form",
    "list the policy on the draft please",
    "include the policy too",
  ])("%s → an edit", (question) => {
    expect(asksOnlyToListPolicy(question)).toBe(true);
  });

  it.each([
    "what policy covers lateness?",
    "does attendance fall under standards of conduct?",
    "which policy should I list?",
    "I need you to make it about showing up late and please list the policy make the date for 10/14/26.",
    "list the attendance policy and the dress code",
    "policy",
  ])("%s → not only a list-the-policy ask", (question) => {
    expect(asksOnlyToListPolicy(question)).toBe(false);
  });
});

describe("listPolicyIsEdit", () => {
  it("off: false", () => {
    expect(listPolicyIsEdit("please list the policy", true)).toBe(false);
  });
  it("on, a form open: true; no form open: false", () => {
    vi.stubEnv("LIST_POLICY_IS_EDIT_ENABLED", "true");
    expect(listPolicyIsEdit("please list the policy", true)).toBe(true);
    expect(listPolicyIsEdit("please list the policy", false)).toBe(false);
  });
});

describe("with only a card open", () => {
  const history = [
    { role: "user", content: "create a coaching form for Rowan Kestrel" },
    { role: "assistant", content: "Here is what I would put on a **Coaching Form**." },
  ];

  it("listPolicyOnCard: a card and no draft; off, a draft open, or no card: false", async () => {
    const { listPolicyOnCard } = await import("./list-policy-ask");
    const turn = { question: "please list the policy", history, continueProposalTemplateKey: "coaching" };
    expect(listPolicyOnCard(turn)).toBe(false);
    vi.stubEnv("LIST_POLICY_IS_EDIT_ENABLED", "true");
    expect(listPolicyOnCard(turn)).toBe(true);
    expect(listPolicyOnCard({ ...turn, activeFormInstanceId: "f-1" })).toBe(false);
    expect(listPolicyOnCard({ ...turn, continueProposalTemplateKey: null })).toBe(false);
    expect(listPolicyOnCard({ ...turn, question: "what policy covers lateness?" })).toBe(false);
  });

  it("cardRequestTurn: the manager's last turn, or this one", async () => {
    const { cardRequestTurn } = await import("./list-policy-ask");
    expect(cardRequestTurn({ question: "please list the policy", history })).toBe("create a coaching form for Rowan Kestrel");
    expect(cardRequestTurn({ question: "please list the policy", history: [] })).toBe("please list the policy");
  });

  it("withPolicyListedAtCreate: a card with no manual line gains the sentence once; a card with one, or no card, is unchanged", async () => {
    const { LISTED_AT_CREATE, withPolicyListedAtCreate } = await import("./list-policy-ask");
    const card = { content: "Here is what I would put on a **Coaching Form**.", formProposal: { templateKey: "coaching" } };
    const once = withPolicyListedAtCreate(card);
    expect(once.content).toContain(LISTED_AT_CREATE);
    expect(withPolicyListedAtCreate(once)).toBe(once);
    const cited = { ...card, content: `${card.content}\n\nAttendance Policy, JBA Policy Manual p.14` };
    expect(withPolicyListedAtCreate(cited)).toBe(cited);
    const policyLine = { ...card, content: "**Policy:** Attendance, as you said." };
    expect(withPolicyListedAtCreate(policyLine)).toBe(policyLine);
    const noCard = { content: "A grounded answer." };
    expect(withPolicyListedAtCreate(noCard)).toBe(noCard);
    expect(LISTED_AT_CREATE.startsWith("**Policy:**")).toBe(false);
  });
});
