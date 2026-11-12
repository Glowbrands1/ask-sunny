import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * FORM_NAME_FROM_ROSTER SHIPS ONLY WITH ITS EIGHT COMPANIONS (QA, 7 Nov 2026).
 *
 * With production's flags + FORM_NAME alone, a full name typed close to one roster person ("create a ca form for
 * Delphine Marlwoe Ostrander") left the card with no employee: the reply said "I'll draft a Corrective Action Form
 * from what you've described …" and asked who only at its very end, and the close roster person was never offered
 * (replay `nov7-form-name-empty-card-*`). With the five companions on too, as in the sibling app's flip 3, it asks
 * "Is this for **<roster name>**?" and the next card is for them. QA's ruling: FORM_NAME only ships with all of them (these five, and
 * NEAR_MISS_DETAILS_ACCEPT, NEAR_MISS_QUESTION_RULES and FORM_NAME_OFF_ROSTER_ASK below), in both apps; this test fails if `src/config/production-flags.json` ever lists it on without them.
 */
const FORM_NAME = "FORM_NAME_FROM_ROSTER_ENABLED";
const FORM_NAME_COMPANIONS = [
  "ROSTER_NEAR_MISS_ENABLED",
  "ROSTER_NAME_IN_CANDIDATE_ENABLED",
  "ROSTER_COMPOUND_SURNAME_ENABLED",
  "ROSTER_NOT_FOUND_ANY_PHRASING_ENABLED",
  "OFF_ROSTER_CONFIRM_ENABLED",
  // QA, 7 Nov 2026: the sixth. Without it a near-miss is asked twice (the sibling's gate), and Create refuses the card
  // as "out of date: … for <typed name>" (gate runner 2, nov7-refusal-bub-name-redo); `forms/near-miss-answer.ts`.
  "NEAR_MISS_DETAILS_ACCEPT_ENABLED",
  // QA, 8 Nov 2026 (the Sunny round-4 gate): the seventh. Without it "no, …" to "Is this for <name>?" still gets a card
  // for that name, and a card or form on screen is replaced by the bare question; `forms/near-miss-question-rules.ts`.
  "NEAR_MISS_QUESTION_RULES_ENABLED",
  // QA, 10 Nov 2026 (the Sunny roster-set gate): the eighth. Without it a letter's off-roster person is never offered,
  // a salon manager gets the not-found note under an empty card instead of OFF_ROSTER_ASK's question, and a possessive
  // place is said back as a name not found; `forms/off-roster-ask.ts`, `forms/roster-only-names.ts`.
  "FORM_NAME_OFF_ROSTER_ASK_ENABLED",
] as const;

/** The companions missing from a production where FORM_NAME is on; none when it is off. */
function missingCompanions(on: ReadonlySet<string>): string[] {
  return on.has(FORM_NAME) ? FORM_NAME_COMPANIONS.filter((name) => !on.has(name)) : [];
}

describe("FORM_NAME_FROM_ROSTER ships only with its eight companions", () => {
  it("src/config/production-flags.json: FORM_NAME is off, or on with all eight", () => {
    const production = JSON.parse(readFileSync("src/config/production-flags.json", "utf8")) as { on?: string[]; assumedOn?: string[] };
    const on = new Set([...(production.on ?? []), ...(production.assumedOn ?? [])]);
    expect(missingCompanions(on), `${FORM_NAME} is on in production without its companions`).toEqual([]);
  });

  it("the rule: FORM_NAME alone, or with seven of the eight, fails; off, or with all eight, passes", () => {
    expect(missingCompanions(new Set([FORM_NAME]))).toEqual([...FORM_NAME_COMPANIONS]);
    expect(missingCompanions(new Set([FORM_NAME, ...FORM_NAME_COMPANIONS.slice(1)]))).toEqual([FORM_NAME_COMPANIONS[0]]);
    expect(missingCompanions(new Set(FORM_NAME_COMPANIONS))).toEqual([]);
    expect(missingCompanions(new Set([FORM_NAME, ...FORM_NAME_COMPANIONS]))).toEqual([]);
  });
});
