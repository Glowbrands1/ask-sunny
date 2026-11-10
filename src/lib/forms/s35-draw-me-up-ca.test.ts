import { afterEach, describe, expect, it, vi } from "vitest";

import { isQuestionNotForm } from "@/lib/ai/question-not-form";

import { detectTemplateIntent } from "./template-intent";

/**
 * QA's live tester (7 Nov 2026; CA_REQUEST_NOT_PRIOR_COACHING rolled back at 00:22): sf-s35's exact wording, the
 * employee invented, opened no card: "Can you …" read as a question, and "draw me up" asked for no form once the
 * coaching document was set aside as history.
 */
const TESTER = "Can you draw me up a CA for Wrenna Calloway for being late on 10/23/26. Wrenna has signed a coaching document for being late on 10/14/26.";

afterEach(() => vi.unstubAllEnvs());

describe("\"Can you draw me up a CA for <name> …\" (CA_REQUEST_NOT_PRIOR_COACHING_ENABLED)", () => {
  it("off: read as before (a question; no Corrective Action asked for)", () => {
    expect(isQuestionNotForm(TESTER)).toBe(true);
    expect(detectTemplateIntent(TESTER)).not.toEqual({ kind: "corrective_action", requestedCreation: true });
  });

  it("on: the tester's message asks for a Corrective Action", () => {
    vi.stubEnv("CA_REQUEST_NOT_PRIOR_COACHING_ENABLED", "true");
    expect(isQuestionNotForm(TESTER)).toBe(false);
    expect(detectTemplateIntent(TESTER)).toEqual({ kind: "corrective_action", requestedCreation: true });
    expect(detectTemplateIntent("please draw up a corrective action for Wrenna Calloway")).toEqual({ kind: "corrective_action", requestedCreation: true });
  });

  it("on: a question about drawing one up is still a question", () => {
    vi.stubEnv("CA_REQUEST_NOT_PRIOR_COACHING_ENABLED", "true");
    expect(isQuestionNotForm("How do I draw up a CA for lateness?")).toBe(true);
    expect(detectTemplateIntent("How do I draw up a CA for lateness?")).not.toEqual({ kind: "corrective_action", requestedCreation: true });
  });
});
