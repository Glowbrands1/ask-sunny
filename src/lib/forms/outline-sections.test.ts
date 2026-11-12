import { describe, expect, it } from "vitest";

import { addUnderExpectation, addUnderObserved, hasSections, readsAsAccount, repeatsOldText, tailAfterLastSection, withSectionSpacing } from "./outline-sections";

// QA's live draft test, 8 Nov 2026 (the person invented).
const OLD = "Observed:\nOttoline missed the monthly meeting on 10/10/26.\n\nExpectation:\nOttoline attends every meeting.\n\nGoing Forward:\nOttoline will set reminders.";
const ADDED = "She was reminded about the meeting twice.";

describe("outline sections", () => {
  it("knows a field written in sections", () => {
    expect(hasSections(OLD)).toBe(true);
    expect(hasSections("Observed:\nShe was late.")).toBe(false);
    expect(hasSections("She was late.")).toBe(false);
  });

  it("puts added text at the end of Observed", () => {
    expect(addUnderObserved(OLD, ADDED)).toBe(
      "Observed:\nOttoline missed the monthly meeting on 10/10/26.\nShe was reminded about the meeting twice.\n\nExpectation:\nOttoline attends every meeting.\n\nGoing Forward:\nOttoline will set reminders.",
    );
  });

  it("finds new lines a whole-text write put after the last section", () => {
    expect(tailAfterLastSection(OLD, `${OLD.replace(/\n\n/g, "\n")}\n${ADDED}`)).toBe(ADDED);
    expect(tailAfterLastSection(OLD, OLD)).toBeNull();
    expect(tailAfterLastSection(OLD, "Observed:\nSomething else entirely.")).toBeNull();
  });

  it("keeps one blank line before each heading when the field had them", () => {
    expect(withSectionSpacing(OLD, OLD.replace(/\n\n/g, "\n"))).toBe(OLD);
    expect(withSectionSpacing("Observed:\nA\nExpectation:\nB", "Observed:\nA\nExpectation:\nC")).toBe("Observed:\nA\nExpectation:\nC");
  });
});

describe("QA's ruling (b), 12 Nov 2026: only an account goes under Observed", () => {
  it.each(["She was reminded about the meeting twice.", "she was also on her phone", "Marnie was reminded of the policy."])("%j is an account", (said) => {
    expect(readsAsAccount(said)).toBe(true);
  });

  it.each([
    "she Must Practice the sanitizing checklist every shift.",
    "she needs to clock in on time",
    "Jane is expected to arrive on time",
    "she will set a reminder for every meeting",
    "She should follow the dress code",
  ])("%j is an expectation or instruction", (said) => {
    expect(readsAsAccount(said)).toBe(false);
  });

  it("an add that repeats the field's own text is not new", () => {
    const old = "Observed:\nOttoline missed the monthly meeting on 10/10/26.\n\nExpectation:\nOttoline attends every meeting.";
    expect(repeatsOldText(old, "Observed: Ottoline missed the monthly meeting on 10/10/26. She was reminded twice.")).toBe(true);
    expect(repeatsOldText(old, "She was reminded twice.")).toBe(false);
  });
});

describe("QA's ruling (b), extended (12 Nov 2026): an instruction goes under Expectation, as its own line", () => {
  const OLD = "Observed:\nJane was late to open on 10/20/26.\n\nExpectation:\nJane is expected to arrive on time.\n\nGoing Forward:\nJane will arrive on time.\n\nPolicy reference: Attendance Policy, JBA Policy Manual p.14";

  it("its own line at the end of Expectation, capitalised as the field's other lines are", () => {
    expect(addUnderExpectation(OLD, "she Must Practice the sanitizing checklist every shift.")).toBe(
      OLD.replace("arrive on time.\n\nGoing", "arrive on time.\nShe Must Practice the sanitizing checklist every shift.\n\nGoing"),
    );
  });

  it("the manager's casing stays when the field's lines do not start with a capital", () => {
    const lower = "Observed:\njane was late.\n\nExpectation:\njane arrives on time.";
    expect(addUnderExpectation(lower, "she must practice the checklist.")).toBe(`${lower}\nshe must practice the checklist.`);
  });

  it("Expectation last, before the policy reference line; no Expectation section, null", () => {
    const last = "Observed:\nJane was late.\n\nExpectation:\nJane arrives on time.\n\nPolicy reference: Attendance Policy";
    expect(addUnderExpectation(last, "she must clock in.")).toBe(last.replace("on time.\n\nPolicy", "on time.\nShe must clock in.\n\nPolicy"));
    expect(addUnderExpectation("Observed:\nJane was late.", "she must clock in.")).toBeNull();
  });
});
