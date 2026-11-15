import { afterEach, describe, expect, it, vi } from "vitest";

import { canonicalFormWording } from "./template-intent";

/** QA, 15 Nov 2026: "create a termination for <A>, …" gave a policy answer and no card. Invented names. */
describe("TERMINATION_REQUEST_IS_CA_ENABLED", () => {
  afterEach(() => vi.unstubAllEnvs());

  it.each([
    ["create a termination for Marnie Holloway, she no call no showed", "create a termination corrective action for Marnie Holloway, she no call no showed"],
    ["make termination for marnie holloway", "make termination corrective action for marnie holloway"],
    ["I need to do a termination for Marnie", "I need to do a termination corrective action for Marnie"],
  ])("on: %s", (said, read) => {
    vi.stubEnv("TERMINATION_REQUEST_IS_CA_ENABLED", "true");
    expect(canonicalFormWording(said)).toBe(read);
  });

  it.each([
    ["create termination paperwork for Marnie Holloway"],
    ["create a termination form for Marnie Holloway"],
    ["what is the termination policy for no call no shows"],
    ["termination for Marnie Holloway"],
    // QA's review of #1014: a question, or no person after "for", is never the request.
    ["how do i do a termination for Marnie Holloway?"],
    ["Do I need a termination for Marnie Holloway or just a written?"],
    ["should I do a termination for Marnie Holloway"],
    ["what do I need to do a termination for Marnie Holloway"],
    ["do we need a termination for job abandonment"],
    ["create a termination for no call no show"],
    ["create a termination for her"],
  ])("on, unchanged: %s", (said) => {
    vi.stubEnv("TERMINATION_REQUEST_IS_CA_ENABLED", "true");
    expect(canonicalFormWording(said)).toBe(said);
  });

  it("off: unchanged", () => {
    expect(canonicalFormWording("create a termination for Marnie Holloway")).toBe("create a termination for Marnie Holloway");
  });
});
