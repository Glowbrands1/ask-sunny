import { afterEach, describe, expect, it, vi } from "vitest";

import { conductLineWithoutUnderPerformance, leaveOutOtherWriteInLine, leaveOutUnderPerformanceLine } from "./stale-prompt-lines";

/* QA, 5 Nov 2026 (item 8): the version's own fields and options decide, never wording. */
const REVISION_7 = ["attendance_policy", "standards_of_conduct", "dress_code", "other"];
const REVISION_6 = ["tardiness", "absenteeism", "standards_of_conduct", "under_performance", "dress_code", "violation_of_company_policies", "other"];

afterEach(() => vi.unstubAllEnvs());
const on = () => vi.stubEnv("STALE_PROMPT_LINES_OFF_ENABLED", "true");

describe("STALE_PROMPT_LINES_OFF_ENABLED", () => {
  it("off: nothing is left out", () => {
    vi.stubEnv("STALE_PROMPT_LINES_OFF_ENABLED", "");
    expect(leaveOutOtherWriteInLine([{ label: "Observation of Offense" }])).toBe(false);
    expect(leaveOutUnderPerformanceLine(REVISION_7)).toBe(false);
  });

  it("on: a version with no field labelled Other has no write-in; one with it keeps the line", () => {
    on();
    expect(leaveOutOtherWriteInLine([{ label: "Observation of Offense" }, { label: "Action Plan" }])).toBe(true);
    expect(leaveOutOtherWriteInLine([{ label: "Observation of Offense" }, { label: "Other" }])).toBe(false);
  });

  it("on: a version with no under_performance box leaves the sentence out; revision 6 keeps it", () => {
    on();
    expect(leaveOutUnderPerformanceLine(REVISION_7)).toBe(true);
    expect(leaveOutUnderPerformanceLine(REVISION_6)).toBe(false);
  });

  it("the conduct sentence is the original line's first sentence, unchanged", () => {
    expect(conductLineWithoutUnderPerformance("standards_of_conduct")).toBe(
      "Type of Offense: assigned work, a required deadline, or required Woven items or training not completed, and a manager's direction not followed, are standards_of_conduct.",
    );
  });
});
