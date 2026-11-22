import { describe, expect, it } from "vitest";

import { accountWithoutPriorSteps, listedWithKeptSteps, sharesContentWord } from "./tools";

/* Port of Ask Bubbles #1054 (its QA's live round 3, 22 Nov 2026, U21): the tester's turns; the people are invented. */
const STEPS = "Coaching — 09/22/2026 (cleaning tasks not being completed); Policy acknowledgement — 05/26/2026";

describe("sharesContentWord (U21): content words, ignoring case and simple endings", () => {
  it("plural, past and -ing/-ment endings are the same word", () => {
    expect(sharesContentWord("JBA Woven policies were acknowledged on 5/26/26.", "Policy acknowledgement — 05/26/2026")).toBe(true);
    expect(sharesContentWord("She received COACHING on 9/22", "Coaching — 09/22/2026")).toBe(true);
  });
  it("short words and dates are not content words", () => {
    expect(sharesContentWord("she was on 9/22 at the salon", "Coaching — 09/22/2026 (was at)")).toBe(false);
  });
});

describe("accountWithoutPriorSteps (U21)", () => {
  it("a prior step written as a sentence leaves the account; the incident stays", () => {
    const account = "Ilsabet received coaching on 9/22 for cleaning tasks not being completed. This weekend, the beds were not wiped down between guests, and the towels were not restocked. JBA Woven policies were acknowledged on 5/26/26.";
    expect(accountWithoutPriorSteps(account, STEPS, null)).toBe("This weekend, the beds were not wiped down between guests, and the towels were not restocked.");
  });
  it("U09's parenthesis still leaves", () => {
    expect(accountWithoutPriorSteps("On 11/1/26 Corisande violated care and cleaning of facilities policy (JBA Policy Manual 1/1/2026).", "JBA Policy Manual — 01/01/2026", "2026-11-01")).toBe("On 11/1/26 Corisande violated care and cleaning of facilities policy.");
  });
  it("control: a sentence about THIS incident on a step's date stays", () => {
    const account = "On 9/22 Ilsabet skipped her cleaning tasks again after the coaching. The towels were not restocked.";
    expect(accountWithoutPriorSteps(account, STEPS, "2026-09-22")).toBe(account);
  });
  it("control: a dated sentence that shares no word with any step stays", () => {
    const account = "On 9/22 a guest complained about the lobby. The towels were not restocked.";
    expect(accountWithoutPriorSteps(account, STEPS, null)).toBe(account);
  });
  it("the account is never emptied", () => {
    const account = "Ilsabet received coaching on 9/22 for cleaning tasks.";
    expect(accountWithoutPriorSteps(account, STEPS, null)).toBe(account);
  });
});

/* Port of Ask Bubbles #1054 (its QA's live triage, U09): the model kept only the Verbal CA; the manual's step went into the Observation. */
describe("listedWithKeptSteps (U09)", () => {
  const T2 = "JBA Policy Manual 1-1-2026, Verbal CA 11-1-2026. On 11-1-26 Corisande violated care and cleaning of facilities policy";
  it("a step listed with one the card keeps is a step too", () => {
    expect(listedWithKeptSteps(T2, "Verbal CA — 11/01/2026", "2026-11-01", "2026-11-22")).toEqual(["JBA Policy Manual — 01/01/2026"]);
  });
  it("nothing when the card keeps no step of that sentence, or already holds the listed one", () => {
    expect(listedWithKeptSteps(T2, "Coaching — 09/22/2026", "2026-11-01", "2026-11-22")).toEqual([]);
    expect(listedWithKeptSteps(T2, "JBA Policy Manual — 01/01/2026; Verbal CA — 11/01/2026", "2026-11-01", "2026-11-22")).toEqual([]);
  });
  it("control: a clause on this incident's date, or one that goes on after its date, is no step", () => {
    expect(listedWithKeptSteps("Verbal CA 10-1-2026, late again 11-1-2026", "Verbal CA — 10/01/2026", "2026-11-01", "2026-11-22")).toEqual([]);
    expect(listedWithKeptSteps("Verbal CA 10-1-2026, on 10-20-2026 she was late and left early", "Verbal CA — 10/01/2026", "2026-11-01", "2026-11-22")).toEqual([]);
  });
  it("the account then loses the listed step", () => {
    expect(accountWithoutPriorSteps("JBA Policy Manual 1/1/2026. On 11/1/26, Corisande violated the care and cleaning of facilities policy.", "Verbal CA — 11/01/2026; JBA Policy Manual — 01/01/2026", "2026-11-01")).toBe("On 11/1/26, Corisande violated the care and cleaning of facilities policy.");
  });
});

describe("accountWithoutPriorSteps: a list of steps (U09, live)", () => {
  const STEPS_U09 = "Verbal CA - 11/1/2026; JBA Policy Manual — 01/01/2026";
  it("a sentence that only lists the card's steps leaves, though one is dated on the incident's day", () => {
    expect(accountWithoutPriorSteps("JBA Policy Manual 1/1/2026, Verbal CA 11/1/2026. On 11/1/26, Corisande violated the care and cleaning of facilities policy.", STEPS_U09, "2026-11-01")).toBe("On 11/1/26, Corisande violated the care and cleaning of facilities policy.");
  });
  it("control: a list with a clause that is no step stays", () => {
    const account = "JBA Policy Manual 1/1/2026, late again 11/1/2026. Corisande violated the care and cleaning of facilities policy.";
    expect(accountWithoutPriorSteps(account, STEPS_U09, "2026-11-01")).toBe(account);
  });
});
