import { afterEach, describe, expect, it } from "vitest";

import { missedMeetingNotLateness } from "./attendance-action-plan";

/**
 * ATTENDANCE_PLAN_NEEDS_LATENESS_ENABLED (ported from Ask Bubbles: QA's ruling, 11 Nov 2026). The wording is
 * `corrective-action-dm-feedback-e2e.test.ts`'s B1 (the person invented there); the control is QA's.
 * `missedMeetingNotLateness` true means the general plan, not Pau's lateness plan.
 */
const FLAG = "ATTENDANCE_PLAN_NEEDS_LATENESS_ENABLED";
const B1 = "create ca form for tess varga for violating attendance policy on 10-20-26. verbal. no payroll deduct. jba manual 1-1-26 for previous coaching";
const LATE = "create ca form for tess varga, she was late on 10/20/26. verbal. no payroll deduct.";

afterEach(() => {
  delete process.env[FLAG];
});

describe("ATTENDANCE_PLAN_NEEDS_LATENESS", () => {
  it("flag off (as production today): B1 gets Pau's lateness plan", () => {
    expect(missedMeetingNotLateness(B1)).toBe(false);
  });

  it("flag on: B1 states no lateness, so it keeps the general plan", () => {
    process.env[FLAG] = "true";
    expect(missedMeetingNotLateness(B1)).toBe(true);
  });

  for (const on of [false, true]) {
    it(`control (flag ${on ? "on" : "off"}): "she was late on 10/20/26" keeps Pau's plan`, () => {
      if (on) process.env[FLAG] = "true";
      expect(missedMeetingNotLateness(LATE)).toBe(false);
      expect(missedMeetingNotLateness("tess was tardy twice this week")).toBe(false);
      expect(missedMeetingNotLateness("she clocked in 20 minutes after her shift started")).toBe(false);
    });
  }
});
