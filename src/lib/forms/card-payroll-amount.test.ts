import { describe, expect, it } from "vitest";

import { cardNotesPayrollAmount, cardPayrollAmount } from "./card-payroll-amount";

// QA's code audit (20 Nov 2026, item 20): a loop card's saved amount is the card's own.
describe("card payroll amount", () => {
  it("reads the card's figure", () => {
    expect(cardPayrollAmount("20")).toBe("$20");
    expect(cardPayrollAmount("$25")).toBe("$25");
    expect(cardPayrollAmount("1,250.50")).toBe("$1,250.50");
    expect(cardPayrollAmount("0")).toBeNull();
    expect(cardPayrollAmount("twenty")).toBeNull();
    expect(cardPayrollAmount(undefined)).toBeNull();
  });

  it("reads the card's own draft line, and nothing else", () => {
    expect(cardNotesPayrollAmount("Employee: Remy Calder\nWhat happened: late\nPayroll deduct applicable: Yes\nPayroll deduct amount: $25")).toBe("$25");
    expect(cardNotesPayrollAmount("she owes $45, payroll deduct")).toBeNull();
  });
});
