import { afterEach, describe, expect, it, vi } from "vitest";

import { readCaPolicy } from "./ca-policy";
import { lateToReopen, saysFailureToOpen } from "./late-open";

// Ported from Ask Bubbles: QA's 17n live test (12 Nov 2026), the manager's words (the employee invented).
const SAID = "create a corrective action for Remy Calder, he was late to reoepn the salon on 11/9";

describe("REOPEN_IS_OPENING_ENABLED", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("off (production today): \"late to reoepn\" is no late opening (the bug)", () => {
    vi.stubEnv("REOPEN_IS_OPENING_ENABLED", "");
    expect(saysFailureToOpen(SAID)).toBe(false);
  });

  it.each([SAID, "he was late to reopen the salon on 11/9", "she was late to re-open the salon", "late to reopne"])("on: %s is a late opening", (text) => {
    vi.stubEnv("REOPEN_IS_OPENING_ENABLED", "true");
    expect(saysFailureToOpen(text)).toBe(true);
  });

  it.each(["he was late to report his hours", "she was late to return from break", "late to reply to the district manager", "late to restock the lotions"])(
    "on: %s is not a late opening",
    (text) => {
      vi.stubEnv("REOPEN_IS_OPENING_ENABLED", "true");
      expect(lateToReopen(text)).toBeNull();
    },
  );

  it("on: the card's policy reading is Late Opening", () => {
    // Gate-Sunny-2: off is stubbed first, so the check holds with the flag on in the environment.
    vi.stubEnv("REOPEN_IS_OPENING_ENABLED", "");
    expect(readCaPolicy(SAID).stated).not.toBe("late_opening");
    vi.stubEnv("REOPEN_IS_OPENING_ENABLED", "true");
    expect(readCaPolicy(SAID).stated).toBe("late_opening");
    expect(readCaPolicy("she was late to return from break").stated).not.toBe("late_opening");
  });
});
