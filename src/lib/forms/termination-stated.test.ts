import { afterEach, describe, expect, it } from "vitest";

import { statesTermination } from "./termination-stated";

/* TERMINATION_STATED_TICKS_ENABLED. P15's wording verbatim (invented name). The replay cases run the route. */
const P15 = "I need a term CA for Briony Halvorsen. Didn't show up for her opening shift. Payroll deduction.";

describe("TERMINATION_STATED_TICKS_ENABLED", () => {
  afterEach(() => {
    delete process.env.TERMINATION_STATED_TICKS_ENABLED;
  });

  it("off: nothing is stated", () => {
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
