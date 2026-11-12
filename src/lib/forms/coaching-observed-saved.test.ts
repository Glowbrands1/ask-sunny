import { afterEach, describe, expect, it } from "vitest";

import { requestAccount, withCoachingObservedSaved } from "./coaching-observed-saved";

/*
 * COACHING_OBSERVED_SAVED_ENABLED. QA's P12 wording (10 Nov 2026), the person invented. The replay cases
 * `nov10-p12-coaching-observed-saved-*` run it through the chat and Create.
 */
const NOTES = "make me a coaching form for Brisa Talvenor not hitting October numbers";
const base = (details?: string) => ({
  values: details === undefined ? {} : { coaching_details: details },
  narrativeKeys: ["coaching_details"],
  coaching: true,
  notes: NOTES,
  employeeName: "Brisa Talvenor",
});

afterEach(() => {
  delete process.env.COACHING_OBSERVED_SAVED_ENABLED;
});

describe("the saved coaching Details", () => {
  it("read the account after the employee's name", () => {
    expect(requestAccount(NOTES, "Brisa Talvenor")).toBe("Not hitting October numbers.");
  });

  it("get an \"Observed:\" with the manager's words when blank or only an Expectation; off, as before", () => {
    expect(withCoachingObservedSaved(base())).toEqual({});
    process.env.COACHING_OBSERVED_SAVED_ENABLED = "true";
    expect(withCoachingObservedSaved(base()).coaching_details).toBe("Observed:\nNot hitting October numbers.");
    expect(withCoachingObservedSaved(base("Observed:\n\nExpectation:\nMeet the goal.")).coaching_details).toBe(
      "Observed:\nNot hitting October numbers.\n\nExpectation:\nMeet the goal.",
    );
  });

  it("put text with no heading under \"Observed:\", and leave an Observed with text as it is", () => {
    process.env.COACHING_OBSERVED_SAVED_ENABLED = "true";
    expect(withCoachingObservedSaved(base("Brisa did not hit October.")).coaching_details).toBe("Observed:\nBrisa did not hit October.");
    const whole = base("Observed:\nBrisa did not hit October.\nExpectation:\nMeet November.");
    expect(withCoachingObservedSaved(whole)).toBe(whole.values);
    expect(withCoachingObservedSaved({ ...base(), coaching: false })).toEqual({});
  });
});
