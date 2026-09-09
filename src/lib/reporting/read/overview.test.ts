import { describe, expect, it } from "vitest";

import {
  formatCompPeriodLabel,
  formatSalesTotalsPeriodLabel,
  formatUpdatedLabel,
} from "./overview";

/**
 * The homepage overview's own surface is deliberately tiny: it delegates every
 * figure to the report layer, so the only logic worth testing here is the part
 * it does NOT delegate — how a period and a freshness stamp are worded.
 *
 * Both matter more than their size suggests. The whole point of this card is
 * that no figure is ever shown under the wrong window, and the label is what
 * carries that.
 */
describe("formatCompPeriodLabel", () => {
  it("reads a year-to-date period as its month and year", () => {
    // The workbook writes `YTD 08 2026`, which is analyst shorthand.
    expect(formatCompPeriodLabel("ytd", "2026-08-31", "YTD 08 2026")).toBe("YTD Aug 2026");
  });

  it("keeps the day for a month-to-date period, which is a partial month", () => {
    // `MTD Aug 2026` would read as the whole of August. It is not: this report
    // covers the 1st through the 30th, and the day is the difference.
    expect(formatCompPeriodLabel("mtd", "2026-08-30", "MTD 08/30/2026")).toBe(
      "MTD Aug 30, 2026",
    );
  });

  it("falls back to the source's own label rather than guessing", () => {
    // A period end that will not parse must not produce an invented month.
    expect(formatCompPeriodLabel("ytd", "not-a-date", "YTD 08 2026")).toBe("YTD 08 2026");
    expect(formatCompPeriodLabel("ytd", "2026-99-31", "YTD 99 2026")).toBe("YTD 99 2026");
  });
});

describe("formatUpdatedLabel", () => {
  it("gives a date, never a raw UTC timestamp", () => {
    expect(formatUpdatedLabel("2026-09-08T13:04:14.618150+00:00")).toBe("Sep 8, 2026");
  });

  it("reads the instant in UTC, so the label does not depend on the host", () => {
    // 00:30 UTC is still the 8th. A host in UTC-7 would call it the 7th, and
    // then two servers would disagree about when the report landed.
    expect(formatUpdatedLabel("2026-09-08T00:30:00Z")).toBe("Sep 8, 2026");
  });

  it("returns null for an unparseable instant rather than `Invalid Date`", () => {
    expect(formatUpdatedLabel("whenever")).toBeNull();
  });
});

describe("formatSalesTotalsPeriodLabel", () => {
  it("names the month the cumulative window belongs to", () => {
    expect(formatSalesTotalsPeriodLabel("2026-09-01")).toBe("MTD Sep 2026");
  });

  it("degrades to a plain window name rather than inventing a month", () => {
    expect(formatSalesTotalsPeriodLabel("")).toBe("Month to date");
    expect(formatSalesTotalsPeriodLabel("2026-13-01")).toBe("Month to date");
  });
});
