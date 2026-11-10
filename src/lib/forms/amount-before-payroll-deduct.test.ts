import { afterEach, describe, expect, it, vi } from "vitest";

import { payrollDeductAmount } from "./payroll-deduct";

/**
 * AMOUNT_BEFORE_PAYROLL_DEDUCT_ENABLED (QA's Sunny flip-9 live tester, 8 Nov 2026): "$20 payroll deduct applies"
 * read Yes and asked the amount again.
 */
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("payrollDeductAmount: a figure before \"payroll deduct\"", () => {
  it("off: not read", () => {
    expect(payrollDeductAmount("$20 payroll deduct applies")).toBeNull();
  });

  describe("on", () => {
    it.each([
      ["$20 payroll deduct applies", "$20"],
      ["the register was off $20. $20 payroll deduct applies", "$20"],
      ["$12.50 payroll deduction applies", "$12.50"],
      ["$20 payroll-deduct", "$20"],
      ["25 dollars payroll deduct applies", "$25"],
    ])("%s → %s", (text, amount) => {
      vi.stubEnv("AMOUNT_BEFORE_PAYROLL_DEDUCT_ENABLED", "true");
      expect(payrollDeductAmount(text)).toBe(amount);
    });

    it.each([
      "$20 deduct applies",
      "the register was off $20. payroll deduct applies",
      "payroll deduct applies",
      "20 payroll deduct applies",
      "$0 payroll deduct applies",
    ])("%s → none", (text) => {
      vi.stubEnv("AMOUNT_BEFORE_PAYROLL_DEDUCT_ENABLED", "true");
      expect(payrollDeductAmount(text)).toBeNull();
    });
  });
});
