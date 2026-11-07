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
