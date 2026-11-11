import { afterEach, describe, expect, it, vi } from "vitest";

import { detectTemplateIntent } from "./template-intent";

/**
 * CA_REQUEST_NOT_PRIOR_COACHING_ENABLED (QA's gate runner, 7 Nov 2026): requestedNaming asked detectTemplateIntent
 * about the words before each form naming, which asked requestedNaming again — once per earlier naming, so the work
 * doubled with every naming. A long coaching intake (~40 "coaching form" namings) never finished with the flag on.
 * Each prefix is now read once per call. The transcript below is invented.
 */
function longIntake(namings: number): string {
  const turns = ["Can you draw me up a CA for Wrenna Calloway for being late on 10/23/26."];
  for (let index = 0; index < namings; index += 1) {
    turns.push(`she signed a coaching form on ${(index % 28) + 1} October about being late.`);
  }
  return turns.join(" ");
}

describe("CA_REQUEST_NOT_PRIOR_COACHING_ENABLED: no exponential re-reading", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("a 45-naming intake is read in well under a second with the flag on, as with it off", () => {
    const text = longIntake(45);
    const offStart = performance.now();
    const off = detectTemplateIntent(text);
    const offMs = performance.now() - offStart;

    vi.stubEnv("CA_REQUEST_NOT_PRIOR_COACHING_ENABLED", "true");
    const onStart = performance.now();
    const on = detectTemplateIntent(text);
    const onMs = performance.now() - onStart;

    expect(onMs, `with the flag on it took ${Math.round(onMs)} ms (off: ${Math.round(offMs)} ms)`).toBeLessThan(1000);
    // The request is the CA: every coaching form after it is history (the s35 reading).
    expect(on.kind).toBe("corrective_action");
    expect(off.kind).not.toBe("corrective_action");
  }, 20_000);
});
