import { describe, expect, it } from "vitest";

import { isReportParseError } from "./errors";
import { detectPeriod, parseMarkerDate, parseMonthMarker, periodFromMarker } from "./period";
import { sheetViewFromGrid } from "./workbook";

describe("parseMarkerDate", () => {
  it("reads the documented MTD text form", () => {
    expect(parseMarkerDate("MTD 08/30/2026")).toBe("2026-08-30");
  });

  it("reads the other unambiguous forms", () => {
    expect(parseMarkerDate("8-30-2026")).toBe("2026-08-30");
    expect(parseMarkerDate("2026-08-30")).toBe("2026-08-30");
    expect(parseMarkerDate("August 30, 2026")).toBe("2026-08-30");
    expect(parseMarkerDate("30 August 2026")).toBe("2026-08-30");
    expect(parseMarkerDate("Aug. 30, 2026")).toBe("2026-08-30");
  });

  it("refuses forms that would require a guess", () => {
    expect(parseMarkerDate("MTD 08/30/26")).toBeNull();
    expect(parseMarkerDate("August 2026")).toBeNull();
    expect(parseMarkerDate("Period 8")).toBeNull();
    expect(parseMarkerDate("")).toBeNull();
    expect(parseMarkerDate("MTD 02/30/2026")).toBeNull();
  });

  it("is deterministic and never consults the clock", () => {
    // Two calls, and a form that carries no date at all, must agree that there
    // is nothing to read — rather than quietly becoming "now".
    expect(parseMarkerDate("no date here")).toBeNull();
    expect(parseMarkerDate("no date here")).toBeNull();
  });
});

describe("periodFromMarker", () => {
  it("derives the month-to-date window from the as-of date", () => {
    const period = periodFromMarker("MTD 08/30/2026", "mtd");
    expect(period).toEqual({
      grain: "mtd",
      periodEnd: "2026-08-30",
      // First of the month, NOT the month end: the as-of date is mid-month.
      periodStart: "2026-08-01",
      fiscalYear: 2026,
      labelRaw: "MTD 08/30/2026",
    });
  });

  it("derives the year-to-date window from 1 January", () => {
    const period = periodFromMarker("YTD 08/30/2026", "ytd");
    expect(period?.periodStart).toBe("2026-01-01");
    expect(period?.periodEnd).toBe("2026-08-30");
  });

  it("keeps the label verbatim so a disputed period can be checked", () => {
    expect(periodFromMarker("  MTD   08/30/2026 ", "mtd")?.labelRaw).toBe("MTD 08/30/2026");
  });

  it("throws when the marker's grain contradicts the parser's", () => {
    expect(() => periodFromMarker("YTD 08/30/2026", "mtd")).toThrow(/YTD/);
    try {
      periodFromMarker("YTD 08/30/2026", "mtd");
    } catch (error) {
      expect(isReportParseError(error) && error.code).toBe("period_unreadable");
    }
  });

  it("satisfies the schema's fiscal-year check by construction", () => {
    const period = periodFromMarker("MTD 01/15/2027", "mtd");
    expect(period?.fiscalYear).toBe(Number(period?.periodEnd.slice(0, 4)));
  });
});

describe("detectPeriod", () => {
  const headerRow = 3;

  it("prefers the documented F1 cell", () => {
    const sheet = sheetViewFromGrid("s", [
      [null, null, null, null, null, "MTD 08/30/2026"],
      [],
      ["Salon Number"],
    ]);
    const found = detectPeriod(sheet, { headerRow, expectedGrain: "mtd" });
    expect(found.cell).toBe("F1");
    expect(found.period.periodEnd).toBe("2026-08-30");
  });

  it("finds a marker elsewhere in the header band", () => {
    const sheet = sheetViewFromGrid("s", [
      ["Title", null, "MTD 08/30/2026"],
      [],
      ["Salon Number"],
    ]);
    expect(detectPeriod(sheet, { headerRow, expectedGrain: "mtd" }).cell).toBe("C1");
  });

  it("throws rather than defaulting when no marker exists", () => {
    const sheet = sheetViewFromGrid("s", [["Title"], [], ["Salon Number"]]);
    expect(() => detectPeriod(sheet, { headerRow, expectedGrain: "mtd" })).toThrow(
      /No reporting period/,
    );
  });

  it("refuses to choose between two different periods", () => {
    const sheet = sheetViewFromGrid("s", [
      ["MTD 08/30/2026", null, "MTD 07/31/2026"],
      [],
      ["Salon Number"],
    ]);
    expect(() => detectPeriod(sheet, { headerRow, expectedGrain: "mtd" })).toThrow(
      /more than one reporting period/,
    );
  });

  it("tolerates the same period stated twice", () => {
    const sheet = sheetViewFromGrid("s", [
      ["MTD 08/30/2026", null, "MTD 08/30/2026"],
      [],
      ["Salon Number"],
    ]);
    expect(detectPeriod(sheet, { headerRow, expectedGrain: "mtd" }).period.periodEnd).toBe(
      "2026-08-30",
    );
  });

  it("does not depend on the host timezone", () => {
    // Components are assembled with Date.UTC, so no offset can shift the day.
    const sheet = sheetViewFromGrid("s", [
      [null, null, null, null, null, "MTD 01/01/2026"],
      [],
      ["Salon Number"],
    ]);
    const original = process.env.TZ;
    try {
      process.env.TZ = "Pacific/Kiritimati"; // UTC+14
      expect(detectPeriod(sheet, { headerRow, expectedGrain: "mtd" }).period.periodEnd).toBe(
        "2026-01-01",
      );
      process.env.TZ = "Pacific/Midway"; // UTC-11
      expect(detectPeriod(sheet, { headerRow, expectedGrain: "mtd" }).period.periodEnd).toBe(
        "2026-01-01",
      );
    } finally {
      process.env.TZ = original;
    }
  });
});

