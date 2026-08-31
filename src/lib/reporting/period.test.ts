import { describe, expect, it } from "vitest";

import { isReportParseError } from "./errors";
import { detectPeriod, parseMarkerDate, periodFromMarker } from "./period";
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
