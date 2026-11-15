import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { notSavedThisTurn, stepLimitReply } = await import("./run");

/*
 * Batch J3 (QA's live re-run, 9b), as QA's review ruled (NO-GO 6): a reply that stops early names only what THIS message
 * asked to change and the form, as saved at the end of the turn, still does not hold. Changed on purpose (15 Nov 2026,
 * the review): the draft's state is read from the saved form, no longer from the turn's edit results.
 */
const form = (warningLevel: string | null, payrollDeduct: string | null, payrollAmount: string | null) => ({ form: { warningLevel, payrollDeduct, payrollAmount }, fields: new Set<string>() });

describe("what this message asked to change that is not saved", () => {
  const said = "make it a written and yes payroll $15";
  it("9b: the level and payroll saved on the draft, the $15 not", () => {
    const missing = notSavedThisTurn(said, { proposal: null, formUpdate: { instanceId: "i", updated: ["warning_type", "payroll_deduct"] } }, [], true, form("written", "yes", null));
    expect(missing).toEqual(["**Payroll deduction amount** ($15)"]);
    expect(stepLimitReply("I saved these changes on the form: warning type, payroll deduct.", missing)).toBe(
      "I saved these changes on the form: warning type, payroll deduct. I couldn't finish everything in one message. Not saved yet: **Payroll deduction amount** ($15). Tell me again and I'll add it.",
    );
  });

  it("nothing saved on the draft: each field asked for", () => {
    expect(notSavedThisTurn(said, { proposal: null, formUpdate: null }, [], true, form(null, null, null))).toEqual([
      "**Type of Warning** (Written Warning)",
      "**Payroll deduct** (Yes)",
      "**Payroll deduction amount** ($15)",
    ]);
  });

  it("a card that holds what was asked lists nothing, and the one-thing question stays", () => {
    const card = { warningLevel: "written", payrollDeduct: "yes", payrollDeductAmount: "15" } as never;
    expect(notSavedThisTurn(said, { proposal: card, formUpdate: null }, [], false)).toEqual([]);
    expect(stepLimitReply("Here is the card.", [])).toMatch(/What's the one thing still left\?$/);
  });

  it("history is never an ask: \"she was written up last month\", \"a verbal was given on 9/1\"", () => {
    expect(notSavedThisTurn("she was written up last month for the same thing", { proposal: null, formUpdate: null }, [], true, form(null, null, null))).toEqual([]);
    expect(notSavedThisTurn("a verbal was given on 9/1, she was late again on 11/9", { proposal: null, formUpdate: null }, [], true, form(null, null, null))).toEqual([]);
  });

  it("a field refused once and saved later in the turn is not listed; one still refused is", () => {
    const saved = { form: { warningLevel: null, payrollDeduct: null, payrollAmount: null }, fields: new Set(["details"]) };
    expect(notSavedThisTurn("change the details", { proposal: null, formUpdate: null }, ["details", "details"], true, saved)).toEqual([]);
    expect(notSavedThisTurn("change the details", { proposal: null, formUpdate: null }, ["details"], true, form(null, null, null))).toEqual(["**details**"]);
  });

  it("\"no payroll\" is not a payroll Yes", () => {
    expect(notSavedThisTurn("written, no payroll", { proposal: null, formUpdate: null }, [], true, form("written", null, null))).toEqual(["**Payroll deduct** (No)"]);
  });
});
