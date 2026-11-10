import { afterEach, describe, expect, it, vi } from "vitest";

import { missedMeetingNotLateness } from "./attendance-action-plan";

/** MISSED_SHIFT_NOT_LATENESS_ENABLED (QA's Sunny live Create test, round 5, 8 Nov 2026; sf-s38's words, invented people). */
const T1 = "make me an CA for Rhea Calloway missing her saturday and sunday shifts due to wanting to go home for the weekend but failed to communicate proporley";

afterEach(() => vi.unstubAllEnvs());

describe("MISSED_SHIFT_NOT_LATENESS", () => {
  it("off: a missed shift keeps the lateness plan (the report)", () => {
    expect(missedMeetingNotLateness(T1)).toBe(false);
  });

  it.each([
    T1,
    "Rhea did not show up for her shift on 11/2",
    "no call no show on saturday",
    "she was a no-show for her sunday shift",
    "she called out of her shift without finding a cover",
    "she missed work on 11/2 and did not tell anyone",
  ])("on: %s — not lateness", (account) => {
    vi.stubEnv("MISSED_SHIFT_NOT_LATENESS_ENABLED", "true");
    expect(missedMeetingNotLateness(account)).toBe(true);
  });

  it.each([
    "she was 30 minutes late to her shift on 11/2",
    "she missed the start of her shift and clocked in at 10:15",
    "she arrived late and then missed her break",
    "she was rude to a client at the front desk",
  ])("on, negative: %s — keeps the attendance plan", (account) => {
    vi.stubEnv("MISSED_SHIFT_NOT_LATENESS_ENABLED", "true");
    expect(missedMeetingNotLateness(account)).toBe(false);
  });
});
