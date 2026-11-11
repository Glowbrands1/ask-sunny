import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { groundFormSlots } from "@/lib/ai/form-full-remap";

import { explicitIncidentIso } from "./explicit-incident-date";
import { extractFormDate, listFormDates, listIncidentDates } from "./form-date-answer";
import { decideFormDate, incidentDates } from "./incident-dates";
import { newestStatedDate, withYearlessDatesWritten } from "./late-open";

/**
 * D3, decided by Pau's coordinator, 25 Oct 2026: the form's date is the
 * incident date the manager stated; today when they said "today" or gave
 * none; NEVER a deadline, due date, assignment date, prior-action date or a
 * "by <date>". The managers' wording is kept; the people are invented.
 */
const TODAY = "2026-10-25";
const FLAG = "FORM_DATE_INCIDENT_ONLY_ENABLED";

// conv_mvod8jw02vsk2py / conv_mvofh8wi2zc5374, turns 1 and 2.
const ASSIGNED_BY =
  "create a ca form for test employee because she didnt do deep clean assigned by 9-15-26";
const ASSIGNED_AND_DUE =
  "deep clean assigned 9-1-26 of room 1 and due by 9-15-26. no previous coaching or ca on file";
// conv_mvof8w712p9rd9c.
const WOVEN_DEADLINE =
  "create a verbal corrective action for Ava Pellmore, tanning consultant at Test Salon for missing the 10-15-26 woven deadline. previous coaching. verbal (06/25/2026) and written (07/28/2026). no payroll deducation";
// conv_mvoexl0b2upub8p, turn 2.
const PRIOR_IN_PARENS =
  "Ava Pellmore, today, - Ava set up a spray booth, then went into Room 4 and stayed there until the first customer arrived at 7:57am. Written warning. previous coaching. verbal (06/25/2026) and written (07/28/2026). no payroll deducation. TC";

function withFlag(on: boolean): void {
  if (on) process.env[FLAG] = "true";
  else delete process.env[FLAG];
}

afterEach(() => withFlag(false));

function decide(text: string) {
  return decideFormDate({
    text,
    templateKey: "dpoa",
    history: [],
    conversation: [{ role: "user", content: text }],
    today: TODAY,
  });
}

describe("FORM_DATE_INCIDENT_ONLY_ENABLED: the form's date is never a deadline, assignment or prior-action date", () => {
  it("off, main's reading is unchanged (the reported failures)", () => {
    withFlag(false);
    expect(extractFormDate(ASSIGNED_BY, TODAY)).toBe("2026-09-15");
    expect(explicitIncidentIso(ASSIGNED_AND_DUE, TODAY)).toBe("2026-09-01");
    expect(incidentDates(WOVEN_DEADLINE, TODAY)).toEqual([
      "2026-06-25",
      "2026-07-28",
      "2026-10-15",
    ]);
    expect(decide(PRIOR_IN_PARENS).question).toContain(
      "Which date goes on the form?",
    );
  });

  it('"assigned by 9-15-26" is a due date: the form is dated the day it is created', () => {
    withFlag(true);
    // Dated the day it is created; the shared reader still sees the date, so the intake stays open.
    expect(decide(ASSIGNED_BY)).toEqual({ formDate: null });
    expect(extractFormDate(ASSIGNED_BY, TODAY)).toBe("2026-09-15");
    expect(explicitIncidentIso(ASSIGNED_BY, TODAY)).toBeNull();
  });

  it('"assigned 9-1-26 … due by 9-15-26" offers neither date', () => {
    withFlag(true);
    expect(decide(ASSIGNED_AND_DUE)).toEqual({ formDate: null });
    expect(explicitIncidentIso(ASSIGNED_AND_DUE, TODAY)).toBeNull();
    expect(incidentDates(ASSIGNED_AND_DUE, TODAY)).toEqual([]);
  });

  it("a woven deadline and prior-action dates are not offered as the form's date", () => {
    withFlag(true);
    expect(incidentDates(WOVEN_DEADLINE, TODAY)).toEqual([]);
    expect(decide(WOVEN_DEADLINE)).toEqual({ formDate: null });
  });

  it('"today" with prior actions in parentheses asks no "which date?" and takes today', () => {
    withFlag(true);
    expect(decide(PRIOR_IN_PARENS)).toEqual({ formDate: null });
    expect(explicitIncidentIso(PRIOR_IN_PARENS, TODAY)).toBe(TODAY);
  });

  it("every date stays in the account the draft keeps", () => {
    withFlag(true);
    expect(
      listFormDates(ASSIGNED_AND_DUE, TODAY).map((found) => found.iso),
    ).toEqual(["2026-09-01", "2026-09-15"]);
  });
});

