import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { readCaPolicy } from "./ca-policy";

/**
 * MISSED_SHIFT_CITES_ATTENDANCE_ENABLED, ported from the sibling app (QA's round-7 live test there, 9 Nov 2026), in
 * QA's wording (the person invented): "create a CA for <A>, not showing up to her shifts on 11/7 and 11/8" read as no policy.
 */
const FLAG = "MISSED_SHIFT_CITES_ATTENDANCE_ENABLED";
const REPORTED = "create a CA for Marnie Holloway, not showing up to her shifts on 11/7 and 11/8";

beforeEach(() => vi.stubEnv(FLAG, "true"));
afterEach(() => vi.unstubAllEnvs());

describe("a shift not shown up to reads as Attendance", () => {
  it("off: no policy (the bug)", () => {
    vi.stubEnv(FLAG, "");
    expect(readCaPolicy(REPORTED).readFromApp).toBeUndefined();
  });

  it.each([
    REPORTED,
    "Make me a CA for Marnie Holloway not showing up to her shifts on 11/7 and 11/8",
    "make me CA for marnie failing to complete shifts",
    "she missed her shifts on 11/7 and 11/8",
    "she didn't come in for her scheduled shift on 11/7",
    "skipped two shifts this week",
  ])("on: %s", (said) => {
    expect(readCaPolicy(said).readFromApp).toBe("attendance");
  });

  it("on: a policy the manager names wins, and an account with no shift is untouched", () => {
    expect(readCaPolicy("she missed her shift on 11/7, cite the dress code policy").readFromApp).toBeUndefined();
    expect(readCaPolicy("create a CA for Marnie Holloway, she was rude to a guest").readFromApp).toBeUndefined();
  });
});
