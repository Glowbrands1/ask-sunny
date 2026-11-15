import { afterEach, describe, expect, it, vi } from "vitest";

/* The first tests pin the zone to Eastern: they test the mechanism with Eastern fixtures. The app's own default is Central (last test). */
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_BUSINESS_TIMEZONE = "America/New_York";
});

import {
  BUSINESS_TIMEZONE,
  businessHour,
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

describe("the hour of the business day", () => {
  it("is the business zone's hour, not UTC's", () => {
    // 2026-09-05T02:00Z is 10pm Eastern on the 4th. UTC would say 2am, which
    // greets a manager who is closing up with "Good morning".
    expect(businessHour(new Date("2026-09-05T02:00:00Z"))).toBe(22);
    expect(businessHour(new Date("2026-09-04T14:00:00Z"))).toBe(10);
  });

  it("reports midnight as 0, not 24", () => {
    // `hour12: false` alone formats midnight as "24" in several locales, which
    // would sort after every evening hour instead of before every morning one.
    expect(businessHour(new Date("2026-09-05T04:00:00Z"))).toBe(0);
  });

  it("follows the daylight-saving offset, like every other date here", () => {
    // 04:30Z is 00:30 Eastern in September and 23:30 the previous day in
    // December.
    expect(businessHour(new Date("2026-09-05T04:30:00Z"))).toBe(0);
    expect(businessHour(new Date("2026-12-05T04:30:00Z"))).toBe(23);
  });

  it("does not depend on the host's timezone", () => {
    const instant = new Date("2026-09-05T02:00:00Z");
    for (const zone of ["UTC", "Pacific/Kiritimati", "Asia/Tokyo"]) {
      process.env.TZ = zone;
      expect(businessHour(instant), zone).toBe(22);
    }
  });
});

describe("a moment as people read it (formatBusinessTime, formatBusinessDay)", () => {
  /* The zone is read once at import, so each case loads the module with the zone it is about. */
  async function loadedIn(zone: string) {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_BUSINESS_TIMEZONE", zone);
    return import("./business-date");
  }
  afterEach(() => vi.unstubAllEnvs());

  it("Central: winter and summer both read CT, never UTC or CST/CDT", async () => {
    const { formatBusinessTime } = await loadedIn("America/Chicago");
    expect(formatBusinessTime("2026-11-14T12:01:00Z")).toBe("Nov 14, 6:01 AM CT");
    expect(formatBusinessTime("2026-07-14T12:01:00Z")).toBe("Jul 14, 7:01 AM CT");
    expect(formatBusinessTime("2026-11-14T12:01:00Z", { year: true })).toBe("Nov 14, 2026, 6:01 AM CT");
  });

  it("a late-evening UTC stamp is still the Central day it happened", async () => {
    const { formatBusinessDay, formatBusinessTime } = await loadedIn("America/Chicago");
    expect(formatBusinessDay("2026-11-15T03:30:00Z")).toBe("Nov 14");
    expect(formatBusinessTime("2026-11-15T03:30:00Z")).toBe("Nov 14, 9:30 PM CT");
  });

  it("another business zone keeps its own label (the label cannot disagree with the zone)", async () => {
    const { formatBusinessTime } = await loadedIn("America/New_York");
    expect(formatBusinessTime("2026-11-14T12:01:00Z")).toBe("Nov 14, 7:01 AM ET");
  });

  it("says nothing for nothing or for a value that is not a moment", async () => {
    const { formatBusinessTime, formatBusinessDay } = await loadedIn("America/Chicago");
    for (const bad of [null, undefined, "", "not a date"]) {
      expect(formatBusinessTime(bad)).toBeNull();
      expect(formatBusinessDay(bad)).toBeNull();
    }
  });

  it("the app's own default zone is Central, so it stays Central if the env var is ever unset", async () => {
    const { BUSINESS_TIMEZONE, formatBusinessTime } = await loadedIn("");
    expect(BUSINESS_TIMEZONE).toBe("America/Chicago");
    expect(formatBusinessTime("2026-11-14T12:01:00Z")).toBe("Nov 14, 6:01 AM CT");
  });
});
