import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { installLastReply, stateForTurn, type ConversationFormState } from "./form-state";

/**
 * SECOND_REQUEST_OWN_ACCOUNT_ENABLED, the same request sent again (QA's round-6 gate, 8 Nov 2026, sf-s38). The
 * manager's T1, word for word, sent twice; the employee is the pack's invented Rowan Kestrel. The second send started a
 * "new request", so the card lost its Policy line (Attendance, page 14).
 */
const T1 = "make me an CA for Rowan Kestrel missing her saturday and sunday shifts due to wanting to go home for the weekend but failed to communicate proporley";

const STATE = {
  employeeId: "e-rowan",
  employeeName: "Rowan Kestrel",
  keptTypedName: null,
  salonId: "loc-0309",
  title: null,
  formDate: null,
  warningLevel: null,
  payrollDeduct: null,
  policyHeading: "Attendance",
  policyPage: 14,
  templateKey: "dpoa",
  incident: T1,
  incidentType: "Attendance",
} as unknown as ConversationFormState;

const kept = (question: string, earlier: string[] = [T1]) => stateForTurn(STATE, question, earlier)?.policyHeading ?? null;

describe("SECOND_REQUEST_OWN_ACCOUNT_ENABLED: the same request sent again keeps its policy", () => {
  beforeEach(() => vi.stubEnv("SECOND_REQUEST_OWN_ACCOUNT_ENABLED", "true"));
  afterEach(() => vi.unstubAllEnvs());

  it("sf-s38: T1 sent twice keeps the Attendance policy (before the fix it was cleared)", () => {
    expect(stateForTurn(STATE, T1, [T1])).toBe(STATE);
  });

  it("the same words with other case, spaces or punctuation, or a closing \"please\" / \"thanks\"", () => {
    for (const again of [T1.toUpperCase(), `${T1}.`, T1.replace(/ /g, "  "), `${T1} please`, `please ${T1}`, `${T1}, thanks!`]) {
      expect(kept(again), again).toBe("Attendance");
    }
  });

  it("one word's typo fixed (\"proporley\" → \"properly\") is still the same request", () => {
    expect(kept(T1.replace("proporley", "properly"))).toBe("Attendance");
  });

  it("a request of its own still gets its own account: another day, another person, another incident", () => {
    for (const other of [
      T1.replace("saturday and sunday", "friday and sunday"),
      T1.replace("Rowan Kestrel", "Juno Paxton"),
      "make me an CA for Rowan Kestrel, her cash drawer was short $20 on 11/3",
    ]) {
      expect(kept(other), other).toBeNull();
    }
  });

  it("off: the state is as given", () => {
    vi.stubEnv("SECOND_REQUEST_OWN_ACCOUNT_ENABLED", "");
    expect(stateForTurn(STATE, T1, [T1])).toBe(STATE);
  });
});

/*
 * QA's live round 7b (9 Nov 2026; Sunny rolled back): the managers' words, the employee the pack's invented Rowan
 * Kestrel. "make me CA for <first name> failing to complete shifts" → "Is this for **<Full Name>**?" → "Make me a CA for
 * <Full Name> not showing up to her shifts on 11/7 and 11/8" lost the Attendance policy.
 */
describe("SECOND_REQUEST_OWN_ACCOUNT_ENABLED: the answer to the app's question, and a new request's own policy", () => {
  const ASKED = "make me CA for rowan failing to complete shifts";
  const ANSWER = "Make me a CA for Rowan Kestrel not showing up to her shifts on  11/7 and 11/8";
  beforeEach(() => vi.stubEnv("SECOND_REQUEST_OWN_ACCOUNT_ENABLED", "true"));
  afterEach(() => {
    vi.unstubAllEnvs();
    installLastReply(() => undefined);
  });

  it("the answer to \"Is this for **<Full Name>**?\" (or who / which / did you mean / which date) continues the request", () => {
    for (const asked of [
      "Is this for **Rowan Kestrel**? Tell me if that should change.",
      "Who is this **Corrective Action Form** for? Tell me the employee's full name.",
      "Which of them is this **Corrective Action Form** for — **Rowan Kestrel** or **Rowan Kessler**?",
      "Did you mean **Rowan Kestrel**?",
      "Which date did this happen — 11/7 or 11/8?",
    ]) {
      installLastReply(() => asked);
      expect(stateForTurn(STATE, ANSWER, [ASKED]), asked).toBe(STATE);
    }
  });

  it("a card that asks something further down is no such question: a request after it is new, as before", () => {
    installLastReply(() => "I'll draft a **Corrective Action Form** for **Rowan Kestrel** from what you've described …\n\nOne more question: **Is payroll deduct applicable?** Yes or No?");
    expect(stateForTurn(STATE, "make me a CA for Rowan Kestrel, her cash drawer was short $20 on 11/3", [ASKED])?.policyHeading ?? null).toBeNull();
  });

  it("a new request keeps the policy read in it, never the earlier one's", () => {
    const own = stateForTurn(STATE, "make me a CA for Rowan Kestrel, her cash drawer was short $20 on 11/3", [ASKED], { policyHeading: "Cash Handling", policyPage: 9 });
    expect(own).toMatchObject({ policyHeading: "Cash Handling", policyPage: 9, incidentType: null });
    expect(stateForTurn(STATE, "make me a CA for Rowan Kestrel, her cash drawer was short $20 on 11/3", [ASKED])).toMatchObject({ policyHeading: null, policyPage: null });
  });

  it("no reply entered (a test, the browser): as before", () => {
    expect(stateForTurn(STATE, ANSWER, [ASKED])?.policyHeading ?? null).toBeNull();
  });
});
