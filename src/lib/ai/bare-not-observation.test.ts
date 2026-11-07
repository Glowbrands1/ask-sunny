import { afterEach, describe, expect, it, vi } from "vitest";

import { onlyDeniesForObservation } from "./ca-what-happened";

/**
 * BARE_NOT_AFTER_REQUEST_ENABLED's Observation half (Coding's bisect, 7 Nov 2026): "ca for <A> not late" is no
 * Observation of Offense, so the live REPLY_MATCHES_CARD keeps the "what happened" ask. The person is invented.
 */
const NAME = "Rowan Kestrel";

function on() {
  vi.stubEnv("CA_SALES_POLICY_ENABLED", "true");
  vi.stubEnv("OMISSION_IS_ACCOUNT_ENABLED", "true");
  vi.stubEnv("BARE_NOT_DENIAL_ENABLED", "true");
  vi.stubEnv("BARE_NOT_AFTER_REQUEST_ENABLED", "true");
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("onlyDeniesForObservation", () => {
  it("off: false (as before)", () => {
    expect(onlyDeniesForObservation("ca for Rowan Kestrel not late", NAME)).toBe(false);
  });

  it.each(["ca for Rowan Kestrel not late", "Rowan Kestrel not late"])("on: %s says only what did not happen", (sentence) => {
    on();
    expect(onlyDeniesForObservation(sentence, NAME)).toBe(true);
  });

  it.each(["ca for Rowan Kestrel she was late on 11/2", "Rowan Kestrel not late but left the bed dirty", "Rowan Kestrel did not clean the beds"])(
    "on, negative: %s is an account",
    (sentence) => {
      on();
      expect(onlyDeniesForObservation(sentence, NAME)).toBe(false);
    },
  );
});

/**
 * The Sunny gate (7 Nov 2026), BARE_NOT_AFTER_REQUEST_ENABLED alone: an omission is an account, not a denial.
 * "did not complete her closing checklist", "cleaning duties not being completed" and "missed the monthly
 * meeting" lost their account because the flag read any negation as "nothing happened".
 */
describe("BARE_NOT_AFTER_REQUEST_ENABLED alone: omissions stay accounts", () => {
  it.each([
    "ca for Rowan Kestrel did not complete her closing checklist",
    "ca for Rowan Kestrel cleaning duties not being completed",
    "ca for Rowan Kestrel missed the monthly meeting",
    "Rowan Kestrel did not clean the beds",
  ])("%s is an account", (sentence) => {
    vi.stubEnv("BARE_NOT_AFTER_REQUEST_ENABLED", "true");
    expect(onlyDeniesForObservation(sentence, NAME)).toBe(false);
  });

  it.each(["ca for Rowan Kestrel not late", "Rowan Kestrel never late", "ca for Rowan Kestrel no problems"])("%s only denies", (sentence) => {
    vi.stubEnv("BARE_NOT_AFTER_REQUEST_ENABLED", "true");
    expect(onlyDeniesForObservation(sentence, NAME)).toBe(true);
  });
});
