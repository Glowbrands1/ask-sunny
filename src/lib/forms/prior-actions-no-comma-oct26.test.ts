import { afterEach, describe, expect, it, vi } from "vitest";

import { decideIntentTurn, type IntentTurnInput } from "@/lib/ai/intent-slots";
import { blankYearlessStepDates, heldCoachingDates, listIncidentDates } from "@/lib/forms/form-date-answer";
import { incidentDates } from "@/lib/forms/incident-dates";
import { statedPriorActions } from "@/lib/forms/prior-actions";
import { managerStatedWarningLevel, statedWarningLevel, warningLevelFromTurns } from "@/lib/forms/warning-level";

/**
 * ============================================================================
 * QA, 26 OCT 2026 — PRIOR ACTIONS TYPED WITH NO COMMA BETWEEN THEM
 * ============================================================================
 *
 * The manager's words, as QA reported them:
 *
 *   "prior coaching verbal 6/25 written 7/28 no deduct"
 *
 * With PRIOR_ACTIONS_PARSE_ENABLED (on in production) the second prior action
 * read "Written warning — verbal 6/25 — 07/28/2026": with no comma, 7/28 was
 * no list item, and the labelled-step reader took every word back to "prior
 * coaching" as its topic. "prior coaching: verbal 6/25, written 7/28" read
 * cleanly. PRIOR_ACTIONS_NO_COMMA_ENABLED lets a step item set off by spaces
 * alone continue the list, each item holding only its own words.
 *
 * Every case runs all lowercase, in sentence case, and in sentence case with
 * names and levels Capitalized. Names are invented ("Test Employee", "Test
 * Salon"). Year-less dates take TODAY's year, passed in as the other
 * year-less suites do (`prior-actions-yearless-oct25.test.ts`).
 */

const TODAY = "2026-10-26";

const PRIORS = ["Verbal warning — 06/25/2026", "Written warning — 07/28/2026"];

/** All lowercase; sentence case; sentence case with names and levels Capitalized. */
function variants(text: string): string[] {
  const lower = text.toLowerCase();
  const sentence = lower.replace(/(^|[.!?]\s+)([a-z])/g, (_, lead: string, letter: string) => lead + letter.toUpperCase());
  const capitalized = sentence.replace(
    /\b(verbal|written|final|coaching|coachings|test employee|test salon|rowan pell)\b/g,
    (word) => word.replace(/\b[a-z]/g, (letter) => letter.toUpperCase()),
  );
  return [...new Set([lower, sentence, capitalized])];
}

function flags(parse: boolean, noComma: boolean): void {
  vi.stubEnv("PRIOR_ACTIONS_PARSE_ENABLED", parse ? "1" : "");
  vi.stubEnv("PRIOR_ACTIONS_NO_COMMA_ENABLED", noComma ? "1" : "");
}

afterEach(() => {
  vi.unstubAllEnvs();
});

const FLAG_ON: { text: string; priors: string[]; incidents: string[] }[] = [
  { text: "prior coaching verbal 6/25 written 7/28 no deduct", priors: PRIORS, incidents: [] },
  { text: "prior coaching verbal 6/25/2026 written 7/28/2026", priors: PRIORS, incidents: [] },
  { text: "previous coaching verbal 6/25 written 7/28", priors: PRIORS, incidents: [] },
  {
    text: "prior verbal 9/1 written 9/15",
    priors: ["Verbal warning — 09/01/2026", "Written warning — 09/15/2026"],
    incidents: [],
  },
  { text: "no prior", priors: [], incidents: [] },
  // Neighbours that already read cleanly and must keep doing so.
  { text: "prior coaching: verbal 6/25, written 7/28", priors: PRIORS, incidents: [] },
  {
    text: "previous coaching. she was late (10/20/2026) and left early (10/22/2026)",
    priors: [],
    incidents: ["2026-10-20", "2026-10-22"],
  },
  {
    text: "create a written ca for Test Employee at Test Salon, late to open 10/20/2026. prior coaching verbal 6/25 written 7/28 no deduct",
    priors: PRIORS,
    incidents: ["2026-10-20"],
  },
];

/*
 * ============================================================================
 * QA, SUNNY ROUND 3 (26 OCT 2026) — A REAL MANAGER'S REGISTER
 * ============================================================================
 *
 * Two turns, word for word but for the employee, who is invented here
 * ("Rowan Pell"); QA's "…" marks words left out of the report.
 *
 *   (1) "ca rowan pell tc written 10/22 spray booth room 4 … prior coaching
 *       verbal 6/25 written 7/28 …" — the card read "Written warning — verbal
 *       6/25 — 07/28/2026". The list after an incident date, in a longer
 *       turn, reads as two clean priors with the flag on. (Its duplicate
 *       "Follow-up:" lines are FOLLOW_UP_NOT_PRIOR_ENABLED's, Sunny #243.)
 *
 *   (2) "perf ca rowan pell 270 tans below ppta upta lpsva cc spa verbal prior
 *       coachings 9/8 9/15 9/25 no deduct tc" — the priors accumulated
 *       ("Coaching — 9/8 — 09/15/2026; Coaching — 9/8 9/15 — 09/25/2026"),
 *       the form was dated 9/25 (the slot model's copy of a prior's date), and
 *       Type of Warning was blank though the manager said "verbal".
 */
