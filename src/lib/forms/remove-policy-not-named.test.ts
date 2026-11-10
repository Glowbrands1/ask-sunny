import { afterEach, describe, expect, it, vi } from "vitest";

import { readCaPolicy } from "./ca-policy";

/**
 * REMOVE_POLICY_NOT_NAMED_ENABLED (A1, QA 6 Nov 2026; the flip-3 tester): "take the attendance policy off the
 * form" got "Policy: Attendance, as you said". The tester's exact words, and the other ways to take one off.
 */
afterEach(() => {
  vi.unstubAllEnvs();
});

function live() {
  vi.stubEnv("FORM_EDIT_DATE_RULES_ENABLED", "true");
}

describe("REMOVE_POLICY_NOT_NAMED_ENABLED", () => {
  it("off: \"take the attendance policy off the form\" names Attendance (the finding)", () => {
    live();
    expect(readCaPolicy("take the attendance policy off the form").stated).toBe("attendance");
  });

  it.each(["take the attendance policy off the form", "get the attendance policy off this", "pull attendance out", "drop the attendance policy"])(
    "on: %s names no policy",
    (said) => {
      live();
      vi.stubEnv("REMOVE_POLICY_NOT_NAMED_ENABLED", "true");
      expect(readCaPolicy(said).stated).toBeNull();
    },
  );

  it.each([
    ["add the attendance policy", "attendance"],
    ["take the attendance policy off and use the dress code policy", "dress_code"],
    ["it should be the attendance policy", "attendance"],
  ])("on, negative: %s names %s", (said, name) => {
    live();
    vi.stubEnv("REMOVE_POLICY_NOT_NAMED_ENABLED", "true");
    expect(readCaPolicy(said).stated).toBe(name);
  });
});
