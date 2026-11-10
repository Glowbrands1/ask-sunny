import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { readExitDetails } from "@/lib/forms/exit-details";

import { isQuestionNotForm } from "./question-not-form";

// FIELD_LABEL_NOT_A_QUESTION_ENABLED (QA, 8 Nov 2026, from the sibling app's live tester; the same here). The person invented.
beforeEach(() => vi.stubEnv("FIELD_LABEL_NOT_A_QUESTION_ENABLED", "true"));
afterEach(() => vi.unstubAllEnvs());

describe("FIELD_LABEL_NOT_A_QUESTION_ENABLED", () => {
  it("off: \"how employee resigned - told management\" is a question (the bug)", () => {
    vi.stubEnv("FIELD_LABEL_NOT_A_QUESTION_ENABLED", "");
    expect(isQuestionNotForm("how employee resigned - told management")).toBe(true);
  });

  it.each([
    "how employee resigned - told management",
    "resignation date 10-26-2026. how employee resigned - Marnie told management she quit effective immediately on 10-26-2026. Reason for resignation - Marnie quit due to personal family issues.",
    "Reason for resignation: moving out of state",
    "last day worked 10/26/26",
  ])("on: %s fills a field, no question", (said) => {
    expect(isQuestionNotForm(said)).toBe(false);
  });

  it.each(["how employee resigned - what do I put here?", "how do I fill in how employee resigned?", "what is the reason for resignation policy?"])(
    "on: %s is still a question",
    (said) => {
      expect(isQuestionNotForm(said)).toBe(true);
    },
  );

  it("on: the labelled answer is the How Employee Resigned line; a known channel is read as before", () => {
    expect(readExitDetails("how employee resigned - told management", "2026-11-08").resignationMethod).toBe("Told management.");
    expect(readExitDetails("how employee resigned - she texted me that she quit", "2026-11-08").resignationMethod).toBe("Text message");
  });
});