const QA_ONE = "ca rowan pell tc written 10/22 spray booth room 4 prior coaching verbal 6/25 written 7/28 no deduct";
const QA_TWO = "perf ca rowan pell 270 tans below ppta upta lpsva cc spa verbal prior coachings 9/8 9/15 9/25 no deduct tc";
const COACHINGS = ["Coaching — 09/08/2026", "Coaching — 09/15/2026", "Coaching — 09/25/2026"];

FLAG_ON.push(
  { text: QA_ONE, priors: PRIORS, incidents: ["2026-10-22"] },
  { text: QA_TWO, priors: COACHINGS, incidents: [] },
  { text: "prior coachings 9/8 9/15 9/25", priors: COACHINGS, incidents: [] },
  { text: "prior coachings 9/8, 9/15 and 9/25", priors: COACHINGS, incidents: [] },
  { text: "prior coachings: 9/8 9/15 9/25", priors: COACHINGS, incidents: [] },
  {
    text: "prior coaching 9/8 9/15",
    priors: ["Coaching — 09/08/2026", "Coaching — 09/15/2026"],
    incidents: [],
  },
  // The incident date the turn gives is kept; the bare list stays history.
  {
    text: "perf ca rowan pell below ppta on 10/20 verbal prior coachings 9/8 9/15 9/25 no deduct",
    priors: COACHINGS,
    incidents: ["2026-10-20"],
  },
  // An account after the list ends it: "late again 10/20" is an incident.
  {
    text: "prior coachings 9/8 9/15 late again 10/20",
    priors: ["Coaching — 09/08/2026", "Coaching — 09/15/2026"],
    incidents: ["2026-10-20"],
  },
);

describe("PRIOR_ACTIONS_NO_COMMA_ENABLED on (with PRIOR_ACTIONS_PARSE_ENABLED, as in production)", () => {
  for (const { text, priors, incidents } of FLAG_ON) {
    for (const variant of variants(text)) {
      it(`"${variant}"`, () => {
        flags(true, true);
        expect(statedPriorActions(variant, TODAY)).toEqual(priors);
        expect(incidentDates(variant, TODAY)).toEqual(incidents);
      });
    }
  }
});

/*
 * THE FORM'S DATE AND TYPE OF WARNING, through the intent reading
 * (`decideIntentTurn`, the production path), with the slot model's reading as
 * it came back: the first date, the last one, or none.
 */
function turn(question: string, incidentDate: string | null) {
  const input: IntentTurnInput = {
    question,
    history: [],
    today: TODAY,
    saved: null,
    raw: { employee: "Rowan Pell", incidentDate, warningLevel: null, formType: "corrective action", formTurn: true },
    people: [],
    salons: [{ id: "loc-test", name: "Test Salon" }],
    headings: ["Attendance", "Standards of Conduct"],
    templates: [{ key: "dpoa", name: "Corrective Action Form" }],
    formInProgress: false,
  };
  return decideIntentTurn(input).state;
}

describe("(2) the form's date and level, flag on", () => {
  for (const variant of variants(QA_TWO)) {
    for (const model of ["9/8", "9/25", null]) {
      for (const managerOnly of [true, false]) {
        it(`"${variant}" (model ${model ?? "none"}, WARNING_LEVEL_MANAGER_ONLY_ENABLED ${managerOnly ? "on" : "off"})`, () => {
          flags(true, true);
          vi.stubEnv("WARNING_LEVEL_MANAGER_ONLY_ENABLED", managerOnly ? "1" : "");
          const state = turn(variant, model);
          // No incident date in the turn: dated the day it is created, never a prior coaching's date.
          expect(state.formDate).toBeNull();
          expect(state.warningLevel).toBe("verbal");
          expect(listIncidentDates(variant, TODAY)).toEqual([]);
        });
      }
    }
  }

  it("a turn that gives its incident date keeps it, whatever the model copied", () => {
    flags(true, true);
    const said = "perf ca rowan pell below ppta on 10/20 verbal prior coachings 9/8 9/15 9/25 no deduct";
    for (const model of ["10/20", "9/25", null]) expect(turn(said, model).formDate).toBe("2026-10-20");
  });

  it("(1): dated 10/22, whatever the model copied", () => {
    flags(true, true);
    for (const model of ["10/22", "7/28", null]) expect(turn(QA_ONE, model).formDate).toBe("2026-10-22");
  });
});

