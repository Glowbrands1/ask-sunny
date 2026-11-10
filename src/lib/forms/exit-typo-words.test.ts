import { afterEach, describe, expect, it, vi } from "vitest";

import { readExitDetails, withExitWordsSpelled } from "./exit-details";

// Pau's P17 (Sunny production, 10 Nov 2026), the manager's words; the employee is not named.
const SAID = "salon items will be returneded and they are eligiable for rehire. payroll not deducted";

const answers = (text: string) => {
  const read = readExitDetails(text, "2026-11-10").answers;
  return { items: read.store_items_returned, rehire: read.eligible_for_rehire, payroll: read.payroll_deduction_applicable };
};

describe("EXIT_TYPO_WORDS_ENABLED", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("off: the misspelled answers are left blank (the bug); payroll is read", () => {
    expect(answers(SAID)).toEqual({ items: undefined, rehire: undefined, payroll: "no" });
  });

  it("on: \"returneded\" and \"eligiable\" are read as returned and eligible", () => {
    vi.stubEnv("EXIT_TYPO_WORDS_ENABLED", "true");
    expect(answers(SAID)).toEqual({ items: "yes", rehire: "yes", payroll: "no" });
  });

  it("real words are never corrected; a correctly spelled turn is unchanged", () => {
    expect(withExitWordsSpelled("she retired and is reliable")).toBe("she retired and is reliable");
    expect(withExitWordsSpelled("items returned, eligible for rehire")).toBe("items returned, eligible for rehire");
    expect(withExitWordsSpelled("not elegible for rehre")).toBe("not eligible for rehire");
  });
});
