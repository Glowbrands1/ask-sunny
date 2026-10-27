import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { groundPriorActions } from "./prior-actions";

/*
 * FUTURE_PRIOR_ROW_DROP_ENABLED. QA LS-B11 in the sibling app, 26 Oct 2026, a
 * real manager chat word for word, the name and place invented: "previous coaching jba manual 11-1-26"
 * (a future date) corrected next turn to "jba manual 11-1-25". The draft
 * listed both "Coaching — JBA Policy Manual — 11/01/2025" and "Coaching —
 * signed 11/01/2026". Production flags on; lowercase and Sentence case.
 */
const TODAY = "2026-10-26";
const TURNS = [
  "do verbal for team member ivy hollis at lawrence. payroll deduct does not apply. previous coaching jba manual 11-1-26. on 10-22-26 ivy was not scheduled to work and came into the salon to show her team her new puppy. ivy was in the salon 45 min",
  "jba manual 11-1-25",
  "cite pets in workplace",
  "cite animals in the workplace policy",
  "salon location is lawrence. create corrective action",
];
const sentence = (turn: string) => turn.replace(/^([a-z])/, (letter) => letter.toUpperCase()).replace(/\bivy hollis\b/g, "Ivy Hollis");
const DRAFTED = "Coaching — JBA Policy Manual — 11/01/2025\nCoaching — signed 11/01/2026";

const FLAG = "FUTURE_PRIOR_ROW_DROP_ENABLED";
const LIVE = ["PRIOR_ACTIONS_PARSE_ENABLED", "PRIOR_SENTENCE_FIX_ENABLED", "PRIOR_ROW_NOT_ON_INCIDENT_DATE_ENABLED", "DATE_ANSWER_APPLIED_ENABLED"];
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
  it.each([
    ["lowercase", TURNS],
    ["Sentence case", TURNS.map(sentence)],
  ])("%s: only the corrected row stays", (_casing, turns) => {
    process.env[FLAG] = "true";
    const { value, removed } = groundPriorActions({ drafted: DRAFTED, notes: turns.join("\n\n"), today: TODAY, onFile: [] });
    expect(value).toBe("Coaching — JBA Policy Manual — 11/01/2025");
    expect(removed).toEqual(["Coaching — signed 11/01/2026"]);
  });

  it("a row dated today or before is kept", () => {
    process.env[FLAG] = "true";
    const { value } = groundPriorActions({ drafted: "Verbal warning — 10/01/2026", notes: "prior verbal 10-1-26", today: TODAY, onFile: [] });
    expect(value).toBe("Verbal warning — 10/01/2026");
  });
});

describe(`${FLAG} off: as main`, () => {
  it("both rows stay", () => {
    expect(groundPriorActions({ drafted: DRAFTED, notes: TURNS.join("\n\n"), today: TODAY, onFile: [] }).value).toBe(DRAFTED);
  });

  it("the flag reads off by default", async () => {
    const { futurePriorRowDropEnabled } = await import("@/lib/config/chat-quality-flags");
    expect(futurePriorRowDropEnabled()).toBe(false);
  });
});
