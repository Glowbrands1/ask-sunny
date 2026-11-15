import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { accountMissing } from "./agent-loop/tools";
import { withoutPayrollClauses } from "./payroll-clause-not-account";
import { accountSentences } from "./remap-incident";

/*
 * QA's #1028 review (HIGH): withoutPayrollClauses joined sentences with " ", so accountSentences lost the manager's line
 * splits. A payroll-only sentence is dropped in place; every other text is main's output, separators included.
 * PAYROLL_CLAUSE_NOT_ACCOUNT_ENABLED is on in production.
 */
beforeEach(() => vi.stubEnv("PAYROLL_CLAUSE_NOT_ACCOUNT_ENABLED", "true"));
afterEach(() => vi.unstubAllEnvs());

const MAIN_HOLDS = [
  "she was late on 11/9\ncan you make it a written",
  "she was late on 11/9\nPolicy reference: Attendance",
  "she was late on 11/9\nshe left early on 11/10",
];

describe("withoutPayrollClauses keeps the manager's separators", () => {
  it.each(MAIN_HOLDS)("%j → main's output (unchanged)", (said) => {
    expect(withoutPayrollClauses(said)).toBe(said);
  });
  it("a payroll-only line is dropped in place", () => {
    expect(withoutPayrollClauses("she was late on 11/9\nyes payroll but I don't know the amount\nshe left early on 11/10")).toBe("she was late on 11/9\nshe left early on 11/10");
    expect(withoutPayrollClauses("she was late on 11/9\nyes payroll but I don't know the amount")).toBe("she was late on 11/9");
  });
});

describe("accountSentences (remap-incident.ts) reads the lines as main does", () => {
  it.each([
    ["she was late on 11/9\ncan you make it a written", ["she was late on 11/9"]],
    ["she was late on 11/9\nPolicy reference: Attendance", ["she was late on 11/9"]],
    ["she was late on 11/9\nshe left early on 11/10", ["she was late on 11/9", "she left early on 11/10"]],
    ["she was late on 11/9\nyes payroll but I don't know the amount", ["she was late on 11/9"]],
  ])("%j → %j", (said, account) => {
    expect(accountSentences([said], "Juno Paxton")).toEqual(account);
  });
});

describe("accountMissing (agent-loop tools.ts) after withoutPayrollClauses", () => {
  it.each(MAIN_HOLDS)("%j → the same words as without the payroll reader", (said) => {
    vi.stubEnv("PAYROLL_CLAUSE_NOT_ACCOUNT_ENABLED", "");
    const off = accountMissing(said, "She was late on 11/9.");
    vi.stubEnv("PAYROLL_CLAUSE_NOT_ACCOUNT_ENABLED", "true");
    expect(accountMissing(withoutPayrollClauses(said), "She was late on 11/9.")).toEqual(off);
  });
});
