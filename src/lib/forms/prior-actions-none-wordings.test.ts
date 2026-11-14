import { afterEach, describe, expect, it, vi } from "vitest";

import { groundPriorActions } from "./prior-actions";

/*
 * PRIOR_ACTIONS_NONE_WORDINGS (ported from the sibling app: Gate-Bubbles-3's #888 follow-up, QA 14 Nov 2026): a drafted "N/A" or "No prior
 * corrective action" got through with PRIOR_ACTIONS_UNSAID_BLANK on. Invented wording.
 */
afterEach(() => vi.unstubAllEnvs());

const TODAY = "2026-11-14";
const UNSAID = "ca for ilsa varnholt at kearney, she was late on 11/3/26";
const DRAFTED = ["N/A", "n/a", "NA", "Not applicable", "No prior corrective action", "No previous coaching", "No prior write-ups"];
const on = (wide: boolean) => {
  vi.stubEnv("PRIOR_ACTIONS_UNSAID_BLANK_ENABLED", "true");
  vi.stubEnv("PRIOR_ACTIONS_NONE_WORDINGS_ENABLED", wide ? "true" : "");
};

describe("PRIOR_ACTIONS_NONE_WORDINGS", () => {
  it("off: a drafted N/A or \"No prior corrective action\" is kept (the gap)", () => {
    on(false);
    // The gate's two wordings (some others, e.g. "No previous coaching", an existing reader already drops).
    for (const drafted of ["N/A", "No prior corrective action"]) expect(groundPriorActions({ drafted, notes: UNSAID, today: TODAY }).value, drafted).toBe(drafted);
  });

  it("on: every way of drafting \"none\" stays blank when the manager said nothing about history", () => {
    on(true);
    for (const drafted of DRAFTED) expect(groundPriorActions({ drafted, notes: UNSAID, today: TODAY }).value, drafted).toBe("");
  });

  it("on: a stated first occurrence, and a history given, are untouched", () => {
    on(true);
    expect(groundPriorActions({ drafted: "No prior corrective action", notes: `${UNSAID}. first time, no prior corrective action`, today: TODAY }).value).not.toBe("");
    expect(groundPriorActions({ drafted: "Verbal warning — 10/20/2026", notes: `${UNSAID}. i gave her a verbal warning on 10/20/26`, today: TODAY }).value).toMatch(/Verbal warning/);
    // "Nancy" or "Nathan" in a history is not "NA".
    expect(groundPriorActions({ drafted: "Nancy coached her on 10/20/2026", notes: `${UNSAID}. nancy coached her on 10/20/26`, today: TODAY }).value).toMatch(/Nancy/);
  });
});
