import { describe, expect, it } from "vitest";

import {
  payrollDeductAmount,
  payrollDeductCorrection,
  payrollDeductFromConversation,
  payrollDeductSentence,
  statedPayrollDeduct,
} from "./payroll-deduct";

/**
 * QA, 22 Oct 2026 — F-01 follow-up. The first F-01 fix read the reported
 * negations ("we will not payroll deduct $25", "don't payroll deduct $25",
 * "$25 payroll deduction was waived") as No, but other ways of saying no next
 * to an amount still came back Yes, because an amount beside "payroll deduct"
 * is read as a deduction to take. A Yes read from an amount or a verb is now a
 * Yes only when nothing beside it denies it; otherwise the manager is asked.
 */

describe("an amount beside a denial is never a Yes", () => {
  it.each([
    "we're not doing the $25 payroll deduction",
    "the DM said skip the $25 payroll deduction",
    "no need for the $25 payroll deduction",
    "hold off on the $25 payroll deduction",
    "cancel the $25 payroll deduction",
    "instead of the $25 payroll deduction she will retrain",
  ])("%s → not read (asked)", (text) => {
    expect(statedPayrollDeduct(text)).toBeNull();
    expect(payrollDeductCorrection(text)).toBeNull();
    expect(payrollDeductSentence({ answer: statedPayrollDeduct(text), amount: payrollDeductAmount(text), firstName: "Pat" })).toBeNull();
  });

  it.each(["payroll deduct $25 does not apply", "$25 payroll deduction is not needed", "payroll deduction $3.25 isn't applicable"])(
    "%s → No",
    (text) => {
      expect(statedPayrollDeduct(text)).toBe("no");
    },
  );
});

describe("a denied waiver is not a No, and not a guess", () => {
  it.each(["we did not waive the $25 payroll deduction", "the payroll deduction was not waived, deduct $25"])("%s → asked", (text) => {
    expect(statedPayrollDeduct(text)).toBeNull();
  });
});

describe("the reported sentences stay No", () => {
  it.each([
    "we will not payroll deduct $25",
    "don't payroll deduct $25",
    "$25 payroll deduction was waived",
    "the $25 payroll deduction was waived",
    "we waived the $25 payroll deduction",
  ])("%s → No", (text) => {
    expect(statedPayrollDeduct(text)).toBe("no");
  });
});

describe("every Yes the manager plainly gives is still a Yes", () => {
  it.each([
    ["payroll deduct $25", "$25"],
    ["$25 payroll deduction", "$25"],
    ["$25 will be payroll deducted", "$25"],
    ["payroll deduct of $3.25 is applicable", "$3.25"],
    ["deduct $25 from her paycheck", "$25"],
    ["she was late, not her first time. payroll deduct $25", "$25"],
    ["she did not call, payroll deduct $25", "$25"],
    ["payroll deduct $25 because the salon opened late", "$25"],
  ])("%s → Yes, %s", (text, amount) => {
    expect(statedPayrollDeduct(text)).toBe("yes");
    expect(payrollDeductAmount(text)).toBe(amount);
  });

  it.each(["yes payroll deduct", "payroll deduct yes", "payroll deduct applies", "payroll deduct: yes"])("%s → Yes", (text) => {
    expect(statedPayrollDeduct(text)).toBe("yes");
  });
});

describe("in a conversation, a later unclear statement withdraws an earlier Yes", () => {
  const user = (content: string) => ({ role: "user", content });
  const assistant = (content: string) => ({ role: "assistant", content });

  it("Yes, then 'we're not doing the $25 payroll deduction' → asked", () => {
    expect(
      payrollDeductFromConversation(
        [user("create a verbal ca for pat rivera, she was late today, payroll deduct $25"), assistant("Here is the form."), user("actually we're not doing the $25 payroll deduction")],
        { fromThisForm: true },
      ),
    ).toBeNull();
  });

  it("an unclear statement, then a plain No → No", () => {
    expect(
      payrollDeductFromConversation([user("skip the $25 payroll deduction"), assistant("Is payroll deduct applicable? (Yes or No)"), user("no")], {
        fromThisForm: true,
      }),
    ).toBe("no");
  });

  it("an unclear statement, then a plain Yes → Yes", () => {
    expect(
      payrollDeductFromConversation([user("no need for the $25 payroll deduction"), assistant("Is payroll deduct applicable? (Yes or No)"), user("yes")], {
        fromThisForm: true,
      }),
    ).toBe("yes");
  });
});

describe("the Action Plan's amount never carries the comma that ends the clause", () => {
  it.each([
    ["payroll deduct $25, she was late", "$25"],
    ["she was late, payroll deduct $25, and coached", "$25"],
    ["deduction of $3.25, effective today", "$3.25"],
    ["$1,250 payroll deduction", "$1,250"],
    ["payroll deduct $1,250.50", "$1,250.50"],
    ["payroll deduct $25.", "$25"],
  ])("%s → %s", (text, amount) => {
    expect(payrollDeductAmount(text)).toBe(amount);
    expect(payrollDeductSentence({ answer: "yes", amount: payrollDeductAmount(text), firstName: "Pat" })).toBe(
      `${amount} will be deducted from Pat's pay.`,
    );
  });

  it("an amount followed by a comma and then the deduction is not read as the amount", () => {
    expect(payrollDeductAmount("she owes $25, payroll deduction applies")).toBeNull();
    expect(payrollDeductSentence({ answer: "yes", amount: null, firstName: "Pat" })).toBe("A payroll deduction applies.");
  });
});
