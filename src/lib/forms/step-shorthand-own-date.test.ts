import { afterEach, describe, expect, it } from "vitest";

import { stepSentenceDates } from "./step-sentence-dates";

/**
 * STEP_SHORTHAND_OWN_DATE_ENABLED (ported from Ask Bubbles: QA's prod-env reading there, 10 Nov 2026, D2). The manager's words, as in
 * `corrective-action-dm-feedback-e2e.test.ts` (round 3; the person invented): one sentence with no full stop. With
 * production's flags the shorthand "coaching 7/1" set aside every date in it, 10/13/26 (the incident) included.
 */
const SAID = "Remy Calder - CA - written - no call no show to manager meeting 10/13/26 - payroll deduction no - prior coaching 7/1/26";
const TODAY = "2026-10-25";
const FLAGS = ["STEP_DATE_NOT_INCIDENT_ENABLED", "CA_SHORTCUT_WORDS_ENABLED", "STEP_SHORTHAND_OWN_DATE_ENABLED"];

function withFlags(own: boolean): void {
  process.env.STEP_DATE_NOT_INCIDENT_ENABLED = "true";
  process.env.CA_SHORTCUT_WORDS_ENABLED = "true";
  if (own) process.env.STEP_SHORTHAND_OWN_DATE_ENABLED = "true";
  else delete process.env.STEP_SHORTHAND_OWN_DATE_ENABLED;
}

afterEach(() => {
  for (const flag of FLAGS) delete process.env[flag];
});

describe("STEP_SHORTHAND_OWN_DATE: the shorthand sets aside only its own date", () => {
  it("flag off (as production today, the defect): the incident's 10/13/26 is set aside with the coaching's 7/1/26", () => {
    withFlags(false);
    expect([...stepSentenceDates(SAID, TODAY)].sort()).toEqual(["2026-07-01", "2026-10-13"]);
  });

  it("flag on: only the coaching's 7/1/26 is a step's date", () => {
    withFlags(true);
    expect([...stepSentenceDates(SAID, TODAY)]).toEqual(["2026-07-01"]);
  });

  for (const own of [false, true]) {
    it(`NEVER-BREAK (flag ${own ? "on" : "off"}): a sentence that says a step was given keeps every date it names`, () => {
      withFlags(own);
      expect([...stepSentenceDates("a verbal was given on 9-1-26 and a written on 9-15-26.", TODAY)].sort()).toEqual(["2026-09-01", "2026-09-15"]);
    });

    it(`NEVER-BREAK (flag ${own ? "on" : "off"}): "verbal 10/1, written 10/5" are both steps' dates`, () => {
      withFlags(own);
      expect([...stepSentenceDates("prior verbal 10/1 written 10/5", TODAY)].sort()).toEqual(["2026-10-01", "2026-10-05"]);
    });
  }
});
