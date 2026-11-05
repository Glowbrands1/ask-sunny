import { afterEach, describe, expect, it } from "vitest";

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

describe("WRITE_ME_A_REQUEST_ENABLED: \"write me a CA …\" is a request (QA, coding-3, 5 Nov 2026)", () => {
  // The manager's exact wording; the name is invented.
  const REQUEST = "can you write me a Ca for Oriel Marchbourne for performance for october";
  const FLAG = "WRITE_ME_A_REQUEST_ENABLED";
  const saved = process.env[FLAG];
  afterEach(() => {
    if (saved === undefined) delete process.env[FLAG];
    else process.env[FLAG] = saved;
  });

  it("off: the exact wording is not a request to create the form, as before", () => {
    delete process.env[FLAG];
    expect(creation(REQUEST)).toBe(false);
  });

  it("on: the exact wording asks for the Corrective Action Form to be created", () => {
    process.env[FLAG] = "true";
    expect(creation(REQUEST)).toBe(true);
  });

  it.each([
    "can you write me a summary of the corrective action policy",
    "write me a note explaining the corrective action steps",
  ])("on: writing ABOUT corrective action for me is still no request: %s", (text) => {
    process.env[FLAG] = "true";
    expect(creation(text)).toBe(false);
  });

  it("on: a question stays a question", () => {
    process.env[FLAG] = "true";
    expect(creation("how do I write a CA?")).toBe(false);
  });
});
