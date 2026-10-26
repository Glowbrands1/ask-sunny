import { describe, expect, it } from "vitest";

import { managerTypedGoingForward, withoutGoingForward } from "./narrative-draft";

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

/*
 * QA-5, 26 Oct 2026: the negation must govern "going forward" itself. A
 * negation earlier in the sentence about something else leaves the manager's
 * plan typed. Lowercase and sentence case.
 */
const REGISTERS: [string, (text: string) => string][] = [
  ["all lowercase", (text) => text.toLowerCase()],
  ["sentence case", (text) => text.charAt(0).toUpperCase() + text.slice(1).toLowerCase()],
  ["ALL CAPS", (text) => text.toUpperCase()],
];

describe.each(REGISTERS)("managerTypedGoingForward (%s)", (_register, as) => {
  it("a negation about something else does not undo the plan", () => {
    for (const notes of [
      "No call no show on 10/11 going forward she needs to call",
      "She is not happy with the schedule and going forward will arrive early",
      "She wasn't on time going forward I expect on time",
      "She was never told going forward she must call",
    ]) {
      expect(managerTypedGoingForward(as(notes)), notes).toBe(true);
    }
  });

  it("a negated going forward is no plan", () => {
    for (const notes of [
      "no going forward needed",
      "do not add a going forward section",
      "without a going forward plan",
      "not going forward with discipline",
      "she doesn't want going forward plan",
      "she is not on a plan going forward",
      // QA-5, 26 Oct 2026.
      "she isn't going forward with it",
      "no need for a going forward",
    ]) {
      expect(managerTypedGoingForward(as(notes)), notes).toBe(false);
    }
  });
});
