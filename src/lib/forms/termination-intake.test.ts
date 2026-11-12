import { afterEach, describe, expect, it, vi } from "vitest";

import { detectTemplateIntent } from "./template-intent";

/* TERMINATION_INTAKE_ENABLED (ported from the sibling app; QA, 12 Nov 2026). The reporters' wording; invented people. */
const BARE = "Termination CA for Calla Brisbane, no call no show.";
const LETTER = "Dear Calla Brisbane, Your employment with Sun Tan City is terminated effective 11/10/26.";

afterEach(() => vi.unstubAllEnvs());

describe("TERMINATION_INTAKE_ENABLED", () => {
  it("off: as before — the letter names no form", () => {
    vi.stubEnv("TERMINATION_INTAKE_ENABLED", "false");
    expect(detectTemplateIntent(LETTER)).toEqual({ kind: "none" });
  });

  it("on: \"Termination CA for <A>, …\" asks for the Corrective Action Form", () => {
    vi.stubEnv("TERMINATION_INTAKE_ENABLED", "true");
    expect(detectTemplateIntent(BARE)).toMatchObject({ kind: "corrective_action", requestedCreation: true });
    expect(detectTemplateIntent("term CA for Calla Brisbane - did not show")).toMatchObject({ kind: "corrective_action", requestedCreation: true });
  });

  it("on: a pasted termination letter asks for the Resignation/Exit Form", () => {
    vi.stubEnv("TERMINATION_INTAKE_ENABLED", "true");
    expect(detectTemplateIntent(LETTER)).toEqual({ kind: "explicit", templateKey: "stc-exit" });
    expect(detectTemplateIntent("Dear Calla, your employment has been terminated as of 11/10/26. Please return your key.")).toEqual({
      kind: "explicit",
      templateKey: "stc-exit",
    });
  });

  it.each([
    "what's the termination policy?",
    "should Calla be terminated?",
    "is your employment terminated if you miss two shifts?",
    "termination CA policy for no call no show",
  ])("on, still not a request: %s", (said) => {
    vi.stubEnv("TERMINATION_INTAKE_ENABLED", "true");
    const intent = detectTemplateIntent(said);
    expect(intent.kind === "explicit" || (intent.kind === "corrective_action" && intent.requestedCreation)).toBe(false);
  });
});
