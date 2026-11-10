import { afterEach, describe, expect, it } from "vitest";

import { statedPayrollDeduct } from "./payroll-deduct-answer";

/*
 * PAYROLL_SPLIT_WORDS_ENABLED. The manager's words are verbatim (sf-s23, Pau 5 Nov 2026). The replay pack runs the
 * chat: `nov5-pau-sf-s21-s25-cases.ts` (sf-s23).
 */
afterEach(() => {
  delete process.env.PAYROLL_SPLIT_WORDS_ENABLED;
});

describe("\"not pay roll deductable\"", () => {
  it("is payroll No with the flag on, nothing with it off", () => {
    expect(statedPayrollDeduct("not pay roll deductable")).toBeNull();
    process.env.PAYROLL_SPLIT_WORDS_ENABLED = "true";
    expect(statedPayrollDeduct("not pay roll deductable")).toBe("no");
    expect(statedPayrollDeduct("not payroll deductible")).toBe("no");
    expect(statedPayrollDeduct("pay roll deductible: yes")).toBe("yes");
  });
});
