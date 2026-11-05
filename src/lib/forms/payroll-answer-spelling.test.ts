import { afterEach, describe, expect, it } from "vitest";

import { statedPayrollDeduct } from "./payroll-deduct";

/**
 * PAYROLL_ANSWER_SPELLING_ENABLED (Pau via QA, 5 Nov 2026, sf-s23): the
 * manager answered the payroll question "not pay roll deductable" (verbatim);
 * the card asked it again and made it the Observation of Offense.
 */
afterEach(() => {
  delete process.env.PAYROLL_ANSWER_SPELLING_ENABLED;
  delete process.env.NOT_DEDUCTIBLE_READ_ENABLED;
});

describe("\"not pay roll deductable\" answers the payroll question", () => {
  it("off, it is not read (the reported card)", () => {
    expect(statedPayrollDeduct("not pay roll deductable")).toBeNull();
  });

  it("on, it is No; the other spellings too", () => {
    process.env.PAYROLL_ANSWER_SPELLING_ENABLED = "true";
    expect(statedPayrollDeduct("not pay roll deductable")).toBe("no");
    expect(statedPayrollDeduct("not payroll deductible")).toBe("no");
    expect(statedPayrollDeduct("it is not payroll deductable")).toBe("no");
  });

  it("on, \"payroll\" spelled as one word is unchanged", () => {
    process.env.PAYROLL_ANSWER_SPELLING_ENABLED = "true";
    expect(statedPayrollDeduct("no payroll deduct")).toBe("no");
    expect(statedPayrollDeduct("yes payroll deduct")).toBe("yes");
  });
});

/*
 * coding 2's 3+3 of the bundle, 5 Nov 2026: on, "non-deductible" became
 * "non-deduct" and was no longer read as No with NOT_DEDUCTIBLE_READ_ENABLED
 * (on in production) on too (not-deductible-read-e2e).
 */
describe("PAYROLL_ANSWER_SPELLING_ENABLED keeps \"non-deductible\"", () => {
  it("on, \"non-deductible\" still reads No", async () => {
    process.env.PAYROLL_ANSWER_SPELLING_ENABLED = "true";
    process.env.NOT_DEDUCTIBLE_READ_ENABLED = "true";
    const { statedPayrollDeduct: stated } = await import("./payroll-deduct-answer");
    expect(stated("non-deductible")).toBe("no");
    expect(stated("not pay roll deductable")).toBe("no");
  });
});
