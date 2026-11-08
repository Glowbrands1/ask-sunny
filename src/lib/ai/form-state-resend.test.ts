import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { stateForTurn, type ConversationFormState } from "./form-state";

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
