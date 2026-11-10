import { afterEach, describe, expect, it, vi } from "vitest";

import { groundPriorActions, statedPriorActions } from "./prior-actions";

/**
 * PRIOR_STEP_DATE_LIST_ENABLED (ported from the sibling app: QA round 5, Bubbles live 7 Nov 2026; the employee invented). "she already received a
 * verbal warning and coaching on 9/8/2026, 9/15/2026 and 9/25/2026" listed only "Coaching — 09/08/2026". QA's ruling
 * (8 Nov 2026): the verbal warning with no date, and a Coaching row for each date, since the manager tied no date to
 * the verbal. The replay pack covers the route (`nov8-prior-step-date-list-cases.ts`).
 */
const SAID =
  "hi, i need a performance corrective action for tamsin vale, a tanning consultant. she is under performance for september. she already received a verbal warning and coaching on 9/8/2026, 9/15/2026 and 9/25/2026. no payroll deduction applies. today's date is fine.";
const TODAY = "2026-11-07";
/** The production flags these readers read (`production-flags.json`). */
const PRODUCTION = ["PRIOR_STEP_SENTENCE_ENABLED", "PRIOR_ACTIONS_PARSE_ENABLED", "PRIOR_STEP_PREVIOUSLY_ENABLED", "PRIOR_ROW_NOT_ON_INCIDENT_DATE_ENABLED"];

function production(...extra: string[]) {
  for (const flag of [...PRODUCTION, ...extra]) vi.stubEnv(flag, "true");
}

describe("PRIOR_STEP_DATE_LIST_ENABLED", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("off: only the first date's Coaching is listed (the reported reply)", () => {
    production();
    expect(statedPriorActions(SAID, TODAY)).toEqual(["Coaching — 09/08/2026"]);
  });

  it("on: the verbal warning with no date, and a Coaching row for each date", () => {
    production("PRIOR_STEP_DATE_LIST_ENABLED");
    expect(statedPriorActions(SAID, TODAY)).toEqual(["Coaching — 09/08/2026", "Coaching — 09/15/2026", "Coaching — 09/25/2026", "Verbal warning"]);
  });

  it("on: the draft's Prior actions get the same rows, oldest first, the undated one last", () => {
    production("PRIOR_STEP_DATE_LIST_ENABLED");
    const { value } = groundPriorActions({ drafted: "Coaching — 09/08/2026", notes: SAID, today: TODAY });
    expect(value.split("\n")).toEqual(["Coaching — 09/08/2026", "Coaching — 09/15/2026", "Coaching — 09/25/2026", "Verbal warning"]);
  });

  it("on: one step, one date, as before", () => {
    production("PRIOR_STEP_DATE_LIST_ENABLED");
    const one = "create a corrective action for tamsin vale, she was late on 10/20/2026. she already received a verbal warning on 9/8/2026.";
    vi.stubEnv("PRIOR_STEP_DATE_LIST_ENABLED", "");
    const before = statedPriorActions(one, TODAY);
    vi.stubEnv("PRIOR_STEP_DATE_LIST_ENABLED", "true");
    expect(statedPriorActions(one, TODAY)).toEqual(before);
  });

  it("on: dates that are not one list after the step are not read as the step's (\"on 9/8/2026, she was late on 10/20/2026\")", () => {
    production("PRIOR_STEP_DATE_LIST_ENABLED");
    const lines = statedPriorActions("she received a verbal warning on 9/8/2026, and she was late again on 10/20/2026.", TODAY);
    expect(lines.join("\n")).not.toMatch(/10\/20\/2026/);
  });

  it("on: an incident told with several dates and no given-step is no Prior actions row", () => {
    production("PRIOR_STEP_DATE_LIST_ENABLED");
    expect(statedPriorActions("create a corrective action for tamsin vale, she was late on 10/2/2026, 10/9/2026 and 10/16/2026.", TODAY)).toEqual([]);
  });
});
