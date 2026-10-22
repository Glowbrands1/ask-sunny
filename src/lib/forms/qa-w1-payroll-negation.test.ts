import { describe, expect, it } from "vitest";

import { payrollDeductFromConversation, payrollDeductSentence, statedPayrollDeduct } from "./payroll-deduct";

/**
 * QA, 22 Oct 2026 — F-01: A NEGATIVE INSTRUCTION IS NEVER A YES.
 *
 * "we will not payroll deduct $25", "don't payroll deduct $25" and "$25
 * payroll deduction was waived" were read as Yes: the negation only allowed
 * "be" before "deduct", there was no waiver reading, and the amount reading
 * ("payroll deduct $25", "$25 payroll deduction") then answered Yes.
 */
describe("QA F-01: a negated or waived deduction is No", () => {
  it.each([
    "we will not payroll deduct $25",
    "don't payroll deduct $25",
    "do not payroll deduct her the $25",
    "$25 payroll deduction was waived",
    "the $25 deduction is waived",
    "we waived the payroll deduction",
    "she won't be payroll deducted",
    "we're not going to payroll deduct the $25",
    "we decided not to deduct $25",
    "no longer payroll deducting the $25",
    "never payroll deduct for this",
  ])("%s -> no", (text) => {
    expect(statedPayrollDeduct(text)).toBe("no");
  });

  it("puts no amount sentence on the plan for a waived deduction", () => {
    expect(payrollDeductSentence({ answer: statedPayrollDeduct("$25 payroll deduction was waived"), amount: "$25", firstName: "Pat" })).toBeNull();
  });
});

describe("QA F-01: every existing Yes still reads Yes", () => {
  it.each([
    "payroll deduct $25",
    "$25 payroll deduction",
    "payroll deduct yes",
    "payroll deduct: y",
    "$25 will be payroll deducted",
    "payroll deduct of $3.25 is applicable",
    "deduct $3.25 from her pay",
    "yes to payroll deduction",
  ])("%s -> yes", (text) => {
    expect(statedPayrollDeduct(text)).toBe("yes");
  });
});

describe("QA F-01: undecided or contradictory states nothing, never Yes", () => {
  it.each([
    "maybe deduct $25",
    "possibly payroll deduct $25",
    "not sure about payroll deduct",
    "thinking about a $25 payroll deduction",
    "payroll deduct? not sure",
    "payroll deduct yes, don't deduct",
  ])("%s -> null", (text) => {
    expect(statedPayrollDeduct(text)).toBeNull();
  });

  it("does not let an undecided clause stand as a Yes after one", () => {
    expect(statedPayrollDeduct("payroll deduct $25. actually not sure about the deduction")).toBeNull();
  });

  it("leaves unrelated hedges alone", () => {
    expect(statedPayrollDeduct("she might be late again. payroll deduct $25")).toBe("yes");
    expect(statedPayrollDeduct("maybe she forgot. no payroll deduct")).toBe("no");
  });
});

describe("QA F-01: across the conversation, the last statement wins", () => {
  const user = (content: string) => ({ role: "user", content });
  const assistant = (content: string) => ({ role: "assistant", content });

  it("a negation, then an explicit correction to Yes", () => {
    const turns = [user("create verbal ca for pat rivera, she was late today. we will not payroll deduct $25")];
    expect(payrollDeductFromConversation(turns)).toBe("no");
    expect(payrollDeductFromConversation([...turns, assistant("I'll draft a Corrective Action Form."), user("actually, payroll deduct $25")])).toBe("yes");
  });

  it("a Yes, then a waiver", () => {
    expect(
      payrollDeductFromConversation([
        user("create verbal ca for pat rivera, she was late today, payroll deduct $25"),
        assistant("I'll draft a Corrective Action Form."),
        user("the deduction was waived by her manager"),
      ]),
    ).toBe("no");
  });

  it("an undecided reply to the question is not an answer", () => {
    expect(
      payrollDeductFromConversation([
        user("create verbal ca for pat rivera, she was late today"),
        assistant("One more question: **Is payroll deduct applicable?** Yes or No?"),
        user("not sure yet, maybe a $25 deduction"),
      ]),
    ).toBeNull();
  });
});
