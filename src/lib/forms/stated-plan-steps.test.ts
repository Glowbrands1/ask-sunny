import { describe, expect, it } from "vitest";

import { keptPlanSteps, withPlanSteps } from "./stated-plan-steps";

/* Pau via QA (20 Nov 2026, f062); the tester's invented "Test Testy" is Remy Calder here. */
const SAID = "I want this documented as a written corrective action and the opening procedures reviewed with Remy Calder this week.";
const PLAN = "Management will review the Late Opening policy with Remy. Future policy violations may result in additional corrective action up to and including termination of employment.";

describe("keptPlanSteps", () => {
  it("keeps a step whose words the manager said, tidied as a sentence", () => {
    expect(keptPlanSteps(["review the opening procedures with Remy Calder this week"], SAID)).toEqual(["Review the opening procedures with Remy Calder this week."]);
  });
  it("never keeps a step the manager did not state", () => {
    expect(keptPlanSteps(["schedule a follow-up meeting in two weeks"], SAID)).toEqual([]);
    expect(keptPlanSteps(["review"], SAID)).toEqual([]);
    expect(keptPlanSteps("review the opening procedures", SAID)).toEqual([]);
  });
});

describe("withPlanSteps", () => {
  it("adds the step before the closing, with the first name, the rest byte for byte", () => {
    expect(withPlanSteps(PLAN, ["Review the opening procedures with Remy Calder this week."], "Remy Calder")).toBe(
      "Management will review the Late Opening policy with Remy. Review the opening procedures with Remy this week. Future policy violations may result in additional corrective action up to and including termination of employment.",
    );
  });
  it("puts the step before a termination closing too", () => {
    const termination = "Management will review the Late Opening policy with Remy. Effective immediately, employment is terminated following the progressive corrective action plan.";
    expect(withPlanSteps(termination, ["Return the salon keys today."], "Remy Calder")).toBe(
      "Management will review the Late Opening policy with Remy. Return the salon keys today. Effective immediately, employment is terminated following the progressive corrective action plan.",
    );
  });
  it("with no step, or a step already in the plan, returns the plan byte-identical", () => {
    expect(withPlanSteps(PLAN, [], "Remy Calder")).toBe(PLAN);
    expect(withPlanSteps(PLAN, null)).toBe(PLAN);
    expect(withPlanSteps(PLAN, ["Management will review the Late Opening policy with Remy."], "Remy Calder")).toBe(PLAN);
  });
});
