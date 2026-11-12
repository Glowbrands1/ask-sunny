import { afterEach, describe, expect, it } from "vitest";

import { statesTermination } from "./termination-stated";

/* TERMINATION_STATED_TICKS_ENABLED. P15's wording verbatim (invented name). The replay cases run the route. */
const P15 = "I need a term CA for Briony Halvorsen. Didn't show up for her opening shift. Payroll deduction.";

describe("TERMINATION_STATED_TICKS_ENABLED", () => {
  afterEach(() => {
    delete process.env.TERMINATION_STATED_TICKS_ENABLED;
  });

  it("off: nothing is stated", () => {
    // Off pins its own flag (QA's off-pins guard, 11 Nov 2026): it must hold once production turns the flag on.
    delete process.env.TERMINATION_STATED_TICKS_ENABLED;
    expect(statesTermination(P15)).toBe(false);
  });

  it.each([
    P15,
    "termination CA for Briony Halvorsen, no call no show",
    "write up for termination",
    "we are going to terminate her today.",
    "She is being terminated.",
    "Warning level: termination",
    "Termination.",
  ])("on, stated: %s", (said) => {
    process.env.TERMINATION_STATED_TICKS_ENABLED = "true";
    expect(statesTermination(said)).toBe(true);
  });

  it.each([
    "she might be terminated if this continues",
    "Future policy violations may result in additional corrective action up to and including termination of employment.",
    "next time it's termination",
    "this could lead to termination",
    "should we terminate her?",
    "she was terminated last year and rehired",
    "I need a verbal CA for being late to opening",
    "I need a written warning for her term paper excuse",
  ])("on, not stated: %s", (said) => {
    process.env.TERMINATION_STATED_TICKS_ENABLED = "true";
    expect(statesTermination(said)).toBe(false);
  });
});

/*
 * The protected files, edited with Pau's written approval (10 Nov 2026, "ok termination closing"): identical with the
 * flag off; on, a plan ending with the termination sentence is closed, and a Termination plan closes with it.
 */
import { correctiveActionPlan } from "./ca-action-plan";
import { CA_ACTION_PLAN_CLOSING, TERMINATION_PLAN_CLOSING, withRequiredClosing } from "./required-closing";
import { withTerminationPlan } from "./termination-stated";

describe("TERMINATION_STATED_TICKS_ENABLED: the Action Plan's closing", () => {
  const terminated = `Management will review the Attendance policy with Briony. ${TERMINATION_PLAN_CLOSING}`;
  const input = { citedPolicies: ["Attendance"], employeeName: "Briony Halvorsen", payroll: { answer: null, amount: null }, termination: true };

  afterEach(() => {
    delete process.env.TERMINATION_STATED_TICKS_ENABLED;
  });

  it("off: the required closing is appended as before, and a Termination plan warns of future violations", () => {
    expect(withRequiredClosing(terminated, CA_ACTION_PLAN_CLOSING)).toBe(`${terminated} ${CA_ACTION_PLAN_CLOSING}`);
    expect(correctiveActionPlan(input).endsWith(CA_ACTION_PLAN_CLOSING)).toBe(true);
    expect(withTerminationPlan(`x. ${CA_ACTION_PLAN_CLOSING}`, true)).toBe(`x. ${CA_ACTION_PLAN_CLOSING}`);
  });

  it("on: a plan ending with the termination sentence is closed", () => {
    process.env.TERMINATION_STATED_TICKS_ENABLED = "true";
    expect(withRequiredClosing(terminated, CA_ACTION_PLAN_CLOSING)).toBe(terminated);
    expect(withRequiredClosing("Management will review the Attendance policy with Briony.", CA_ACTION_PLAN_CLOSING)).toBe(
      `Management will review the Attendance policy with Briony. ${CA_ACTION_PLAN_CLOSING}`,
    );
  });

  it("on: a Termination plan closes with the termination sentence; any other plan is unchanged", () => {
    process.env.TERMINATION_STATED_TICKS_ENABLED = "true";
    expect(correctiveActionPlan(input)).toBe(terminated);
    expect(correctiveActionPlan({ ...input, termination: false }).endsWith(CA_ACTION_PLAN_CLOSING)).toBe(true);
    expect(withTerminationPlan(`Management will review the Attendance policy with Briony. ${CA_ACTION_PLAN_CLOSING}`, true)).toBe(terminated);
    expect(withTerminationPlan(`x. ${CA_ACTION_PLAN_CLOSING}`, false)).toBe(`x. ${CA_ACTION_PLAN_CLOSING}`);
  });
});
