import { afterEach, describe, expect, it, vi } from "vitest";

import { statedPriorActions } from "./prior-actions";

/**
 * PRIOR_STEP_PREVIOUSLY_ENABLED (A2, one of Pau's 7; QA 6 Nov 2026): the manager's exact words; the person is
 * the pack's invented Marnie Holloway. PRIOR_STEP_SENTENCE and PRIOR_ACTIONS_PARSE are live in production.
 */
const SAID = "in the previously recieved coaching include that marnie holloway signed the jba policy manual on 10-15-26";
const TODAY = "2026-11-06";

function live() {
  vi.stubEnv("PRIOR_STEP_SENTENCE_ENABLED", "true");
  vi.stubEnv("PRIOR_ACTIONS_PARSE_ENABLED", "true");
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("PRIOR_STEP_PREVIOUSLY_ENABLED", () => {
  it("off (production): the dated coaching is not read (the finding)", () => {
    live();
    expect(statedPriorActions(SAID, TODAY)).toEqual([]);
  });

  it("on: the coaching, the manual and the signed date", () => {
    live();
    vi.stubEnv("PRIOR_STEP_PREVIOUSLY_ENABLED", "true");
    expect(statedPriorActions(SAID, TODAY)).toEqual(["Coaching — JBA Policy Manual — signed 10/15/2026"]);
  });

  it.each([
    ["prior coaching on 10-1-26", ["Coaching — 10/01/2026"]],
    ["she had an earlier verbal warning 9-20-26", ["Verbal warning — 09/20/2026"]],
  ])("on: %s", (said, lines) => {
    live();
    vi.stubEnv("PRIOR_STEP_PREVIOUSLY_ENABLED", "true");
    expect(statedPriorActions(said, TODAY)).toEqual(lines);
  });

  it.each([
    "she previously worked the register on 10-15-26",
    "she needs coaching on the closing checklist by 10-15-26",
  ])("on, negative: %s lists no earlier step", (said) => {
    live();
    vi.stubEnv("PRIOR_STEP_PREVIOUSLY_ENABLED", "true");
    expect(statedPriorActions(said, TODAY)).toEqual([]);
  });
});
