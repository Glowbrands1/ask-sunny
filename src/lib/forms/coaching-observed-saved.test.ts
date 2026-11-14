import { afterEach, describe, expect, it, vi } from "vitest";

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

/* COACHING_OBSERVED_HEADING_KEPT (the sibling's R678, QA 14 Nov 2026). The person is invented. */
describe("COACHING_OBSERVED_HEADING_KEPT_ENABLED", () => {
  afterEach(() => vi.unstubAllEnvs());
  const run = (value: string, on: boolean, saved?: Record<string, string>) => {
    vi.stubEnv("COACHING_OBSERVED_SAVED_ENABLED", "true");
    vi.stubEnv("COACHING_OBSERVED_HEADING_KEPT_ENABLED", on ? "true" : "");
    return withCoachingObservedSaved({
      values: { coaching_details: value },
      narrativeKeys: ["coaching_details"],
      coaching: true,
      notes: "I need a coaching form for Odalys Penwarden, she left the register drawer open",
      employeeName: "Odalys Penwarden",
      ...(saved ? { saved } : {}),
    }).coaching_details;
  };
  const BOLD = [
    "**Observed:** Odalys Penwarden left the register drawer open.",
    "**Observed:**\nOdalys Penwarden left the register drawer open.",
    "Observed - Odalys Penwarden left the register drawer open.",
    "**Observed** - Odalys Penwarden left the register drawer open.",
  ];
  it.each(BOLD)("off: as production, %j gets a second \"Observed:\"", (value) => {
    expect(run(value, false)).toBe(`Observed:\n${value}`);
  });
  it.each(BOLD)("on: a bold or dash heading is a heading: %j is kept", (value) => {
    expect(run(value, true)).toBe(value);
  });
  it("on: the form's saved Details never get a heading", () => {
    const saved = "Odalys Penwarden left the register drawer open on 10/15/26. We reviewed the cash handling policy.";
    expect(run(saved, true, { coaching_details: saved })).toBe(saved);
  });
  it("on: Details drafted this turn still get it", () => {
    const drafted = "Odalys Penwarden left the register drawer open.";
    expect(run(drafted, true, { coaching_details: "" })).toBe(`Observed:\n${drafted}`);
  });
});

