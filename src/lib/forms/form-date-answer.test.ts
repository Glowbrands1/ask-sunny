import { describe, expect, it } from "vitest";

import { readCorrectiveActionIntake } from "./corrective-action-intake";
import { readEppIntake } from "./epp-intake";
import { extractFormDate, isIsoCalendarDate } from "./form-date-answer";

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
