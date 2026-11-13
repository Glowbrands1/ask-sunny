import { afterEach, describe, expect, it, vi } from "vitest";

import { readCaPolicy } from "./ca-policy";

/**
 * SHIFT_ABSENCE_WIDER_ENABLED (QA's ruling (a) on CA_NO_POLICY_ASKS_WHICH, 13 Nov 2026). The managers' words from the
 * replay pack's sf-s38 and term-CA cases (people invented): both made a card with no Policy line.
 */
const WEEKEND = "make me an CA for Remy Calder missing her saturday and sunday shifts due to wanting to go home for the weekend but failed to communicate proporley";
const CALL_IN = "I need a term CA for Marnie Holloway because she didn't call in.";

afterEach(() => vi.unstubAllEnvs());

describe("SHIFT_ABSENCE_WIDER_ENABLED", () => {
  it("off (production today): neither is read as a policy", () => {
    vi.stubEnv("MISSED_SHIFT_CITES_ATTENDANCE_ENABLED", "true");
    vi.stubEnv("SHIFT_ABSENCE_WIDER_ENABLED", "");
    expect(readCaPolicy(WEEKEND).readFromApp ?? null).toBeNull();
    expect(readCaPolicy(CALL_IN).readFromApp ?? null).toBeNull();
  });

  it.each([WEEKEND, CALL_IN, "she did not call in sick on 11/2", "he skipped two of his scheduled weekend shifts"])("on: %s is Attendance", (said) => {
    vi.stubEnv("MISSED_SHIFT_CITES_ATTENDANCE_ENABLED", "true");
    vi.stubEnv("SHIFT_ABSENCE_WIDER_ENABLED", "true");
    expect(readCaPolicy(said).readFromApp).toBe("attendance");
  });

  it.each([
    "she didn't call in the order to the vendor",
    "she was missing her name tag during the shift",
    "create a CA for Remy Calder, she was rude to a guest",
  ])("on: %s is not read as a missed shift", (said) => {
    vi.stubEnv("MISSED_SHIFT_CITES_ATTENDANCE_ENABLED", "true");
    vi.stubEnv("SHIFT_ABSENCE_WIDER_ENABLED", "true");
    expect(readCaPolicy(said).readFromApp ?? null).not.toBe("attendance");
  });
});
