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
    const asked = { content: ASKED, citations: [] } as unknown as AskResponse;
    expect(withoutTurnedDownName(asked, request("no, verbal warning")).content).toBe("Who is this form for? Tell me the employee's full name.");
    const other = answer("Remy Calder");
    expect(withoutTurnedDownName(other, request("no, it's Remy Calder"))).toBe(other);
  });

  it("(b) the card on screen is the one the reply before this turn drafted, or the open form it answered about", () => {
    expect(cardEmployee(request("make that change to x", CARD))).toBe("Corvina Vellacott");
    expect(cardEmployee(request("make that change to x"))).toBeNull();
    expect(cardEmployee(request("x", "I haven't changed the **Corrective Action Form** for **Corvina Vellacott** — everything on it is as it was."))).toBe("Corvina Vellacott");
    // A form open: the reply about it names its employee, who is on screen too.
    expect(cardEmployee({ ...request("x", CARD), activeFormInstanceId: "00000000-0000-4000-8000-000000000001" })).toBe("Corvina Vellacott");
  });

  it("off: nothing changes", () => {
    vi.stubEnv("NEAR_MISS_QUESTION_RULES_ENABLED", "");
    const given = answer("Corvina Vellacott");
    expect(withoutTurnedDownName(given, request("no, verbal warning"))).toBe(given);
  });
});

describe("NEAR_MISS_TURNED_DOWN_EVERYWHERE_ENABLED (QA, 11 Nov 2026)", () => {
  beforeEach(() => vi.stubEnv("NEAR_MISS_QUESTION_RULES_ENABLED", "true"));
  afterEach(() => vi.unstubAllEnvs());
  const everywhere = (on: boolean) => vi.stubEnv("NEAR_MISS_TURNED_DOWN_EVERYWHERE_ENABLED", on ? "true" : "");

  it("\"no call no show on 11/3, verbal warning\" keeps the asked name; \"no\", \"no,\", \"no.\", \"nope\" still turn it down", () => {
    everywhere(true);
    expect(turnedDownName(request("no call no show on 11/3, verbal warning"))).toBeNull();
    for (const said of ["no", "no, verbal warning", "no. verbal warning", "nope", "nope, it's someone else", "wrong", "not her"]) {
      expect(turnedDownName(request(said)), said).toBe("Corvina Vellacott");
    }
  });

  it("off: \"no call no show …\" is read as before", () => {
    everywhere(false);
    expect(turnedDownName(request("no call no show on 11/3, verbal warning"))).toBe("Corvina Vellacott");
  });

  it("the plan and account lines: the turned-down name leaves the Action Plan; the \"no,\" leaves the account", () => {
    everywhere(true);
    const content = `${CARD}\n\n**Observation of Offense:** no, verbal warning the customer complained\n\n**Action Plan:** Management will review the Standards of Conduct policy with Corvina. Corvina will reread it.`;
    const out = withoutTurnedDownName({ ...answer("Corvina Vellacott"), content }, request("no, verbal warning the customer complained")).content;
    expect(out).toContain("**Action Plan:** Management will review the Standards of Conduct policy with the employee. The employee will reread it.");
    expect(out).toContain("**Observation of Offense:** verbal warning the customer complained");
  });
});
