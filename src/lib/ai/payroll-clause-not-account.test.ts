import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { withoutPayrollClauses } from "./payroll-clause-not-account";

// PAYROLL_CLAUSE_NOT_ACCOUNT_ENABLED (QA's Sunny round-5 live tester, 8 Nov 2026, item 2a).
beforeEach(() => vi.stubEnv("PAYROLL_CLAUSE_NOT_ACCOUNT_ENABLED", "true"));
afterEach(() => vi.unstubAllEnvs());

describe("withoutPayrollClauses", () => {
  it("off: the text as it was", () => {
    vi.stubEnv("PAYROLL_CLAUSE_NOT_ACCOUNT_ENABLED", "");
    const said = "she was late today, $20 payroll deduct applies Payroll deduction amount: $20.";
    expect(withoutPayrollClauses(said)).toBe(said);
  });

  it.each([
    ["she was late today, $20 payroll deduct applies Payroll deduction amount: $20.", "she was late today"],
    ["she was late today, $20 payroll deduct applies", "she was late today"],
    ["she was late today and payroll deduct is applicable", "she was late today"],
    ["the register was off $20 Payroll deduction amount: $20.", "the register was off $20"],
    ["she was late today, $12.50 payroll deduction applies", "she was late today"],
  ])("%s → %s", (said, account) => {
    expect(withoutPayrollClauses(said)).toBe(account);
  });

  it.each([
    "$25 will be payroll deducted for late open on 10-21-26",
    "the register was off $20 at close",
    "she asked whether payroll deduct applies to tips",
  ])("%s → unchanged", (said) => {
    expect(withoutPayrollClauses(said)).toBe(said);
  });
});
