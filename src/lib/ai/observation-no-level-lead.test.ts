import { afterEach, describe, expect, it, vi } from "vitest";

import { managerAccount } from "./remap-incident";

/**
 * OBSERVATION_NO_LEVEL_LEAD_ENABLED (the flip-3 tester's D, in this app; QA 6–7 Nov 2026): the warning level is
 * the Type of Warning, never the start of the account. The manager's words; the person is the pack's invented
 * Remy Calder.
 */
const NAME = "Remy Calder";
const SAID = "create a CA for remy calder, verbal, she was late on 10-20-26";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("OBSERVATION_NO_LEVEL_LEAD_ENABLED", () => {
  it("off: the level leads the account (the finding)", () => {
    expect(managerAccount(SAID, NAME)).toMatch(/^verbal, she was late on 10-20-26/i);
  });

  it.each([
    [SAID, "she was late on 10-20-26"],
    ["create a CA for Remy Calder, written warning, she was late on 10-20-26", "she was late on 10-20-26"],
    ["create a CA for Remy Calder, final written, she was late on 10-20-26", "she was late on 10-20-26"],
  ])("on: %s → %s", (said, account) => {
    vi.stubEnv("OBSERVATION_NO_LEVEL_LEAD_ENABLED", "true");
    expect(managerAccount(said, NAME)).toBe(account);
  });

  it.each([
    "create a CA for Remy Calder, she was late on 10-20-26 after a verbal warning",
    "create a CA for Remy Calder, she was written up by the closer, she was late on 10-20-26",
  ])("on, negative: %s is unchanged by the flag", (said) => {
    const off = managerAccount(said, NAME);
    vi.stubEnv("OBSERVATION_NO_LEVEL_LEAD_ENABLED", "true");
    expect(managerAccount(said, NAME)).toBe(off);
    expect(off).toMatch(/late on 10-20-26/);
  });
});
