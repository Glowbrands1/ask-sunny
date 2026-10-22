import { describe, expect, it } from "vitest";

import { readCorrectiveActionIntake } from "./corrective-action-intake";
import { readEppIntake } from "./epp-intake";
import { extractFormDate, formDateChange, formDateChangeUnclear, isIsoCalendarDate, listFormDates, priorStepDate, priorSteps } from "./form-date-answer";

/**
 * A manager types a date however they type it. Numeric dates are U.S.
 * month/day, and no year is required — month and day take the current year.
 */

const TODAY = "2026-09-25";

const NATURAL: readonly (readonly [string, string])[] = [
  ["9/11", "2026-09-11"],
  ["9/21", "2026-09-21"],
  ["02/21", "2026-02-21"],
  ["9/11/26", "2026-09-11"],
  ["09/11/2026", "2026-09-11"],
  ["Sep 11", "2026-09-11"],
  ["September 11", "2026-09-11"],
  ["September 11, 2026", "2026-09-11"],
];

describe("extractFormDate", () => {
  it.each(NATURAL)("reads %s as %s", (typed, iso) => {
    expect(extractFormDate(typed, TODAY)).toBe(iso);
    expect(extractFormDate(`3. ${typed}`, TODAY)).toBe(iso);
    expect(extractFormDate(`She was late on ${typed}.`, TODAY)).toBe(iso);
  });

  it("reads the other spellings managers use", () => {
    expect(extractFormDate("Sept. 11th", TODAY)).toBe("2026-09-11");
    expect(extractFormDate("sep 11", TODAY)).toBe("2026-09-11");
    expect(extractFormDate("SEPTEMBER 11 2026", TODAY)).toBe("2026-09-11");
    expect(extractFormDate("2026-09-11", TODAY)).toBe("2026-09-11");
  });

  it("uses the current year when none is given, and a stated year when one is", () => {
    expect(extractFormDate("12/30", "2027-01-04")).toBe("2027-12-30");
    expect(extractFormDate("12/30/26", "2027-01-04")).toBe("2026-12-30");
    expect(extractFormDate("Dec 30, 2026", "2027-01-04")).toBe("2026-12-30");
  });

  it("reads numeric dates as month/day, never day/month", () => {
    expect(extractFormDate("02/03", TODAY)).toBe("2026-02-03");
    expect(extractFormDate("21/02", TODAY)).toBeNull();
  });

  it("ignores what is not a real day", () => {
    expect(extractFormDate("13/40", TODAY)).toBeNull();
    expect(extractFormDate("Feb 30", TODAY)).toBeNull();
    expect(extractFormDate("2/29", "2026-09-25")).toBeNull();
    expect(extractFormDate("2/29", "2028-09-25")).toBe("2028-02-29");
    expect(extractFormDate("1/2/3/4", TODAY)).toBeNull();
  });

  it("leaves words and relative days to the form's default of today", () => {
    expect(extractFormDate("today", TODAY)).toBeNull();
    expect(extractFormDate("She wore slippers yesterday.", TODAY)).toBeNull();
    expect(extractFormDate("", TODAY)).toBeNull();
  });

  it("skips a follow-up date and takes the incident's", () => {
    expect(extractFormDate("Late on 9/11. Follow up the week of October 5.", TODAY)).toBe(
      "2026-09-11",
    );
    expect(extractFormDate("Follow up the week of October 5.", TODAY)).toBeNull();
  });
});

describe("isIsoCalendarDate", () => {
  it("accepts a real YYYY-MM-DD and nothing else", () => {
    expect(isIsoCalendarDate("2026-09-11")).toBe(true);
    expect(isIsoCalendarDate("2026-02-30")).toBe(false);
    expect(isIsoCalendarDate("9/11")).toBe(false);
    expect(isIsoCalendarDate(undefined)).toBe(false);
  });
});

describe("the intakes count every natural shape as the date being given", () => {
  it.each(NATURAL)("%s answers the date question", (typed) => {
    const corrective = readCorrectiveActionIntake({
      text: `3. ${typed}`,
      employeeKnown: true,
      salonSettled: true,
    });
    const epp = readEppIntake({ text: `3. ${typed}`, employeeKnown: true, salonSettled: true });

    expect(corrective.supplied).toContain("form_date");
    expect(epp.supplied).toContain("form_date");
  });
});

/*
 * "we can use todays date" is how the rollout's manager answered, without the
 * apostrophe, and `\btoday\b` does not match inside "todays" — so both intakes
 * asked for the date again. The form keeps its default of today either way;
 * this is only whether the question counts as answered.
 */
describe("\"today\" counts as the date being given, with or without the apostrophe", () => {
  it.each(["we can use todays date", "we can use today's date", "Todays date.", "use today", "today’s date"])(
    "%s",
    (typed) => {
      const corrective = readCorrectiveActionIntake({ text: typed, employeeKnown: true, salonSettled: true });
      const epp = readEppIntake({ text: typed, employeeKnown: true, salonSettled: true });

      expect(corrective.supplied).toContain("form_date");
      expect(epp.supplied).toContain("form_date");
      // Still the default, never a parsed calendar date.
      expect(extractFormDate(typed, "2026-09-28")).toBeNull();
    },
  );

  it("is not read out of a word that only starts the same way", () => {
    const corrective = readCorrectiveActionIntake({ text: "todayish maybe", employeeKnown: true, salonSettled: true });
    expect(corrective.supplied).not.toContain("form_date");
  });
});

