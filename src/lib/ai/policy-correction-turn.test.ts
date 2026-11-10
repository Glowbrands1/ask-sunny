import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isPolicyCorrection } from "./policy-correction-turn";

// POLICY_CORRECTION_NOT_ACCOUNT_ENABLED (QA's Sunny round-5 live tester, 8 Nov 2026, item 3).
beforeEach(() => vi.stubEnv("POLICY_CORRECTION_NOT_ACCOUNT_ENABLED", "true"));
afterEach(() => vi.unstubAllEnvs());

describe("isPolicyCorrection", () => {
  it("off: false", () => {
    vi.stubEnv("POLICY_CORRECTION_NOT_ACCOUNT_ENABLED", "");
    expect(isPolicyCorrection("it should be under performance not standard of conduct")).toBe(false);
  });

  it.each([
    "it should be under performance not standard of conduct",
    "It should be under performance, not standards of conduct.",
    "this needs to be attendance not standards of conduct",
    "the policy should be dress code instead of conduct",
    "it's under performance not conduct",
    "wrong policy",
    "that's the wrong policy",
  ])("%s → a correction of the policy", (sentence) => {
    expect(isPolicyCorrection(sentence)).toBe(true);
  });

  it.each([
    "She had 24 tans and was below in PPTA, LPSVA, Avg Club, CC%, and Spa%",
    "her drawer should be counted with a manager, not alone",
    "she should be on time not 30 minutes late",
    "the register should be closed by 9 not left open",
    "it should be a written warning not a verbal",
  ])("%s → not a policy correction", (sentence) => {
    expect(isPolicyCorrection(sentence)).toBe(false);
  });
});
