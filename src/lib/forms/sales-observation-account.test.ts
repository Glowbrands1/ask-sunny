import { afterEach, describe, expect, it, vi } from "vitest";

import { observationAccount } from "./ca-policy";

/**
 * SALES_OBSERVATION_ACCOUNT_ENABLED (QA's Sunny flip-4 gate, 7 Nov 2026): the card's Observation holds the
 * account, never the request's words, the employee's name in front of them, or a payroll answer. QA's exact
 * shapes; the person is the pack's invented Remy Calder.
 */
const NAME = "Remy Calder";

function on() {
  vi.stubEnv("SALES_SHORTFALL_OBJECT_ENABLED", "true");
  vi.stubEnv("SALES_OBSERVATION_ACCOUNT_ENABLED", "true");
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("SALES_OBSERVATION_ACCOUNT_ENABLED", () => {
  it("off: the sentence as it is (the gate's finding)", () => {
    vi.stubEnv("SALES_SHORTFALL_OBJECT_ENABLED", "true");
    expect(observationAccount("Remy Calder on performance", NAME)).toBe("Remy Calder on performance");
  });

  it.each([
    ["Remy Calder on performance", ""],
    ["written CA for Remy Calder on performance", ""],
    ["performance for october not pay roll deductable", ""],
    ["can you write me a Ca for remy calder for performance for october", ""],
    ["She had 24 tans and was below in Below in PPTA, LPSVA, Avg Club, CC%, and Spa%", "She had 24 tans and was below in Below in PPTA, LPSVA, Avg Club, CC%, and Spa%"],
  ])("on: %s → %j", (sentence, account) => {
    on();
    expect(observationAccount(sentence, NAME)).toBe(account);
  });

  it("on, negative: an account that names her keeps her name", () => {
    on();
    expect(observationAccount("Remy Calder was rude to a guest at the front desk", NAME)).toBe("Remy Calder was rude to a guest at the front desk");
  });

  it("on, negative: a sentence about her performance review is left alone", () => {
    on();
    expect(observationAccount("She skipped her performance review twice this month", NAME)).toBe("She skipped her performance review twice this month");
  });
});
