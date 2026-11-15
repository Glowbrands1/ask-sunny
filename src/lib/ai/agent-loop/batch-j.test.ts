import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { notSavedThisTurn, stepLimitReply } = await import("./run");

/* Batch J3 (QA's live re-run, 9b): a reply that stops early names what the manager's message stated and is not saved. */
describe("what this message stated that is not saved", () => {
  const said = "make it a written and yes payroll $15";
  it("9b: the level and payroll saved on the draft, the $15 not", () => {
    const missing = notSavedThisTurn(said, { proposal: null, formUpdate: { instanceId: "i", updated: ["warning_type", "payroll_deduct"] } }, [], true);
    expect(missing).toEqual(["**Payroll deduction amount** ($15)"]);
    expect(stepLimitReply("I saved these changes on the form: warning type, payroll deduct.", missing)).toBe(
      "I saved these changes on the form: warning type, payroll deduct. I couldn't finish everything in one message. Not saved yet: **Payroll deduction amount** ($15). Tell me again and I'll add it.",
    );
  });
  it("nothing saved on the draft: each stated field", () => {
    expect(notSavedThisTurn(said, { proposal: null, formUpdate: null }, [], true)).toEqual([
      "**Type of Warning** (Written Warning)",
      "**Payroll deduct** (Yes)",
      "**Payroll deduction amount** ($15)",
    ]);
  });
  it("a card that holds what was said lists nothing, and the one-thing question stays", () => {
    const card = { warningLevel: "written", payrollDeduct: "yes", payrollDeductAmount: "15" } as never;
    expect(notSavedThisTurn(said, { proposal: card, formUpdate: null }, [], false)).toEqual([]);
    expect(stepLimitReply("Here is the card.", [])).toMatch(/What's the one thing still left\?$/);
  });
  it("a field an edit refused is named", () => {
    expect(notSavedThisTurn("change the details", { proposal: null, formUpdate: null }, ["details"], true)).toEqual(["**details**"]);
  });
  it("\"no payroll\" is not a payroll Yes", () => {
    expect(notSavedThisTurn("written, no payroll", { proposal: null, formUpdate: { instanceId: "i", updated: ["warning_type"] } }, [], true)).toEqual(["**Payroll deduct** (No)"]);
  });
});
