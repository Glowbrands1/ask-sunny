import { afterEach, describe, expect, it, vi } from "vitest";

import { createRequestWithReason, readSentenceEdit } from "./edit-date-rules";

/** REQUEST_ISSUE_KEPT_ENABLED (ported from Ask Bubbles; QA's live round 17b, P16). People invented. */
afterEach(() => vi.unstubAllEnvs());

describe("\"Can you make a CA for <name> for <reason>?\" is the request and its account", () => {
  const P16 = "Can you make a CA for Corisande Pell for failure to open on time?";

  it("on: not an instruction", () => {
    vi.stubEnv("REQUEST_ISSUE_KEPT_ENABLED", "true");
    expect(createRequestWithReason(P16)).toBe(true);
    expect(readSentenceEdit(P16)).toBeNull();
  });

  it.each(["Can you make a CA for Corisande Pell?", "can you change the date to 10/5?", "Can you fix the grammar for me?"])(
    "on: still an instruction — %s",
    (said) => {
      vi.stubEnv("REQUEST_ISSUE_KEPT_ENABLED", "true");
      expect(createRequestWithReason(said)).toBe(false);
      expect(readSentenceEdit(said)).not.toBeNull();
    },
  );

  it("off: as before, an instruction", () => {
    vi.stubEnv("REQUEST_ISSUE_KEPT_ENABLED", "false");
    expect(readSentenceEdit(P16)).toEqual({ kind: "instruction" });
  });
});
