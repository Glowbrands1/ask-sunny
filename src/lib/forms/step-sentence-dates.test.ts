import { afterEach, describe, expect, it } from "vitest";

import { statedFormDate } from "./incident-dates";
import { stepSentenceDates } from "./step-sentence-dates";

/** STEP_DATE_NOT_INCIDENT_ENABLED (QA SF4, 27 Oct 2026). The chat path: `step-sentence-date-e2e.test.ts`. */
const FLAG = "STEP_DATE_NOT_INCIDENT_ENABLED";
const LIVE = "PRIOR_SENTENCE_FIX_ENABLED";
const TODAY = "2026-10-27";
const SF4 = [
  { role: "user", content: "create a CA form for rory vance, tan consultant at manhattan, for opening salon late on 9-28-26" },
  { role: "user", content: "this should be a written and note a verbal ca was given on 9-1-26" },
];

afterEach(() => {
  delete process.env[FLAG];
  delete process.env[LIVE];
});

describe(FLAG, () => {
  it("on: a step's date is held back, two late days are not", () => {
    process.env[FLAG] = "true";
    expect([...stepSentenceDates("note a verbal ca was given on 9-1-26", TODAY)]).toEqual(["2026-09-01"]);
    expect([...stepSentenceDates("she was late on 9-28-26 and 10-1-26", TODAY)]).toEqual([]);
  });

  it("on: the form takes the one incident date", () => {
    process.env[FLAG] = "true";
    process.env[LIVE] = "true";
    expect(statedFormDate(SF4, TODAY)?.iso).toBe("2026-09-28");
  });

  it("off: as main, the two dates are asked about", () => {
    process.env[LIVE] = "true";
    expect(stepSentenceDates("note a verbal ca was given on 9-1-26", TODAY).size).toBe(0);
    expect(statedFormDate(SF4, TODAY)?.candidates).toEqual(["2026-09-01", "2026-09-28"]);
  });
});
