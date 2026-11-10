import { afterEach, beforeEach, describe, expect, it } from "vitest";

import productionFlags from "@/config/production-flags.json";
import { decideFormDate } from "@/lib/forms/incident-dates";

import { formDateByRules } from "./edit-date-rules";

/**
 * INCIDENT_DATE_SHARED_WITH_STEP_ENABLED (ported from Ask Bubbles: QA's prod-env reading there, 10 Nov 2026, D3). With production's flags
 * (FORM_EDIT_DATE_RULES on), "verbal for ava pellmore, gave her a verbal on 10-21 for being late on 10-21" and "ca for
 * ava pellmore, she was late on 10-21 and i gave her a verbal on 10-21" kept no incident date: every date that is also a
 * step's was set aside, even when the same day is the incident's. The wording is the NEVER-BREAK rows' in
 * `forms/form-date-incident-only.test.ts` (the person invented).
 */
const TODAY = "2026-10-25";
const FLAG = "INCIDENT_DATE_SHARED_WITH_STEP_ENABLED";

function withFlag(on: boolean): void {
  if (on) process.env[FLAG] = "true";
  else delete process.env[FLAG];
}

function dateOf(said: string, current: string | null = "2026-10-21"): string | null | undefined {
  return formDateByRules({ managerTurns: [said], question: said, today: TODAY, current });
}

const SHARED = [
  "verbal for ava pellmore, gave her a verbal on 10-21 for being late on 10-21",
  "ca for ava pellmore, she was late on 10-21 and i gave her a verbal on 10-21",
  "write up ava pellmore, i gave her a verbal on 10-21 for being late",
];

/*
 * NEVER-BREAK: where no incident cue governs the step's date, the flag changes nothing. ("previous coaching … for being
 * late" is history, not the incident.)
 */
const GUARDS = [
  "ca for ava pellmore, she was late on 10-24. previous coaching on 10-21 for being late",
  "ca for ava pellmore, late on 10-24. prior verbal on 10-21 for being late",
  "ca for ava pellmore, she was late on 10-24. jba manual 10-21",
  "write up ava pellmore, late on 10-24, i coached her on 10-21",
];

describe("INCIDENT_DATE_SHARED_WITH_STEP: the day a step was given can be the incident's day", () => {
  beforeEach(() => withFlag(false));
  afterEach(() => withFlag(false));

  for (const said of SHARED) {
    it(`flag off (as before): "${said}" sets the incident date aside`, () => {
      expect(dateOf(said)).toBeNull();
    });

    it(`flag on: "${said}" keeps 10-21`, () => {
      withFlag(true);
      // undefined: the card's own date (2026-10-21) stays.
      expect(dateOf(said)).toBeUndefined();
      // With no date on the card yet, an incident cue before the date ("late on 10-21") supplies it.
      if (/late on 10-21/.test(said)) expect(dateOf(said, null)).toBe("2026-10-21");
    });
  }

  for (const said of GUARDS) {
    it(`NEVER-BREAK: "${said}" reads the same with the flag on and off`, () => {
      const off = [dateOf(said, "2026-10-21"), dateOf(said, "2026-10-24"), dateOf(said, null)];
      withFlag(true);
      const on = [dateOf(said, "2026-10-21"), dateOf(said, "2026-10-24"), dateOf(said, null)];
      expect(on).toEqual(off);
    });
  }
});

/*
 * The card's path in production (FORM_FULL_REMAP is off): `decideFormDate`, with production's flags on (CORRECTED_DATE_KEPT
 * sets aside every prior step's date).
 */
describe("INCIDENT_DATE_SHARED_WITH_STEP: the card's Date (decideFormDate)", () => {
  const decide = (text: string) =>
    decideFormDate({ text, templateKey: "dpoa", history: [], conversation: [{ role: "user", content: text }], today: TODAY });
  // Production's flags, as the replay pack reads them.
  const CARD_FLAGS = (productionFlags as { on: string[] }).on;
  beforeEach(() => {
    for (const name of CARD_FLAGS) process.env[name] = "true";
  });
  afterEach(() => {
    for (const name of CARD_FLAGS) delete process.env[name];
    withFlag(false);
  });

  for (const said of SHARED) {
    it(`flag off (as production today): "${said}" gives the card no 10-21`, () => {
      expect(decide(said).formDate ?? null).not.toBe("2026-10-21");
    });
    it(`flag on: "${said}" dates the card 10-21`, () => {
      withFlag(true);
      expect(decide(said).formDate).toBe("2026-10-21");
    });
  }

  for (const said of GUARDS) {
    it(`NEVER-BREAK: "${said}" decides the same with the flag on and off`, () => {
      const off = decide(said);
      withFlag(true);
      expect(decide(said)).toEqual(off);
    });
  }
});
