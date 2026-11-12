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
    "we are going to terminate her today.",
    "She is being terminated.",
    // Gate-Sunny's correctly ticking cases (12 Nov 2026), which the safe-by-design rule keeps (invented names).
    "I need a term CA for Briony Halvorsen.",
    "Termination CA for Briony Halvorsen, no call no show.",
    "Terminate her.",
    "She is being terminated for job abandonment.",
    "We are terminating her, she never showed.",
    "I need a termination form for her, she did not show up.",
    "Terminate Briony.",
    // QA's optional P15 phrasings (12 Nov 2026): the incident clause is skipped for negations only.
    "Term CA for Briony Halvorsen because she didn't call in.",
    "Term CA for Briony Halvorsen, didn't show for her shift.",
    "She didn't show up, so I need a term CA.",
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
    // Gate-Bubbles' NO-GO (R798, 12 Nov 2026): negated, about a later form, or "long term" — never a Termination tick.
    "Do not terminate her, she was late again.",
    "This is not a term CA, just a written.",
    "We are not terminating him",
    "Not a termination warning, a verbal.",
    "no termination form needed",
    "Next one is a term CA.",
    "long term CA plan",
    "I need a CA for Briony Halvorsen, do not terminate her. Didn't show up for her opening shift.",
    "a written instead of a termination",
    "if it happens again it's a term CA",
    "Termination is not needed here.",
    // Gate-Sunny's code read (12 Nov 2026).
    "don't terminate him",
    "we're not terminating her",
    "she is not being terminated",
    "not a term CA",
    "no termination",
    // Gate-Sunny's probe of c10df533 (12 Nov 2026): every one ticked before the safe-by-design rule.
    "We shouldn't terminate her.",
    "I wouldn't terminate him.",
    "We couldn't terminate her yet.",
    "I don't want to make this a term CA.",
    "Write her up rather than a term CA.",
    "Hold off on terminating her.",
    "We decided against terminating her.",
    // Changed on purpose (QA, 12 Nov 2026): only the positive statements tick; these once ticked and now leave the
    // level for the manager to pick on the form.
    "write up for termination",
    "Warning level: termination",
    "Termination.",
    // A negation outside the incident clause, or a hedge anywhere, still wins.
    "Termination CA for Briony Halvorsen, not really.",
    "Terminate her, she might come back though.",
    "We are terminating her, she is not being terminated.",
    // Gate-Bubbles' probe of 869135a8 (12 Nov 2026).
    "We shouldn't terminate him",
    "I wouldn't terminate her yet",
    "We couldn't terminate him over this",
    "Make it a written rather than a term CA",
    "We'll hold off on terminating her",
    "We decided against terminating him",
    // Gate-Sunny's hedge probe of af924094 (12 Nov 2026).
    "Probably a term CA.",
    "I think we need a term CA for her.",
    "Term CA for her, pending HR.",
    "Ask HR whether to terminate her.",
    "Check with my DM about a term CA.",
    "Likely a term CA.",
    "Perhaps terminate her.",
    "I guess we terminate her.",
    "I believe it's a term CA.",
    "Seems like a term CA.",
    "Sounds like a term CA to me.",
    "Term CA once HR signs off.",
    // The incident skip never lets a negation through that is not an incident.
    "Term CA for Briony Halvorsen, wasn't sure.",
    "Terminate her, didn't decide yet.",
    "Because she didn't show, not a term CA.",
    "She didn't show up, so no term CA.",
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
