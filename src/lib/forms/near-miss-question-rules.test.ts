import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AskRequest, AskResponse } from "@/lib/ai/types";

import { cardEmployee, turnedDownName, withoutTurnedDownName } from "./near-miss-question-rules";

/** NEAR_MISS_QUESTION_RULES_ENABLED (QA's Sunny round-4 gate, 8 Nov 2026). The people are invented. */
const ASKED = "Is this for **Corvina Vellacott**? Tell me if that should change.";
const CARD = "I'll draft a **Corrective Action Form** for **Corvina Vellacott** from what you've described.\n\n**Type of Warning:** Verbal Warning, as you said.\n\nCreate the draft here when you're ready, and edit it below.";

const request = (question: string, reply = ASKED): Pick<AskRequest, "history" | "question" | "activeFormInstanceId"> => ({
  question,
  history: [
    { id: "u1", role: "user", content: "i have an employee, Corvina Ashdown Vellacot that needs a corrective action form" },
    { id: "a1", role: "assistant", content: reply },
  ] as AskRequest["history"],
});
const answer = (employeeName: string | null) =>
  ({ content: CARD, citations: [], formProposal: { templateName: "Corrective Action Form", employeeName, status: "ready", supportsInlineDraft: true } }) as unknown as AskResponse;

describe("NEAR_MISS_QUESTION_RULES_ENABLED", () => {
  beforeEach(() => vi.stubEnv("NEAR_MISS_QUESTION_RULES_ENABLED", "true"));
  afterEach(() => vi.unstubAllEnvs());

  it("(a) the asked name is turned down by \"no, …\", \"nope\", \"wrong\", \"not …\" — never by a payroll answer", () => {
    expect(turnedDownName(request("no, verbal warning, no payroll deduct, part-time tanning consultant,"))).toBe("Corvina Vellacott");
    expect(turnedDownName(request("nope"))).toBe("Corvina Vellacott");
    expect(turnedDownName(request("no payroll deduct, verbal warning"))).toBeNull();
    expect(turnedDownName(request("verbal warning, no payroll deduct"))).toBeNull();
    expect(turnedDownName(request("no, verbal warning", CARD))).toBeNull();
  });

  it("(a) a card for the turned-down name waits for the employee and asks who; any other card is left alone", () => {
    const out = withoutTurnedDownName(answer("Corvina Vellacott"), request("no, verbal warning"));
    expect(out.formProposal).toMatchObject({ employeeName: null, status: "needs_employee", supportsInlineDraft: false });
    expect(out.content).not.toContain("**Corvina Vellacott**");
    expect(out.content).not.toMatch(/Create the draft here/);
    expect(out.content).toMatch(/Who is this form for\? Tell me the employee's full name\.$/);
    const other = answer("Remy Calder");
    expect(withoutTurnedDownName(other, request("no, it's Remy Calder"))).toBe(other);
  });

  it("(b) the card on screen is the one the reply before this turn drafted, when no form is open", () => {
    expect(cardEmployee(request("make that change to x", CARD))).toBe("Corvina Vellacott");
    expect(cardEmployee(request("make that change to x"))).toBeNull();
    expect(cardEmployee({ ...request("x", CARD), activeFormInstanceId: "00000000-0000-4000-8000-000000000001" })).toBeNull();
  });

  it("off: nothing changes", () => {
    vi.stubEnv("NEAR_MISS_QUESTION_RULES_ENABLED", "");
    const given = answer("Corvina Vellacott");
    expect(withoutTurnedDownName(given, request("no, verbal warning"))).toBe(given);
  });
});