describe("month-precision markers", () => {
  /**
   * The year-to-date sheet states `YTD 07 2026` — a month and a year, no day,
   * because a year-to-date figure accumulates whole months. Before this form
   * existed the marker simply did not parse and the sheet was unreadable.
   */
  it("reads a numeric month and year as the END of that month", () => {
    expect(parseMonthMarker("YTD 07 2026")).toBe("2026-07-31");
    expect(parseMonthMarker("YTD 02 2024")).toBe("2024-02-29"); // leap year
    expect(parseMonthMarker("YTD 02 2026")).toBe("2026-02-28");
    expect(parseMonthMarker("YTD 12 2026")).toBe("2026-12-31");
  });

  it("reads a named month and year the same way", () => {
    expect(parseMonthMarker("July 2026")).toBe("2026-07-31");
    expect(parseMonthMarker("Feb 2026")).toBe("2026-02-28");
  });

  it("never shadows a day-precise date", () => {
    // `08/30/2026` contains `30 2026`, which a looser reading would take for a
    // month and a year. A marker carrying a full date is not a month marker.
    expect(parseMonthMarker("MTD 08/30/2026")).toBeNull();
    expect(parseMonthMarker("2026-08-30")).toBeNull();
    expect(parseMonthMarker("August 30, 2026")).toBeNull();
    // ...and the day-precise reading is unchanged.
    expect(parseMarkerDate("MTD 08/30/2026")).toBe("2026-08-30");
  });

  it("refuses a month outside 1-12 rather than rolling into the next year", () => {
    expect(parseMonthMarker("YTD 13 2026")).toBeNull();
    expect(parseMonthMarker("YTD 00 2026")).toBeNull();
  });

  it("stays refused for a month-to-date parser, where a bare month IS a guess", () => {
    // The MTD marker is a RUN DATE — the 30th, not the month end — so a bare
    // month leaves it unknown whether the month is complete. Only grains that
    // accumulate whole months accept this form.
    expect(periodFromMarker("August 2026", "mtd")).toBeNull();
    expect(periodFromMarker("August 2026", "ytd")).toMatchObject({
      periodEnd: "2026-08-31",
    });
  });

  it("builds a year-to-date period that starts on 1 January", () => {
    const period = periodFromMarker("YTD 07 2026", "ytd");
    expect(period).toMatchObject({
      grain: "ytd",
      periodStart: "2026-01-01",
      periodEnd: "2026-07-31",
      fiscalYear: 2026,
      labelRaw: "YTD 07 2026",
    });
  });

  it("gives a month-to-date parser nothing from a year-to-date marker", () => {
    // Null, not a throw, and the ordering behind that is deliberate: the grain
    // check runs only on text that already parsed as a date. The month-to-date
    // sheet's row 1 contains headers like "OTC Revenue YTD", and a grain check
    // that fired before the date parse would reject the sheet over a column
    // heading. A sheet whose only marker is unreadable still fails closed —
    // `detectPeriod` finds nothing and raises `period_unreadable`.
    expect(periodFromMarker("YTD 07 2026", "mtd")).toBeNull();
    expect(periodFromMarker("OTC Revenue YTD", "mtd")).toBeNull();
  });

  it("refuses a month-to-date marker offered to a year-to-date parser", () => {
    // This direction DOES throw, because the text parses as a date and then
    // states a grain that disagrees. Filing month-to-date figures under a
    // year-to-date period is the single worst thing this module could do.
    expect(() => periodFromMarker("MTD 08/30/2026", "ytd")).toThrow(/MTD/);
  });
});
