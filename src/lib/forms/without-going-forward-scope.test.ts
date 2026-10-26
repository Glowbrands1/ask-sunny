import { describe, expect, it } from "vitest";

import { withoutGoingForward } from "./narrative-draft";

/**
 * DRAFT_NO_INVENTED_PLAN_ENABLED scope (coordinator ruling, 26 Oct 2026): only
 * a "Going Forward" the model wrote INSIDE an observation narrative
 * (Observation of Offense, Details of Coaching) is dropped. Every other field —
 * a dedicated follow-up field, the Action Plan the manager typed, any field
 * that is not an observed/expectation narrative — keeps what it was given,
 * even text that reads "Going Forward:". The route decides which forms run it.
 */
const FIELDS = [
  { key: "observation", narrative: "observed_expectation" },
  { key: "coaching_details", narrative: "observed_expectation" },
  { key: "next_follow_up" },
  { key: "action_plan", narrative: "plan_of_action" },
  { key: "expectation_going_forward" },
];

const NARRATIVE =
  "Observed:\nAva arrived 20 minutes late for her shift on 10/20.\n\nExpectation:\nEmployees are expected to arrive on time.\n\nGoing Forward:\nAva plans travel so she arrives early.";

describe("withoutGoingForward", () => {
  it("drops the Going Forward inside an observation narrative, keeps Observed and Expectation", () => {
    const out = withoutGoingForward({ observation: NARRATIVE, coaching_details: NARRATIVE }, FIELDS);
    for (const key of ["observation", "coaching_details"]) {
      expect(out[key]).not.toContain("Going Forward");
      expect(out[key]).toContain("Observed:\nAva arrived 20 minutes late for her shift on 10/20.");
      expect(out[key]).toContain("Expectation:\nEmployees are expected to arrive on time.");
    }
  });

  it("keeps every dedicated field, the Action Plan and any non-narrative field byte for byte", () => {
    const values = {
      next_follow_up: "Two weeks",
      action_plan: "Going Forward: arrive 10 minutes before every shift.",
      expectation_going_forward: "Going Forward:\nArrive 10 minutes early.",
    };
    expect(withoutGoingForward(values, FIELDS)).toEqual(values);
  });

  it("leaves a narrative with no Going Forward exactly as it was", () => {
    const plain = "Observed:\nAva arrived late.\n\nExpectation:\nArrive on time.";
    expect(withoutGoingForward({ observation: plain }, FIELDS).observation).toBe(plain);
  });

  it.each([
    ["all lowercase", (text: string) => text.toLowerCase()],
    ["ALL CAPS", (text: string) => text.toUpperCase()],
  ])("reads the section label however the model cased it (%s)", (_register, as) => {
    const out = withoutGoingForward({ observation: as(NARRATIVE) }, FIELDS).observation!;
    expect(out.toLowerCase()).not.toContain("going forward");
    expect(out.toLowerCase()).toContain("expectation:");
  });
});
