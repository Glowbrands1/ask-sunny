import { afterEach, describe, expect, it } from "vitest";

import { explicitIncidentIso } from "./explicit-incident-date";
import { extractFormDate, listFormDates } from "./form-date-answer";
import { decideFormDate, incidentDates } from "./incident-dates";

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
    expect(extractFormDate(ASSIGNED_BY, TODAY)).toBeNull();
    expect(explicitIncidentIso(ASSIGNED_BY, TODAY)).toBeNull();
  });

  it('"assigned 9-1-26 … due by 9-15-26" offers neither date', () => {
    withFlag(true);
    expect(extractFormDate(ASSIGNED_AND_DUE, TODAY)).toBeNull();
    expect(explicitIncidentIso(ASSIGNED_AND_DUE, TODAY)).toBeNull();
    expect(incidentDates(ASSIGNED_AND_DUE, TODAY)).toEqual([]);
  });

  it("a woven deadline and prior-action dates are not offered as the form's date", () => {
    withFlag(true);
    expect(incidentDates(WOVEN_DEADLINE, TODAY)).toEqual([]);
    expect(decide(WOVEN_DEADLINE)).toEqual({});
    expect(extractFormDate(WOVEN_DEADLINE, TODAY)).toBeNull();
  });

  it('"today" with prior actions in parentheses asks no "which date?" and takes today', () => {
    withFlag(true);
    expect(decide(PRIOR_IN_PARENS)).toEqual({});
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
      expect(extractFormDate(as(ASSIGNED_BY), TODAY)).toBeNull();
      expect(incidentDates(as(ASSIGNED_AND_DUE), TODAY)).toEqual([]);
      expect(incidentDates(as(WOVEN_DEADLINE), TODAY)).toEqual([]);
      expect(decide(as(PRIOR_IN_PARENS))).toEqual({});
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
