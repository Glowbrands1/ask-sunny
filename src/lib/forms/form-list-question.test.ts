import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { isFormListQuestion } = await import("./chat-form-records");

/* QA's f081 (20 Nov 2026): a request to LIST forms on file is never a request to make one or open one. */
const TODAY = "2026-11-20";
afterEach(() => {
  delete process.env.FORMS_ON_FILE_COUNTS_ENABLED;
});

describe("isFormListQuestion (FORMS_ON_FILE_COUNTS_ENABLED)", () => {
  it("off: never", () => {
    expect(isFormListQuestion("list ca for the month", TODAY)).toBe(false);
  });
  it("on: QA's wordings and other list asks are lists", () => {
    process.env.FORMS_ON_FILE_COUNTS_ENABLED = "true";
    for (const asked of [
      "list ca for the month",
      "show me CA and coaching forms for Avery Avebury this month",
      "who got a CA this month?",
      "how many coachings last week",
      "any write-ups for Avery Avebury this month?",
    ]) expect(isFormListQuestion(asked, TODAY), asked).toBe(true);
  });
  it("on: never a request to make, open or change a form, nor one form", () => {
    process.env.FORMS_ON_FILE_COUNTS_ENABLED = "true";
    for (const asked of [
      "make a CA for Avery Avebury for last week",
      "create a coaching form for Avery Avebury",
      "open the CA for Avery Avebury",
      "edit Avery Avebury's coaching form",
      "show me the draft CA for Avery Avebury",
      "show me Avery Avebury's CA",
      "ca for avery avebury, she was late on 11/14",
    ]) expect(isFormListQuestion(asked, TODAY), asked).toBe(false);
  });
});
