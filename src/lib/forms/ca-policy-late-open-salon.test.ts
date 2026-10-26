import { afterEach, describe, expect, it, vi } from "vitest";

import { JOIN } from "./bounded-context";
import { namesCaPolicy, readCaPolicy, type CaPolicyReading } from "./ca-policy";

/**
 * ============================================================================
 * "OPEN (THE) SALON LATE" IS LATE OPENING, AND NOTHING MORE (QA-6, PR #223)
 * ============================================================================
 *
 * PR #223 lets the policy reader read "opening salon late" and "opened the
 * salon late" as the Late Opening policy, under LATE_OPEN_DATE_ENABLED (on in
 * production). QA-6 found two sentences that reading named Late Opening
 * although neither is a late-opening offense alone:
 *
 *   "opening the salon late was approved by the manager" — an approved late
 *   opening is not an offense;
 *   "she opened the location late and also left early" — two clauses, and
 *   leaving early is the Attendance section's (the sibling app's own guard,
 *   `describesAttendanceToo`, already skips it there).
 *
 * Both now read as main reads them. The new reading, and its guard, sit
 * behind LATE_OPEN_PLACE_ENABLED (default off) as well as
 * LATE_OPEN_DATE_ENABLED: with the new flag off the reader is main's, even
 * with LATE_OPEN_DATE_ENABLED on as in production. Every reading main
 * already gives is pinned below, whole. Each QA sentence is read lowercase,
 * in Sentence case and in ALL CAPS.
 */

const NONE: CaPolicyReading = {
  stated: null,
  topics: [],
  alternatives: [],
  suggestion: null,
  source: null,
  ambiguous: null,
  missedEvent: null,
};
const LATE_OPENING: CaPolicyReading = { ...NONE, stated: "late_opening" };

const cases = (sentence: string) => [
  sentence.toLowerCase(),
  sentence.charAt(0).toUpperCase() + sentence.slice(1),
  sentence.toUpperCase(),
];

/** LATE_OPEN_DATE_ENABLED (on in production), and this PR's LATE_OPEN_PLACE_ENABLED with it unless said otherwise. */
function flag(on: boolean, place: boolean = on) {
  vi.stubEnv("LATE_OPEN_DATE_ENABLED", on ? "1" : "");
  vi.stubEnv("LATE_OPEN_PLACE_ENABLED", place ? "1" : "");
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("QA-6 false positives, flags on: not Late Opening (main's reading, unchanged)", () => {
  it.each([
    ...cases("opening the salon late was approved by the manager"),
    ...cases("she opened the location late and also left early"),
  ])("%s", (sentence) => {
    flag(true);
    expect(readCaPolicy(sentence)).toEqual(NONE);
    expect(namesCaPolicy(sentence)).toBe(false);
  });

  it("the attendance clause in another turn of the same account sets it aside too", () => {
    flag(true);
    const account = `create verbal ca for Test Employee for opening salon late on 10-1-26${JOIN}she also left early that day`;
    expect(readCaPolicy(account)).toEqual(NONE);
  });
});

describe("a late-for-shift account is not a late opening, flag on", () => {
  it.each([...cases("late for shift at the salon"), ...cases("she was late for her shift at the salon")])(
    "%s → no policy named",
    (sentence) => {
      flag(true);
      expect(readCaPolicy(sentence).stated).toBeNull();
      expect(readCaPolicy(sentence)).toEqual(NONE);
      expect(namesCaPolicy(sentence)).toBe(false);
    },
  );
});

describe("the guard is narrow: an unapproved late opening, alone, is still Late Opening", () => {
  it.each([
    ...cases("create verbal ca for Test Employee for opening salon late on 10-1-26"),
    ...cases("she opened the salon late on 10-1-26"),
    ...cases("opening the salon late was not approved"),
    ...cases("she opened the salon late without permission"),
    ...cases("she opened the location late and no one approved it"),
  ])("%s", (sentence) => {
    flag(true);
    expect(readCaPolicy(sentence)).toEqual(LATE_OPENING);
  });

  it("LATE_OPEN_DATE_ENABLED off: the new reading is not there at all", () => {
    flag(false, true);
    for (const sentence of cases("she opened the salon late on 10-1-26")) expect(readCaPolicy(sentence)).toEqual(NONE);
  });
});

/*
 * MAIN'S READINGS, BYTE FOR BYTE. Each expectation is what origin/main
 * (7a09b5d9) returns for the sentence, recorded whole. The new guard must not
 * touch any of them — including the two main already reads as Late Opening
 * although QA-6 would not ("she opened late and also left early", "opening
 * late was approved by the manager"): those come from main's own "opened
 * late" pattern, which LATE_OPEN_DATE_ENABLED does not govern, and changing
 * them is a separate change, not this PR's.
 */
describe("main's existing late-opening readings are unchanged", () => {
  const MAIN: [string, CaPolicyReading, CaPolicyReading][] = [
    // sentence, flag off, flag on
    ["late opening", LATE_OPENING, LATE_OPENING],
    ["she was written up for a late-opening", LATE_OPENING, LATE_OPENING],
    ["opened late on 10/19", LATE_OPENING, LATE_OPENING],
    ["opening late", LATE_OPENING, LATE_OPENING],
    ["she is a late opener", LATE_OPENING, LATE_OPENING],
    ["late to open 10-19", NONE, LATE_OPENING],
    ["was late to open the salon 10-19-26", NONE, LATE_OPENING],
    ["late to open and called out the next day", NONE, LATE_OPENING],
    ["she opened late and also left early", LATE_OPENING, LATE_OPENING],
    ["opening late was approved by the manager", LATE_OPENING, LATE_OPENING],
    [`she left early on 10/1${JOIN}she opened late on 10/2`, LATE_OPENING, LATE_OPENING],
    ["she was late for her shift", NONE, NONE],
  ];

  it.each(MAIN)("%s", (sentence, off, on) => {
    flag(false);
    expect(readCaPolicy(sentence)).toEqual(off);
    flag(true);
    expect(readCaPolicy(sentence)).toEqual(on);
    flag(true, false);
    expect(readCaPolicy(sentence)).toEqual(on);
  });
});

/*
 * PRODUCTION AS IT IS: LATE_OPEN_DATE_ENABLED on, LATE_OPEN_PLACE_ENABLED off
 * (its default). Every sentence reads exactly as origin/main reads it —
 * B1 and "she opened the salon late" included, which name no policy on main.
 */
describe("LATE_OPEN_DATE on, LATE_OPEN_PLACE off: main's readings, byte for byte", () => {
  it.each([
    ...cases("opening the salon late was approved by the manager"),
    ...cases("she opened the location late and also left early"),
    ...cases("late for shift at the salon"),
    ...cases("she was late for her shift at the salon"),
    ...cases(
      "create verbal ca for Test Employee for opening salon late on 10-1-26. previous coaching is jba policy manual 1-1-26. payroll deduct DOES apply and state $25 will be payroll deducted",
    ),
    ...cases("she opened the salon late on 10-1-26"),
    ...cases("opening the salon late was not approved"),
  ])("%s", (sentence) => {
    flag(true, false);
    expect(readCaPolicy(sentence)).toEqual(NONE);
    expect(namesCaPolicy(sentence)).toBe(false);
  });
});