describe("NEVER-BREAK: a stated incident date is the form's date, flag on or off", () => {
  for (const on of [false, true]) {
    it(`flag ${on ? "on" : "off"}`, () => {
      withFlag(on);
      expect(
        extractFormDate(
          "create a coaching for employee, test employee, who tanned on the clock on 9-28-26",
          TODAY,
        ),
      ).toBe("2026-09-28");
      expect(
        explicitIncidentIso(
          "Ava Pellmore. 10/22/2026 is the date of incident.   Ava set up a spray booth",
          TODAY,
        ),
      ).toBe("2026-10-22");
      expect(
        extractFormDate(
          "she was late on 10/20 and missed the 10/15 deadline",
          TODAY,
        ),
      ).toBe("2026-10-20");
      expect(incidentDates("She was late on 10/5 and 10/15", TODAY)).toEqual([
        "2026-10-05",
        "2026-10-15",
      ]);
      expect(
        explicitIncidentIso(
          "name is test employeeone, today's date, employee had verbal ca 9-1-26",
          TODAY,
        ),
      ).toBe(TODAY);
    });
  }
});

/*
 * HOW MANAGERS TYPE (Pau, 26 Oct 2026): every wording above also runs all
 * lowercase and in sentence case (first letter and names capitalised), with
 * the same outcome. Invented names only.
 */
const NAMES = [
  "test employeeone",
  "test employee",
  "ava pellmore",
  "test salon",
];
function sentenceCase(text: string): string {
  let out = text.toLowerCase();
  for (const name of NAMES)
    out = out.split(name).join(name.replace(/\b\w/g, (c) => c.toUpperCase()));
  return out.charAt(0).toUpperCase() + out.slice(1);
}
const REGISTERS: [string, (text: string) => string][] = [
  ["all lowercase", (text) => text.toLowerCase()],
  ["sentence case", sentenceCase],
];

describe.each(REGISTERS)(
  "FORM_DATE_INCIDENT_ONLY_ENABLED in the managers' register: %s",
  (_register, as) => {
    it("flag on: no deadline, assignment or prior-action date is the form's date", () => {
      withFlag(true);
      expect(decide(as(ASSIGNED_BY))).toEqual({ formDate: null });
      expect(incidentDates(as(ASSIGNED_AND_DUE), TODAY)).toEqual([]);
      expect(incidentDates(as(WOVEN_DEADLINE), TODAY)).toEqual([]);
      expect(decide(as(PRIOR_IN_PARENS))).toEqual({ formDate: null });
      expect(explicitIncidentIso(as(PRIOR_IN_PARENS), TODAY)).toBe(TODAY);
    });

    for (const on of [false, true]) {
      it(`NEVER-BREAK (flag ${on ? "on" : "off"}): a stated incident date is still the form's date`, () => {
        withFlag(on);
        expect(
          extractFormDate(
            as(
              "create a coaching for employee, test employee, who tanned on the clock on 9-28-26",
            ),
            TODAY,
          ),
        ).toBe("2026-09-28");
        expect(
          explicitIncidentIso(
            as(
              "Ava Pellmore. 10/22/2026 is the date of incident. ava set up a spray booth",
            ),
            TODAY,
          ),
        ).toBe("2026-10-22");
        expect(
          extractFormDate(
            as("she was late on 10/20 and missed the 10/15 deadline"),
            TODAY,
          ),
        ).toBe("2026-10-20");
        expect(
          incidentDates(as("She was late on 10/5 and 10/15"), TODAY),
        ).toEqual(["2026-10-05", "2026-10-15"]);
      });
    }
  },
);

/*
 * LIVE TESTER FINDINGS, 26 Oct 2026 (invented names). Sunny conv_mvolz9vk2cwijs1:
 * "late on 10-5 and 10-15, i coached her on 10-16" dated the Coaching Form
 * 10/5, the first of two late dates, because "10-15" after "and" was not read
 * as a date. Bubbles conv_mvolwmup27zde0x: "I coached her on 10-16 and gave a
 * verbal on 10-21" dated the form 10/21, a prior step, through the remap's
 * own year-less dates.
 */
const explicitIncidentIsoOrNull = explicitIncidentIso;

const LATE_TWICE = "create a coaching form for test employee at test salon, she was late on 10-5 and 10-15, i coached her on 10-16.";
const PRIORS_TODAY = "Write up Ava Pellmore, Team Member, Dodge, NE, no call no show today. I coached her on 10-16 and gave a verbal on 10-21.";

