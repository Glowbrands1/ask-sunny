import { afterEach, describe, expect, it, vi } from "vitest";

import { isNotAName } from "./not-a-name";

/**
 * ACCOUNT_VERB_NOT_A_NAME_ENABLED (QA round 5, sf-s38, 8 Nov 2026; the employee invented): "make me CA for <first name>
 * failing to complete shifts" made the card for "<First> Failing". The replay pack covers the route
 * (`nov8-account-verb-not-a-name-cases.ts`).
 */
afterEach(() => vi.unstubAllEnvs());

function guard() {
  vi.stubEnv("NOT_A_NAME_GUARD_ENABLED", "true");
}

describe("ACCOUNT_VERB_NOT_A_NAME_ENABLED", () => {
  it("off: \"Rhea Failing\" reads as a name (the reported card)", () => {
    guard();
    expect(isNotAName("Rhea Failing")).toBe(false);
  });

  it.each(["Rhea Failing", "rhea missing", "Rhea not", "Rhea being", "Rhea Calloway failing"])("on: %j is not a name", (candidate) => {
    guard();
    vi.stubEnv("ACCOUNT_VERB_NOT_A_NAME_ENABLED", "true");
    expect(isNotAName(candidate)).toBe(true);
  });

  it.each(["Rhea Calloway", "Marnie Holloway", "Juno Paxton"])("on, negative: %j is still a name", (candidate) => {
    guard();
    vi.stubEnv("ACCOUNT_VERB_NOT_A_NAME_ENABLED", "true");
    expect(isNotAName(candidate)).toBe(false);
  });
});