describe("(2c) the level before the history label (warning-level.ts, asked for by the flag)", () => {
  const ASK = { levelBeforeHistoryLabel: true };

  it("is this form's level in every register", () => {
    for (const variant of variants(QA_TWO)) {
      expect(statedWarningLevel(variant, ASK)).toBe("verbal");
      expect(warningLevelFromTurns([variant], ASK)).toBe("verbal");
      expect(managerStatedWarningLevel([{ role: "user", content: variant }], ASK)).toBe("verbal");
    }
    expect(statedWarningLevel("ca rowan pell late to open 10/20 written prior warnings 9/1 9/15", ASK)).toBe("written");
  });

  it("is never read after words of history, or without a request for the form", () => {
    expect(statedWarningLevel("she had a verbal prior coaching 9/8", ASK)).toBeNull();
    expect(statedWarningLevel("ca rowan pell, she got a verbal prior coaching 9/8", ASK)).toBeNull();
    expect(statedWarningLevel("verbal prior coachings 9/8 9/15", ASK)).toBeNull();
    // A level stated for the form elsewhere is untouched.
    expect(statedWarningLevel("create a written ca for rowan pell. verbal prior coachings 9/8 9/15", ASK)).toBe("written");
    expect(statedWarningLevel(QA_ONE, ASK)).toBeNull();
  });

  it("not asked for, it reads as before (pinned)", () => {
    expect(statedWarningLevel(QA_TWO)).toBeNull();
    expect(warningLevelFromTurns([QA_TWO])).toBeNull();
  });
});

/*
 * ============================================================================
 * SUNNY TESTER, 26 OCT 2026 — A PRIOR IN A SHORT SECOND SENTENCE
 * ============================================================================
 *
 * Word for word but for the employee, who is invented ("Rowan Pell"):
 *
 *   "Write up Rowan Pell, Tanning Consultant, KS Manhattan, no call no show
 *    today. I coached her on 10-16 and gave a verbal on 10-21."
 *
 * The form was dated today (right), but no prior action was listed, in any
 * casing: the held coaching was skipped as the form's date should be, and the
 * held-coaching reader ran back across "10-16 and gave a verbal on" and took
 * the verbal for the coaching too. With PRIOR_ACTIONS_NO_COMMA_ENABLED on,
 * both are listed, and neither dates the form.
 */
const NCNS =
  "Write up Rowan Pell, Tanning Consultant, KS Manhattan, no call no show today. I coached her on 10-16 and gave a verbal on 10-21.";
const NCNS_PRIORS = ["Coaching — 10/16/2026", "Verbal warning — 10/21/2026"];

/** QA's casings: all lowercase, sentence case, ALL CAPS, the name typed lowercase or Capitalized. */
const NCNS_CASINGS = [
  NCNS.toLowerCase(),
  NCNS,
  NCNS.replace("Rowan Pell", "rowan pell"),
  NCNS.replace("Rowan Pell", "rowan pell").replace("Tanning Consultant", "tanning consultant"),
  NCNS.toUpperCase(),
];

describe("a prior in a short second sentence (flag on)", () => {
  for (const said of NCNS_CASINGS) {
    it(`"${said}"`, () => {
      flags(true, true);
      expect(statedPriorActions(said, TODAY)).toEqual(NCNS_PRIORS);
      expect(incidentDates(said, TODAY)).toEqual([]);
      expect(listIncidentDates(said, TODAY)).toEqual([]);
      // The verbal is blanked for the yearless reader; a held coaching never is, as before.
      expect(blankYearlessStepDates(said, TODAY)).not.toMatch(/10-21/);
      expect(blankYearlessStepDates(said, TODAY)).toMatch(/10-16/);
      for (const model of ["10-21", "10-16", null]) expect(turn(said, model).formDate).toBe(TODAY);
    });
  }

  it.each([
    ["write up rowan pell, no call no show today. I coached her on 10-16.", ["Coaching — 10/16/2026"]],
    ["write up rowan pell, no call no show today. she already got a verbal on 10-21.", ["Verbal warning — 10/21/2026"]],
    ["write up rowan pell, no call no show today. had a written on 10-21.", ["Written warning — 10/21/2026"]],
    ["write up rowan pell, no call no show today. I coached her on 10/16 and gave a verbal on 10/21.", NCNS_PRIORS],
  ])("%s", (said, priors) => {
    flags(true, true);
    expect(statedPriorActions(said, TODAY)).toEqual(priors);
    expect(incidentDates(said, TODAY)).toEqual([]);
  });

  it("a Coaching Form's own coaching is still its date, and is never blanked", () => {
    flags(true, true);
    const coaching = "coaching form for rowan pell, she was late on 10/5 and 10/15, I coached her on 10/16";
    expect(heldCoachingDates(coaching, TODAY)).toEqual(["2026-10-16"]);
    const yearless = "coaching form for rowan pell. I coached her on 10-16";
    expect(blankYearlessStepDates(yearless, TODAY)).toBe(yearless);
  });

  it("flag off: no prior is listed (QA's defect, pinned)", () => {
    flags(true, false);
    for (const said of NCNS_CASINGS) {
      expect(statedPriorActions(said, TODAY)).toEqual([]);
      expect(turn(said, null).formDate).toBe(TODAY);
    }
  });
});

