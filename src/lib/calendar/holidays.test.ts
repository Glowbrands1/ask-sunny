import { describe, expect, it } from "vitest";
import { easterSunday, holidaysBetween, holidaysOfYear, holidayTitle, nthWeekday } from "./holidays";

/** The owner, 27 Nov 2026: "can you also add holidays in the calendar in all apps pls US holiday". */
describe("US holidays, worked out in code", () => {
  it("Thanksgiving is the 4th Thursday of November, Black Friday the day after", () => {
    const of = (y: number) => holidaysOfYear(y).filter((h) => h.name === "Thanksgiving" || h.name === "Black Friday").map((h) => [h.name, h.date]);
    expect(of(2026)).toEqual([["Thanksgiving", "2026-11-26"], ["Black Friday", "2026-11-27"]]);
    expect(of(2024)).toEqual([["Thanksgiving", "2024-11-28"], ["Black Friday", "2024-11-29"]]);
    expect(of(2027)).toEqual([["Thanksgiving", "2027-11-25"], ["Black Friday", "2027-11-26"]]);
  });

  it("Easter Sunday", () => {
    expect([2024, 2025, 2026, 2027, 2038].map(easterSunday)).toEqual(["2024-03-31", "2025-04-20", "2026-04-05", "2027-03-28", "2038-04-25"]);
  });

  it("nth and last weekdays: MLK, Presidents', Memorial, Labor, Columbus, Mother's Day", () => {
    expect(nthWeekday(2026, 1, 1, 3)).toBe("2026-01-19");
    expect(nthWeekday(2026, 2, 1, 3)).toBe("2026-02-16");
    expect(nthWeekday(2026, 5, 1, -1)).toBe("2026-05-25");
    expect(nthWeekday(2026, 9, 1, 1)).toBe("2026-09-07");
    expect(nthWeekday(2026, 10, 1, 2)).toBe("2026-10-12");
    expect(nthWeekday(2026, 5, 0, 2)).toBe("2026-05-10");
    expect(nthWeekday(2027, 5, 1, -1)).toBe("2027-05-31");
  });

  it("a fixed-date federal holiday on a weekend is also marked on its observed weekday", () => {
    // Independence Day 2026 is a Saturday: observed Friday Jul 3. Christmas 2027 is a Saturday: observed Friday Dec 24.
    const y26 = holidaysOfYear(2026);
    expect(y26.filter((h) => h.name === "Independence Day").map((h) => [h.date, holidayTitle(h)])).toEqual([["2026-07-03", "Independence Day (observed)"], ["2026-07-04", "Independence Day"]]);
    // Juneteenth 2027 is a Saturday (observed Fri Jun 18); Juneteenth 2022 was a Sunday (observed Mon Jun 20).
    expect(holidaysOfYear(2027).filter((h) => h.name === "Juneteenth").map((h) => h.date)).toEqual(["2027-06-18", "2027-06-19"]);
    expect(holidaysOfYear(2022).filter((h) => h.name === "Juneteenth").map((h) => h.date)).toEqual(["2022-06-19", "2022-06-20"]);
    // Observances are never "observed" on another day.
    expect(holidaysOfYear(2027).filter((h) => h.name === "Christmas Eve").map((h) => h.date)).toEqual(["2027-12-24"]);
  });

  it("New Year's Day on a Saturday is observed on Dec 31 of the year before, across the year end", () => {
    // Jan 1 2028 is a Saturday.
    const end = holidaysBetween("2027-12-01", "2027-12-31");
    expect(end.filter((h) => h.name === "New Year's Day").map((h) => [h.date, holidayTitle(h)])).toEqual([["2027-12-31", "New Year's Day (observed)"]]);
  });

  it("December 2026: the holidays a manager would ask about, federal and observances marked", () => {
    expect(holidaysBetween("2026-12-01", "2026-12-31").map((h) => [h.date, holidayTitle(h)])).toEqual([
      ["2026-12-24", "Christmas Eve (observance)"],
      ["2026-12-25", "Christmas Day"],
      ["2026-12-31", "New Year's Eve (observance)"],
    ]);
  });

  it("the 11 federal holidays, every year", () => {
    expect(new Set(holidaysOfYear(2026).filter((h) => h.kind === "federal").map((h) => h.name)).size).toBe(11);
  });
});