function remapDate(question: string): string | null {
  return groundFormSlots({
    raw: {
      templateKey: "dpoa",
      employeeName: "Ava Pellmore",
      observation: null,
      actionPlan: null,
      warningLevel: null,
      payrollDeduct: null,
      payrollAmount: null,
      jobTitle: null,
      store: null,
      policySection: null,
    },
    history: [],
    question,
    today: TODAY,
    people: [],
  }).slots.incidentDateIso;
}

describe.each(REGISTERS)("live tester findings, 26 Oct 2026 (%s)", (_register, as) => {
  beforeEach(() => {
    process.env.LATE_OPEN_DATE_ENABLED = "true";
  });
  afterEach(() => {
    delete process.env.LATE_OPEN_DATE_ENABLED;
  });

  it("off: the first late date stands alone, and the prior verbal dates the remap (the reported failures)", () => {
    withFlag(false);
    expect(newestStatedDate(as(LATE_TWICE), TODAY, explicitIncidentIsoOrNull)).toBe("2026-10-05");
    expect(remapDate(as(PRIORS_TODAY))).toBe("2026-10-21");
  });

  it("on: both late dates are read, so the form is never dated by the first alone", () => {
    withFlag(true);
    const written = withYearlessDatesWritten(as(LATE_TWICE), TODAY);
    expect(listIncidentDates(written, TODAY).map((found) => found.iso)).toEqual(["2026-10-05", "2026-10-15"]);
    expect(newestStatedDate(as(LATE_TWICE), TODAY, explicitIncidentIsoOrNull)).toBeNull();
    // On the Coaching Form the coaching held dates it (incident-dates.ts rule 2).
    expect(decideFormDate({ text: written, templateKey: "coaching", history: [], conversation: [], today: TODAY }).formDate).toBe(
      "2026-10-16",
    );
  });

  it("on: a coaching or a verbal already given is never the form's date", () => {
    withFlag(true);
    expect(remapDate(as(PRIORS_TODAY))).not.toBe("2026-10-21");
    expect(remapDate(as(PRIORS_TODAY))).not.toBe("2026-10-16");
  });

  for (const on of [false, true]) {
    // Dispatcher probe, 26 Oct 2026: the verbal this form documents keeps its date.
    it(`NEVER-BREAK (flag ${on ? "on" : "off"}): "i gave her a verbal on 10-21 for being late" dates the form 10-21`, () => {
      withFlag(on);
      expect(remapDate(as("write up ava pellmore, i gave her a verbal on 10-21 for being late"))).toBe("2026-10-21");
      expect(remapDate(as("verbal for ava pellmore, gave her a verbal on 10-21 for being late on 10-21"))).toBe("2026-10-21");
    });
  }

  for (const on of [false, true]) {
    it(`NEVER-BREAK (flag ${on ? "on" : "off"}): a late opening and a single year-less incident date are read as before`, () => {
      withFlag(on);
      expect(newestStatedDate(as("ca for ava pellmore late to open 10-19, verbal"), TODAY, explicitIncidentIsoOrNull)).toBe("2026-10-19");
      expect(remapDate(as("Write up Ava Pellmore, she was late on 10-20"))).toBe("2026-10-20");
      expect(withYearlessDatesWritten(as("she worked 10-12 hours on 10-20"), TODAY)).toContain("10-12 hours");
    });
  }
});

/* QA-6 date matrix, 26 Oct 2026: a date before "the deadline" in another clause is still the incident's. */
describe("FORM_DATE_INCIDENT_ONLY_ENABLED: only the date that IS the deadline is skipped", () => {
  const CASES = [
    "rowan pell was late on 10/2 and the deadline was missed",
    "rowan pell was late on 10/2 for the deadline",
  ];
  for (const on of [false, true]) {
    it(`flag ${on ? "on" : "off"}: the late date stays the incident date (lowercase, sentence case, CAPS)`, () => {
      withFlag(on);
      for (const text of CASES) {
        for (const as of [text, text.charAt(0).toUpperCase() + text.slice(1), text.toUpperCase()]) {
          expect(incidentDates(as, TODAY), as).toEqual(["2026-10-02"]);
        }
      }
    });
  }

  it("flag on: the woven deadline itself is still skipped", () => {
    withFlag(true);
    expect(incidentDates("she missed the 10-15-26 woven deadline", TODAY)).toEqual([]);
    expect(incidentDates("she missed the 10/15 woven training deadline", TODAY)).toEqual([]);
  });
});