describe("PRIOR_ACTIONS_NO_COMMA_ENABLED off: today's output, pinned", () => {
  // Pinned on purpose: this is the defect QA reported, the second line keeping
  // the first item's words. The new flag off must leave it byte for byte.
  const GARBLED: [string, string[]][] = [
    ["prior coaching verbal 6/25 written 7/28 no deduct", ["Verbal warning — 06/25/2026", "Written warning — verbal 6/25 — 07/28/2026"]],
    ["prior coaching verbal 6/25/2026 written 7/28/2026", ["Verbal warning — 06/25/2026", "Written warning — verbal 6/25/2026 — 07/28/2026"]],
    ["previous coaching verbal 6/25 written 7/28", ["Verbal warning — 06/25/2026", "Written warning — verbal 6/25 — 07/28/2026"]],
    ["prior verbal 9/1 written 9/15", ["Verbal warning — 09/01/2026", "Written warning — 9/1 — 09/15/2026"]],
    [
      "create a written ca for Test Employee at Test Salon, late to open 10/20/2026. prior coaching verbal 6/25 written 7/28 no deduct",
      ["Verbal warning — 06/25/2026", "Written warning — verbal 6/25 — 07/28/2026"],
    ],
  ];
  for (const [text, priors] of GARBLED) {
    it(`"${text}" with PRIOR_ACTIONS_PARSE_ENABLED alone`, () => {
      flags(true, false);
      expect(statedPriorActions(text, TODAY)).toEqual(priors);
    });
  }

  it("(2): the priors accumulate, the model's 9/25 dates the form, and the level is blank (QA's defect)", () => {
    flags(true, false);
    expect(statedPriorActions(QA_TWO, TODAY)).toEqual([
      "Coaching — 09/08/2026",
      "Coaching — 9/8 — 09/15/2026",
      "Coaching — 9/8 9/15 — 09/25/2026",
    ]);
    expect(statedPriorActions("prior coachings 9/8, 9/15 and 9/25", TODAY)).toEqual(["Coaching — 09/08/2026"]);
    expect(incidentDates("prior coachings 9/8, 9/15 and 9/25", TODAY)).toEqual(["2026-09-15", "2026-09-25"]);
    expect(turn(QA_TWO, "9/25").formDate).toBe("2026-09-25");
    vi.stubEnv("WARNING_LEVEL_MANAGER_ONLY_ENABLED", "1");
    expect(turn(QA_TWO, null).warningLevel).toBeNull();
  });

  it("(2) with the new flag on but PRIOR_ACTIONS_PARSE_ENABLED off, the same as off", () => {
    flags(false, false);
    const before = { priors: statedPriorActions(QA_TWO, TODAY), date: turn(QA_TWO, "9/25").formDate };
    flags(false, true);
    expect({ priors: statedPriorActions(QA_TWO, TODAY), date: turn(QA_TWO, "9/25").formDate }).toEqual(before);
  });

  it("Capitalized levels keep the manager's casing in the garbled line", () => {
    flags(true, false);
    expect(statedPriorActions("Prior coaching Verbal 6/25 Written 7/28 no deduct", TODAY)).toEqual([
      "Verbal warning — 06/25/2026",
      "Written warning — Verbal 6/25 — 07/28/2026",
    ]);
  });

  it("the new flag without PRIOR_ACTIONS_PARSE_ENABLED changes nothing", () => {
    const text = "prior coaching verbal 6/25 written 7/28 no deduct";
    flags(false, false);
    const before = statedPriorActions(text, TODAY);
    expect(before).toEqual(["Verbal warning — signed 06/25/2026", "Written warning — verbal 6/25 — signed 07/28/2026"]);
    flags(false, true);
    expect(statedPriorActions(text, TODAY)).toEqual(before);
    expect(statedPriorActions("prior verbal 9/1 written 9/15", TODAY)).toEqual([]);
    expect(incidentDates("prior verbal 9/1 written 9/15", TODAY)).toEqual(["2026-09-01", "2026-09-15"]);
  });
});
