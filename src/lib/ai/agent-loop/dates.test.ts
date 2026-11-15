import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { isoDate, readDates, sameDate } = await import("./dates");
const { accountMissing, incidentDates, monthDayToIso } = await import("./tools");

afterEach(() => vi.useRealTimers());

/* Batch E (E13, Pau's review via QA): a month/day is read against the salon's local date, never the server's UTC clock. */
describe("a month/day as the card's date", () => {
  it("is this year's when it is not after today", () => {
    expect(monthDayToIso("11/4", "2026-11-14")).toBe("2026-11-04");
    expect(monthDayToIso("11/14", "2026-11-14")).toBe("2026-11-14");
  });
  it("is last year's when it is later in the year than today", () => {
    expect(monthDayToIso("12/20", "2026-11-14")).toBe("2025-12-20");
  });
  it("on the evening of 11/14 in the salon's time zone, when UTC is already 11/15, tomorrow's month/day is last year's", () => {
    vi.setSystemTime(new Date("2026-11-15T04:30:00Z"));
    expect(monthDayToIso("11/15", "2026-11-14")).toBe("2025-11-15");
  });
});

/* QA (Pau: "yes its CT"; production sets NEXT_PUBLIC_BUSINESS_TIMEZONE=America/Chicago): 05:30Z on 11/15 is still 11/14 in Central. */
describe("with the salon's time zone set to America/Chicago", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });
  it("at 05:30Z on 11/15, today is 11/14 and \"11/15\" is last year's, never this year's", async () => {
    vi.stubEnv("NEXT_PUBLIC_BUSINESS_TIMEZONE", "America/Chicago");
    vi.resetModules();
    const { businessToday } = await import("@/lib/business-date");
    const today = businessToday(new Date("2026-11-15T05:30:00Z"));
    expect(today).toBe("2026-11-14");
    expect(monthDayToIso("11/15", today)).toBe("2025-11-15");
    expect(isoDate("11/15/2026", today)! > today, "a full 11/15/2026 is after today, so the card refuses it").toBe(true);
  });
});

/* Batch E (E14, Pau via QA): one reader for every date style; two dates match when month and day (and year, when both have one) do. */
describe("one date reader for every style", () => {
  const JUNE_11 = ["6/11", "6-11", "on 6.11", "06/11/2026", "6/11/26", "6.11.26", "June 11", "Jun 11", "june 11th", "11 June", "the 11th of June", "June 11, 2026", "11th of June 2026"];
  it.each(JUNE_11)("reads %s as June 11", (text) => {
    const [date] = readDates(`late on ${text} again`.replace("on on", "on"));
    expect(date, text).toBeTruthy();
    expect([date!.month, date!.day]).toEqual([6, 11]);
  });
  it("matches every style against every other style", () => {
    for (const a of JUNE_11) {
      for (const b of JUNE_11) {
        const [x] = readDates(a);
        const [y] = readDates(b);
        expect(sameDate(x!, y!), `${a} vs ${b}`).toBe(true);
      }
    }
  });
  it("reads Sept 28 and September 28, 2026 as the same day as 9-28-26", () => {
    const [short] = readDates("9-28-26");
    for (const text of ["Sept 28", "September 28, 2026", "sep 28th"]) expect(sameDate(short!, readDates(text)[0]!), text).toBe(true);
  });
  it("tells different years apart only when both have one", () => {
    expect(sameDate(readDates("6/11/25")[0]!, readDates("June 11, 2026")[0]!)).toBe(false);
    expect(sameDate(readDates("6/11/25")[0]!, readDates("June 11")[0]!)).toBe(true);
  });
  it("never reads a decimal, a time, an amount, a weekday or a word as a date", () => {
    for (const text of ["4.5 hours", "$6.11", "10:40am", "on Monday", "yesterday", "last night", "146 tans", "at 3 pm"]) {
      expect(readDates(text), text).toEqual([]);
    }
  });
  it("reads a form date in any style as ISO", () => {
    expect(isoDate("2026-12-20", "2026-11-14")).toBe("2026-12-20");
    expect(isoDate("12/20/2026", "2026-11-14")).toBe("2026-12-20");
    expect(isoDate("December 20, 2026", "2026-11-14")).toBe("2026-12-20");
    expect(isoDate("December 20", "2026-11-14")).toBe("2025-12-20");
  });
});

describe("the account check and the incident dates read every style", () => {
  it("Pau's case: \"9-28-26\" with an account that says \"September 28, 2026\" leaves nothing out", () => {
    expect(accountMissing("create a ca for Wren Ashby, she was a no call no show on 9-28-26", "Wren Ashby was a no call no show on September 28, 2026.")).toEqual([]);
  });
  it("\"june 11\" is a date: kept by 6/11, and missing when the account drops it", () => {
    expect(accountMissing("she was late on june 11", "She was late on 6/11.")).toEqual([]);
    expect(accountMissing("she was late on june 11", "She was late.")).toEqual(["june 11"]);
  });
  it("incidentDates counts \"june 11\" and \"6/20\" as two days, and \"June 11\" with \"6/11\" as one", () => {
    expect(incidentDates("late on june 11 and again on 6/20", null)).toEqual(["6/11", "6/20"]);
    expect(incidentDates("late on June 11 (6/11)", null)).toEqual(["6/11"]);
  });
});

/* QA's batch J review (NO-GO 2, 15 Nov 2026): an ISO date's time suffix never changes its year. */
describe("isoDate with a time", () => {
  it("2026-12-20T00:00 is 2026-12-20, never last year's 12/20", async () => {
    const { isoDate } = await import("./dates");
    expect(isoDate("2026-12-20T00:00", "2026-11-15")).toBe("2026-12-20");
    expect(isoDate("2026-12-20T00:00:00Z", "2026-11-15")).toBe("2026-12-20");
    expect(isoDate("2026-11-12 09:30", "2026-11-15")).toBe("2026-11-12");
    expect(isoDate("2026-11-12", "2026-11-15")).toBe("2026-11-12");
  });
});