describe("a date that belongs to an earlier step is not the form's date", () => {
  const TODAY = "2026-09-29";

  it("skips the date of a prior warning (the production sentence)", () => {
    expect(
      extractFormDate("create ca for rosalyn co she was late today, got verbal warning on september 21", TODAY),
    ).toBeNull();
  });

  it.each([
    "she was coached on 9/2 about this",
    "received a written warning on 8/15",
    "previous corrective action 8/15",
    "she was already written up on 9/1",
  ])("%s -> no form date", (text) => {
    expect(extractFormDate(text, TODAY)).toBeNull();
  });

  it("still takes the incident's date when both are given", () => {
    expect(extractFormDate("she was late on 9/20, got a verbal warning on 9/1", TODAY)).toBe("2026-09-20");
    expect(extractFormDate("got a verbal warning on 9/1. She was late again on 9/20", TODAY)).toBe("2026-09-20");
  });

  it("does not treat an instruction about this form as an earlier step", () => {
    expect(extractFormDate("give her a written warning on 10/2", TODAY)).toBe("2026-10-02");
    expect(extractFormDate("she was late on 9/20", TODAY)).toBe("2026-09-20");
  });
});

describe("the date of the earlier step", () => {
  const TODAY = "2026-09-29";
  it.each([
    ["create ca for Rosalyn Test she was late today, got verbal warning on september 21", "2026-09-21"],
    ["she was coached on 9/2 and received a written warning on 9/15", "2026-09-15"],
    ["she was late on 9/20", null],
    ["give her a written warning on 10/2", null],
    ["verbal warning, first time", null],
  ])("%s -> %s", (text, expected) => {
    expect(priorStepDate(text, TODAY)).toBe(expected);
  });
});

/*
 * District Manager feedback, 21 Oct 2026: history written as a label, its
 * topic, and its date — never a date for the form.
 */
describe("a labelled earlier step is history, wherever its date sits", () => {
  const DAY = "2026-10-21";

  it.each([
    ["previous coaching was jba policy manual 1-1-26", "2026-01-01", "jba policy manual"],
    ["previous coaching - jba policy manual 1-20-26.", "2026-01-20", "jba policy manual"],
    ["no payroll deduct. jba manual 1-1-26 for previous coaching", "2026-01-01", "jba manual"],
    ["prior CA 9/1, late again on 10/20", "2026-09-01", undefined],
  ])("%s", (text, iso, topic) => {
    expect(priorSteps(text, DAY)).toEqual([expect.objectContaining(topic ? { iso, topic } : { iso })]);
    expect(listFormDates(text, DAY).map((found) => found.iso)).not.toContain(iso);
  });

  it("leaves the incident's own date alone", () => {
    const text =
      "create verbal CA for remy calder for violating visitors at work policy on 10-10-26. remy spent 40 minutes talking with a friend and ignoring clients. previous coaching was jba policy manual 1-1-26";
    expect(listFormDates(text, DAY).map((found) => found.iso)).toEqual(["2026-10-10"]);
    expect(extractFormDate(text, DAY)).toBe("2026-10-10");
  });

  it("a request whose only date is the coaching's has no form date", () => {
    expect(
      extractFormDate("create ca for tess varga, she was late for her shift. previous coaching was jba policy manual 1-1-26", DAY),
    ).toBeNull();
  });

  it("stops at an account: a date after the history's topic is the incident's", () => {
    const text = "previous coaching was about lateness and she was late on 10/20";
    expect(priorSteps(text, DAY)).toEqual([]);
    expect(extractFormDate(text, DAY)).toBe("2026-10-20");
  });
});

/*
 * HR, 21 Oct 2026: the history as a LIST under one label. Every item is
 * history — the second ("verbal ca 9-1-26") was handed to the drafting model
 * as one of the manager's dates for the form, and left off the prior actions.
 */
