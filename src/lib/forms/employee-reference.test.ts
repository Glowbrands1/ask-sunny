import { describe, expect, it } from "vitest";

import { employeeReferenceRule, nameEmployeeInDraft, nameInsteadOfPronouns } from "./employee-reference";

describe("nameInsteadOfPronouns — the tester's sentence", () => {
  it("writes \"Christiana did not call in\", not \"She did not call in\"", () => {
    expect(nameInsteadOfPronouns("She did not call in for her scheduled shift.", "Christiana Lee")).toBe(
      "Christiana did not call in for her scheduled shift.",
    );
  });

  it.each([
    ["He arrived 20 minutes late. He did not clock in.", "Marcus arrived 20 minutes late. Marcus did not clock in."],
    ["She's been late three times this month.", "Christiana's been late three times this month."],
    ["Her shift started at 9 am.", "Christiana's shift started at 9 am."],
    ["Observed: She was late.\n\nExpectation: Arrive on time.", "Observed: Christiana was late.\n\nExpectation: Arrive on time."],
    ["Observed:\nShe was late.", "Observed:\nChristiana was late."],
  ])("%s", (input, expected) => {
    const name = /Marcus/.test(expected) ? "marcus" : "christiana";
    expect(nameInsteadOfPronouns(input, name)).toBe(expected);
  });

  it("uses the first name as typed, capitalised because it opens a sentence", () => {
    expect(nameInsteadOfPronouns("She left early.", "paulyne co")).toBe("Paulyne left early.");
  });

  it("leaves quoted words exactly as written", () => {
    const text = 'The manager noted: "She said she was sick." Christiana did not call.';
    expect(nameInsteadOfPronouns(text, "Christiana")).toBe(text);
  });

  it("never names the employee where the pronoun may be somebody else", () => {
    const text = "A customer complained at the front desk. She said the room was not cleaned.";
    expect(nameInsteadOfPronouns(text, "Christiana")).toBe(text);
  });

  it("leaves mid-sentence pronouns alone — object and possessive cannot be told apart safely", () => {
    const text = "The manager told her to clock in on time.";
    expect(nameInsteadOfPronouns(text, "Christiana")).toBe(text);
  });

  it("does nothing without a usable name", () => {
    expect(nameInsteadOfPronouns("She left.", "")).toBe("She left.");
  });
});

describe("nameEmployeeInDraft", () => {
  it("rewrites every drafted value and names the keys it changed", () => {
    const result = nameEmployeeInDraft(
      { details: "She texted on Sunday that she was quitting.", policy: "Attendance" },
      "Christiana",
    );
    expect(result.values.details).toBe("Christiana texted on Sunday that she was quitting.");
    expect(result.values.policy).toBe("Attendance");
    expect(result.renamed).toEqual(["details"]);
  });
});

describe("employeeReferenceRule", () => {
  it("names the employee and forbids gendered pronouns", () => {
    const rule = employeeReferenceRule("Christiana Lee");
    expect(rule).toContain("Christiana Lee");
    expect(rule).toMatch(/never as "she", "he"/);
  });
});
