import { describe, expect, it } from "vitest";

import { detectTemplateIntent } from "./template-intent";

/**
 * QA, 22 Oct 2026 — F-04: "WRITE A …" IS A FORM REQUEST ONLY WHEN THE FORM IS
 * WHAT IS BEING WRITTEN.
 *
 * "write a" / "write an" had been added as bare creation verbs, so a policy
 * question or a writing request that mentioned corrective action became a
 * request to create a Corrective Action Form.
 */
const creation = (text: string) => (detectTemplateIntent(text) as { requestedCreation?: boolean }).requestedCreation === true;

describe("QA F-04: writing ABOUT corrective action is not a request for the form", () => {
  it.each([
    "can you write a summary of the corrective action policy",
    "write a note explaining the corrective action steps",
    "write an email to Daisley about her CA",
    "write a letter to HR about the corrective action process",
    "write an explanation of the CA steps for my new SD",
  ])("%s", (text) => {
    expect(detectTemplateIntent(text).kind).toBe("corrective_action");
    expect(creation(text)).toBe(false);
  });

  it.each([
    "how do I write a CA?",
    "should I write a CA or coach her?",
    "what does the policy say about corrective actions?",
  ])("a question stays a question: %s", (text) => {
    expect(creation(text)).toBe(false);
  });
});

describe("QA F-04: writing THE FORM is still a request", () => {
  it.each([
    "write a CA for Daisley",
    "Write a CA for daisley, she was late today",
    "write a corrective action for Dana Moss",
    "write up a CA for Dana Moss",
  ])("%s", (text) => {
    expect(creation(text)).toBe(true);
  });

  it.each([
    "write a written warning for Dana Moss",
    "write a final written warning for Dana Moss, she was late again",
    "write her up for being late",
  ])("%s names the Corrective Action Form", (text) => {
    expect(detectTemplateIntent(text)).toEqual({ kind: "explicit", templateKey: "dpoa" });
  });
});
