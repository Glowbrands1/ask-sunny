import { describe, expect, it } from "vitest";

import { addUnderObserved, hasSections, readsAsAccount, repeatsOldText, tailAfterLastSection, withSectionSpacing } from "./outline-sections";

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
