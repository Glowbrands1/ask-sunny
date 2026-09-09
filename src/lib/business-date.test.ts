import { afterEach, describe, expect, it } from "vitest";

import {
  BUSINESS_TIMEZONE,
  businessToday,
  businessWeekEnd,
  daysBetween,
  shiftDays,
  weekdayOf,
} from "./business-date";

/**
 * THE BUG THIS FILE EXISTS TO PREVENT: a follow-up going overdue in the
 * evening.
 *
 * At 8pm US Eastern the UTC date has already rolled over. A follow-up due
 * tomorrow, judged against `new Date().toISOString().slice(0,10)`, would show
 * as due TODAY that evening and as OVERDUE from 8pm the day it was due — hours
 * before anybody at the salon has finished work. The boundary tests below fail
 * if this module ever starts reading UTC or the host's zone.
 */

const original = process.env.TZ;
afterEach(() => {
  process.env.TZ = original;
});

describe("the business date", () => {
  it("is a US business zone, not UTC", () => {
    expect(BUSINESS_TIMEZONE).not.toBe("UTC");
    expect(BUSINESS_TIMEZONE.startsWith("America/")).toBe(true);
  });

  it("is still the previous day late in the evening, when UTC has already moved on", () => {
    // 2026-09-04T23:30Z is 7:30pm Eastern on the 4th. UTC agrees here...
    expect(businessToday(new Date("2026-09-04T23:30:00Z"))).toBe("2026-09-04");
    // ...and 2026-09-05T02:00Z is 10pm Eastern, STILL the 4th at the salon.
    // A naive UTC slice would say the 5th, and every follow-up due on the 5th
    // would read as due today four hours early.
    expect(new Date("2026-09-05T02:00:00Z").toISOString().slice(0, 10)).toBe("2026-09-05");
    expect(businessToday(new Date("2026-09-05T02:00:00Z"))).toBe("2026-09-04");
  });

  it("rolls over at business midnight, not at UTC midnight", () => {
    // 04:30Z in September is 00:30 Eastern — the new day has started there.
    expect(businessToday(new Date("2026-09-05T04:30:00Z"))).toBe("2026-09-05");
  });

  it("handles the daylight-saving change, because Intl does", () => {
    // Eastern is UTC-4 in summer and UTC-5 in winter; 04:30Z is the 5th in
    // summer and still the 4th in winter. Hard-coded arithmetic gets this
    // wrong twice a year.
    expect(businessToday(new Date("2026-12-05T04:30:00Z"))).toBe("2026-12-04");
  });

  it("does not depend on the host's timezone", () => {
    const instant = new Date("2026-09-05T02:00:00Z");
    for (const zone of ["UTC", "Pacific/Kiritimati", "Pacific/Midway", "Europe/Dublin"]) {
      process.env.TZ = zone;
      expect(businessToday(instant), zone).toBe("2026-09-04");
    }
  });

  it("formats as ISO, so it compares as a string", () => {
    expect(businessToday(new Date("2026-01-02T17:00:00Z"))).toBe("2026-01-02");
    expect("2026-01-02" < "2026-01-10").toBe(true);
  });
});

describe("whole days between dates", () => {
  it("counts forwards and backwards from a date", () => {
    expect(daysBetween("2026-09-04", "2026-09-05")).toBe(1);
    expect(daysBetween("2026-09-04", "2026-09-03")).toBe(-1);
    expect(daysBetween("2026-09-04", "2026-09-04")).toBe(0);
  });

  it("crosses a month, a year and a daylight-saving change cleanly", () => {
    expect(daysBetween("2026-08-31", "2026-09-01")).toBe(1);
    expect(daysBetween("2026-12-31", "2027-01-01")).toBe(1);
    // The US clocks change on 2026-11-01; these are calendar dates, so the
    // count must not gain or lose an hour's worth of rounding.
    expect(daysBetween("2026-10-31", "2026-11-02")).toBe(2);
  });

  it("does not depend on the host's timezone either", () => {
    for (const zone of ["Pacific/Kiritimati", "Pacific/Midway"]) {
      process.env.TZ = zone;
      expect(daysBetween("2026-09-04", "2026-09-05"), zone).toBe(1);
    }
  });
});

describe("the business week", () => {
  /*
   * SUNDAY TO SATURDAY — the US retail week. "Due this week" on the Overview
   * means "before the weekend", so which day ends the week decides whether
   * next Monday's follow-up is counted today.
   */
  it("ends on the Saturday of the week containing the date", () => {
    expect(weekdayOf("2026-09-04")).toBe(5); // a Friday
    expect(businessWeekEnd("2026-09-04")).toBe("2026-09-05");
  });

  it("is the same day when the date is already Saturday", () => {
    expect(businessWeekEnd("2026-09-05")).toBe("2026-09-05");
  });

  it("reaches the whole week from a Sunday", () => {
    expect(weekdayOf("2026-09-06")).toBe(0);
    expect(businessWeekEnd("2026-09-06")).toBe("2026-09-12");
  });

  it("shifts days across a month boundary", () => {
    expect(shiftDays("2026-08-31", 1)).toBe("2026-09-01");
    expect(shiftDays("2026-09-01", -1)).toBe("2026-08-31");
  });
});
