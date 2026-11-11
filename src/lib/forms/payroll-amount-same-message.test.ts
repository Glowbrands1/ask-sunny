import { afterEach, describe, expect, it, vi } from "vitest";

import { payrollDeductAmount } from "./payroll-deduct";
import { joinReferredAmount } from "./payroll-deduct-answer";

/*
 * PAYROLL_AMOUNT_SAME_MESSAGE_ENABLED (the sibling app's live chat, 5 Nov 2026, word for word; the employee is
 * invented): the $20 in the same message was not read, and the amount was asked.
 */
const SAID =
  "create a verbal ca for marnie holloway. on 11-1-26 the register was off $20. which will be payroll deducted from Marnie's check. previous coaching was jba policy manual on 8-1-26. payroll deduct applies";

afterEach(() => vi.unstubAllEnvs());

describe("PAYROLL_AMOUNT_SAME_MESSAGE_ENABLED", () => {
  it("off: the amount is not read (the live behaviour)", () => {
    expect(payrollDeductAmount(SAID)).toBeNull();
  });

  it("on: the $20 is the amount", () => {
    vi.stubEnv("PAYROLL_AMOUNT_SAME_MESSAGE_ENABLED", "true");
    expect(payrollDeductAmount(SAID)).toBe("$20");
    expect(payrollDeductAmount("the drawer was short $12.50, which will be deducted from her pay")).toBe("$12.50");
    expect(payrollDeductAmount("she owes 30 dollars and that will be payroll deducted")).toBe("$30");
  });

  it("on, with CA_SHORTCUT_WORDS_ENABLED too (on in production)", () => {
    vi.stubEnv("PAYROLL_AMOUNT_SAME_MESSAGE_ENABLED", "true");
    vi.stubEnv("CA_SHORTCUT_WORDS_ENABLED", "true");
    expect(payrollDeductAmount(SAID)).toBe("$20");
  });

  it("on: an amount the deduction clause does not refer to is not read", () => {
    vi.stubEnv("PAYROLL_AMOUNT_SAME_MESSAGE_ENABLED", "true");
    expect(payrollDeductAmount("the register was $40 short. that is the third time this month. payroll deduct applies")).toBeNull();
    expect(payrollDeductAmount("she was 20 minutes late, which is why payroll deduct applies")).toBeNull();
    expect(joinReferredAmount("on 11-1-26 it happened")).toBe("on 11-1-26 it happened");
  });
});