describe("every item of a labelled history list is history", () => {
  const DAY = "2026-10-21";
  const PRODUCTION =
    "create a written CA for tess varga for not attending the monthly meeting on 10-20-26. previous coaching: jba policy manual 1-1-26, verbal ca 9-1-26. payroll deduct not applicable";

  it("the production request: one incident date, two earlier steps", () => {
    expect(listFormDates(PRODUCTION, DAY).map((found) => found.iso)).toEqual(["2026-10-20"]);
    expect(extractFormDate(PRODUCTION, DAY)).toBe("2026-10-20");
    expect(priorSteps(PRODUCTION, DAY)).toEqual([
      expect.objectContaining({ iso: "2026-01-01", topic: "jba policy manual" }),
      expect.objectContaining({ iso: "2026-09-01", topic: "verbal ca" }),
    ]);
  });

  it.each([
    ["previous coaching: verbal ca 9-1-26", ["2026-09-01"]],
    ["prior actions: written warning 8/2/26", ["2026-08-02"]],
    ["previous coaching: policy acknowledgement 1-1-26", ["2026-01-01"]],
    ["previous CA: verbal ca 3/4/26, written warning 8/2/26 and final written 9/9/26", ["2026-03-04", "2026-08-02", "2026-09-09"]],
    ["prior actions - policy acknowledgement 1-1-26, coaching on 2-2-26 & verbal ca 9-1-26", ["2026-01-01", "2026-02-02", "2026-09-01"]],
    ["previous coaching: 1-1-26, 3-5-26", ["2026-01-01", "2026-03-05"]],
    ["prior actions:\n- coaching 1-1-26\n- verbal ca 9-1-26", ["2026-01-01", "2026-09-01"]],
  ])("%s", (text, isos) => {
    expect(priorSteps(text, DAY).map((step) => step.iso)).toEqual(isos);
    expect(listFormDates(text, DAY)).toEqual([]);
  });

  it.each([
    // An account after the list: its date is the incident's.
    ["previous coaching: jba manual 1-1-26, late again on 10/20", "2026-10-20"],
    ["previous coaching: jba manual 1-1-26, and she missed the meeting on 10/20", "2026-10-20"],
    // A new sentence ends the list.
    ["previous coaching: jba manual 1-1-26. missed the meeting 10/20", "2026-10-20"],
    // No colon or dash, no list: only the step right after the label is history.
    ["prior CA 9/1, missed meeting 10/20", "2026-10-20"],
  ])("ends at the list: %s", (text, incident) => {
    expect(extractFormDate(text, DAY)).toBe(incident);
    expect(priorSteps(text, DAY).map((step) => step.iso)).not.toContain(incident);
  });
});

/*
 * QA audit, 22 Oct 2026: a Corrective Action Form's date could not be
 * corrected from the conversation in any wording. These are the corrections
 * it reads — always with the date named as the thing being corrected — and
 * the incident statements it must not mistake for one.
 */
describe("a correction to the form's date", () => {
  const TODAY = "2026-10-21";
  it.each([
    ["change the date to 10-19-26", "2026-10-19"],
    ["change the date of the incident to 10/19/26", "2026-10-19"],
    ["the date was wrong, it happened on 10-19-26", "2026-10-19"],
    ["the date should be October 19", "2026-10-19"],
    ["fix the date on the form, it should be 10/19/26", "2026-10-19"],
    ["it was 10-19-26, not 10-20-26", "2026-10-19"],
    ["update the form date to 2026-10-19", "2026-10-19"],
  ])('"%s" moves it to %s', (text, iso) => {
    expect(formDateChange(text, TODAY)).toBe(iso);
  });

  it.each([
    ["she was late again on 10-19-26"],
    ["what date is on the form?"],
    ["can you change the date to 10-19-26?"],
    ["the deadline was 10-15-26"],
    ["previous coaching was 9-1-26"],
    ["change the payroll deduction to $5.00"],
    ["set the follow-up date to 10/15"],
    ["change the due date to 10-30-26"],
    ["the previous coaching date should be 1-2-26"],
    ["change the date of the previous coaching to 1-2-26"],
    ["change the date of her verbal warning to 9-2-26"],
    ["the date of the prior warning was wrong, it was 9-2-26"],
  ])('"%s" is not a correction to the date', (text) => {
    expect(formDateChange(text, TODAY)).toBeNull();
  });
});

/* A date correction that does not say which date is asked about, never guessed. */
describe("a date correction that does not settle the date", () => {
  const TODAY = "2026-10-21";
  it.each([
    ["the date should be 10-2-26 or 10-3-26", ["2026-10-02", "2026-10-03"]],
    ["change the date to 10/2 or maybe 10/3", ["2026-10-02", "2026-10-03"]],
    ["change the date", []],
    ["the date is wrong", []],
    ["fix the date on the form", []],
  ])('"%s" changes nothing and is asked about', (text, offered) => {
    expect(formDateChange(text, TODAY)).toBeNull();
    expect(formDateChangeUnclear(text, TODAY)).toEqual({ offered });
  });

  it.each([["change the date to 10-2-26"], ["she was late again on 10-19-26"], ["change the due date"], ["what is the date on the form?"]])(
    '"%s" is not an unsettled date correction',
    (text) => {
      expect(formDateChangeUnclear(text, TODAY)).toBeNull();
    },
  );
});

/* Review, 22 Oct 2026: another date, named with "the date", is not the form's. */
describe("a date that is not the form's, named with \"the date\"", () => {
  const TODAY = "2026-10-21";
  it.each([
    ["change the date on the action plan to 11-1-26"],
    ["move the date of the meeting to 10-25-26"],
    ["change the date she was hired to 1-5-24"],
    ["update the date she was told to fix it to 10-15-26"],
  ])('"%s" is not a correction to the form\'s date, and is not asked about', (text) => {
    expect(formDateChange(text, TODAY)).toBeNull();
    expect(formDateChangeUnclear(text, TODAY)).toBeNull();
  });
});
