import { afterEach, describe, expect, it, vi } from "vitest";

import { priorStepsWithCommas, statedPriorActions } from "./prior-actions";

/* October triage #5 (Sunny #255, the sibling app's #187), the table's wording with an invented employee. */
const VERBAL_WRITTEN = "prior coaching verbal 6/25 written 7/28 no deduct";
const COACHING_RUN = "perf ca tamsin oakridge 270 units below goal upt atv verbal prior coachings 9/8 9/15 9/25 no deduct";
const TODAY = "2026-10-26";

describe("PRIOR_ACTIONS_NO_COMMA_ENABLED", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("off: the typed words are read as before", () => {
    vi.stubEnv("PRIOR_ACTIONS_NO_COMMA_ENABLED", "false");
    vi.stubEnv("PRIOR_ACTIONS_PARSE_ENABLED", "true");
    expect(statedPriorActions(VERBAL_WRITTEN, TODAY)).toContain("Written warning — verbal 6/25 — 07/28/2026");
  });

  it("on: a step after a date is its own row", () => {
    vi.stubEnv("PRIOR_ACTIONS_NO_COMMA_ENABLED", "true");
    vi.stubEnv("PRIOR_ACTIONS_PARSE_ENABLED", "true");
    expect(statedPriorActions(VERBAL_WRITTEN, TODAY)).toEqual(["Verbal warning — 06/25/2026", "Written warning — 07/28/2026"]);
  });

  it("on: a step followed by a run of dates is a row per date", () => {
    vi.stubEnv("PRIOR_ACTIONS_NO_COMMA_ENABLED", "true");
    vi.stubEnv("PRIOR_ACTIONS_PARSE_ENABLED", "true");
    expect(statedPriorActions(COACHING_RUN, TODAY)).toEqual(["Coaching — 09/08/2026", "Coaching — 09/15/2026", "Coaching — 09/25/2026"]);
  });

  it("only adds what was missing", () => {
    expect(priorStepsWithCommas("verbal 6/25, written 7/28")).toBe("verbal 6/25, written 7/28");
    expect(priorStepsWithCommas("she had a verbal on 6/25/26 and a written 7/28/26")).toBe("she had a verbal on 6/25/26 and a written 7/28/26");
    expect(priorStepsWithCommas("late 10/20 and 10/21 coached her 10/22")).toBe("late 10/20 and 10/21 coached her 10/22");
    expect(priorStepsWithCommas("verbal 6/25 written 7/28")).toBe("verbal 6/25, written 7/28");
  });
});
