import { describe, expect, it } from "vitest";

import { readCorrectiveActionIntake } from "./corrective-action-intake";
import { readEppIntake } from "./epp-intake";
import { extractFormDate, isIsoCalendarDate, priorStepDate } from "./form-date-answer";

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
      extractFormDate("create ca for paulyne co she was late today, got verbal warning on september 21", TODAY),
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
    ["create ca for Paulyne Test she was late today, got verbal warning on september 21", "2026-09-21"],
    ["she was coached on 9/2 and received a written warning on 9/15", "2026-09-15"],
    ["she was late on 9/20", null],
    ["give her a written warning on 10/2", null],
    ["verbal warning, first time", null],
  ])("%s -> %s", (text, expected) => {
    expect(priorStepDate(text, TODAY)).toBe(expected);
  });
});
