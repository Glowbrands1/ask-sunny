import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { groundPriorActions, statedPriorActions } from "./prior-actions";

/*
 * PRIOR_STEP_SENTENCE_ENABLED. Managers, 26 Oct 2026 (Ask Sunny production),
 * word for word, names invented: an earlier step told in a sentence listed no
 * Prior actions row. Production flags on; lowercase and Sentence case.
 */
const TODAY = "2026-10-26";
const P3 = [
  "create a CA form for avery holt, tan consultant at manhattan, for opening salon late on 9-28-26",
  "this should be a written and note a verbal ca was given on 9-1-26",
];
const MA = [
  "i need to issue a ca for someone being late",
  "rory vance was late on 10/20 and the salon was opened late",
  "she was issued a verbal ca on 10.1 for this same thing",
  "yes payrol ldeduct",
];
const sentence = (turn: string) => turn.replace(/^([a-z])/, (letter) => letter.toUpperCase());

const FLAG = "PRIOR_STEP_SENTENCE_ENABLED";
const LIVE = ["PRIOR_ACTIONS_PARSE_ENABLED", "PRIOR_SENTENCE_FIX_ENABLED", "PRIOR_ROW_NOT_ON_INCIDENT_DATE_ENABLED"];
const saved = new Map<string, string | undefined>();
beforeEach(() => {
  for (const name of [...LIVE, FLAG]) saved.set(name, process.env[name]);
  for (const name of LIVE) process.env[name] = "true";
  delete process.env[FLAG];
});
afterEach(() => {
  for (const [name, value] of saved) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe(`${FLAG} on`, () => {
  beforeEach(() => {
    process.env[FLAG] = "true";
  });

  it.each([
    ["lowercase", P3],
    ["Sentence case", P3.map(sentence)],
  ])('%s: "note a verbal ca was given on 9-1-26" is a row', (_casing, turns) => {
    expect(statedPriorActions(turns.join("\n\n"), TODAY)).toEqual(["Verbal corrective action — 09/01/2026"]);
  });

  it.each([
    ["lowercase", MA],
    ["Sentence case", MA.map(sentence)],
  ])('%s: "issued a verbal ca on 10.1" is a row dated 10/01 of this year', (_casing, turns) => {
    expect(statedPriorActions(turns.join("\n\n"), TODAY)).toEqual(["Verbal corrective action — 10/01/2026"]);
  });

  it("the drafted list gains the row the draft left out", () => {
    const { value, added } = groundPriorActions({ drafted: "", notes: P3.join("\n\n"), today: TODAY, onFile: [] });
    expect(added).toEqual(["Verbal corrective action — 09/01/2026"]);
    expect(value).toContain("Verbal corrective action — 09/01/2026");
  });

  it.each([
    ["the incident is not a step", "rory vance was late on 10/20 and the salon was opened late"],
    ["an amount is not a date", "she was given a verbal and payroll deduct $3.25"],
    ["a step with no date adds nothing", "she was given a verbal before"],
    ["a dot date after today is last year's", "she was issued a verbal on 11.5"],
  ])("%s", (_name, turn) => {
    const rows = statedPriorActions(turn, TODAY);
    if (/11\.5/.test(turn)) expect(rows).toEqual(["Verbal warning — 11/05/2025"]);
    else expect(rows).toEqual([]);
  });
});

describe(`${FLAG} off: as main`, () => {
  it.each([[P3], [MA]])("no row", (turns) => {
    expect(statedPriorActions(turns.join("\n\n"), TODAY)).toEqual([]);
  });

  it("the flag reads off by default", async () => {
    const { priorStepSentenceEnabled } = await import("@/lib/config/chat-quality-flags");
    expect(priorStepSentenceEnabled()).toBe(false);
  });
});
