import { describe, expect, it } from "vitest";

import {
  CADENCE_LABEL,
  REPORTING_TIME_ZONE,
  formatDataThrough,
  formatRefreshedAt,
  formatSalonCount,
  freshnessLine,
  monthlyCurrency,
  freshnessSegments,
} from "./freshness-line";

/**
 * The 14 September review asked for one line on every report:
 *
 *   Data through September 12, 2026 | Refreshed September 13 at 6:00 a.m. CT |
 *   15 salons included | Updated daily
 *
 * and for Central Time throughout: "Salon Performance currently reads 'Loaded
 * Sep 11, 2026, 12:50 PM UTC', which is 7:50 a.m. our time."
 */

describe("the line matches the requested format", () => {
  it("assembles all four segments in order", () => {
    expect(
      freshnessLine({
        dataThrough: "2026-09-12",
        // 6:00 a.m. Central on 13 September is 11:00 UTC (CDT, UTC-5).
        refreshedAt: "2026-09-13T11:00:00Z",
        salonCount: 15,
        cadence: "daily",
      }),
    ).toBe(
      "Data through September 12, 2026 | Refreshed September 13 at 6:00 a.m. CT | 15 salons included | Updated daily",
    );
  });

  it("carries the report's own cadence", () => {
    const facts = {
      dataThrough: "2026-08-31",
      refreshedAt: "2026-09-01T11:00:00Z",
      salonCount: 15,
    } as const;
    expect(freshnessLine({ ...facts, cadence: "monthly" })).toContain("Updated monthly");
    expect(freshnessLine({ ...facts, cadence: "weekly" })).toContain("Updated weekly");
    expect(CADENCE_LABEL.daily).toBe("Updated daily");
  });
});

describe("times are Central, through the zone rather than an offset", () => {
  it("uses the IANA zone", () => {
    expect(REPORTING_TIME_ZONE).toBe("America/Chicago");
  });

  it("converts the review's own example correctly", () => {
    // "Loaded Sep 11, 2026, 12:50 PM UTC, which is 7:50 a.m. our time."
    expect(formatRefreshedAt("2026-09-11T12:50:00Z")).toBe("September 11 at 7:50 a.m. CT");
  });

  it("handles daylight saving in both directions", () => {
    /*
     * THE REASON A FIXED OFFSET IS REFUSED. Central is UTC-5 in summer and
     * UTC-6 in winter; subtracting six hours all year renders a summer 6:00
     * a.m. delivery as 5:00 a.m. — an hour before it happened.
     */
    // July: CDT, UTC-5. 11:00 UTC is 6:00 a.m.
    expect(formatRefreshedAt("2026-07-13T11:00:00Z")).toBe("July 13 at 6:00 a.m. CT");
    // January: CST, UTC-6. 12:00 UTC is 6:00 a.m.
    expect(formatRefreshedAt("2026-01-13T12:00:00Z")).toBe("January 13 at 6:00 a.m. CT");
    // And the same instant in January is NOT 5:00 a.m.
    expect(formatRefreshedAt("2026-01-13T12:00:00Z")).not.toContain("5:00");
  });

  it("crosses midnight the right way", () => {
    // 02:00 UTC on the 14th is 9:00 p.m. Central on the 13th.
    expect(formatRefreshedAt("2026-09-14T02:00:00Z")).toBe("September 13 at 9:00 p.m. CT");
  });

  it("writes a.m. and p.m. the way a manager reads them", () => {
    expect(formatRefreshedAt("2026-09-13T11:00:00Z")).toContain("a.m.");
    expect(formatRefreshedAt("2026-09-13T23:00:00Z")).toContain("p.m.");
    expect(formatRefreshedAt("2026-09-13T11:00:00Z")).not.toContain("AM");
  });

  it("shows no UTC anywhere", () => {
    const line = freshnessLine({
      dataThrough: "2026-09-12",
      refreshedAt: "2026-09-13T11:00:00Z",
      salonCount: 15,
      cadence: "daily",
    });
    expect(line).not.toContain("UTC");
    expect(line).toContain("CT");
  });

  it("says Refreshed, never Loaded", () => {
    const line = freshnessLine({
      dataThrough: "2026-09-12",
      refreshedAt: "2026-09-13T11:00:00Z",
      salonCount: 15,
      cadence: "daily",
    });
    expect(line).toContain("Refreshed");
    expect(line).not.toMatch(/\bLoaded\b/);
  });
});

describe("a data-through date is a calendar date and never moves", () => {
  it("renders the date the source wrote", () => {
    expect(formatDataThrough("2026-09-12")).toBe("September 12, 2026");
    expect(formatDataThrough("2026-01-01")).toBe("January 1, 2026");
    expect(formatDataThrough("2026-12-31")).toBe("December 31, 2026");
  });

  it("does not shift a day through a timezone conversion", () => {
    /*
     * `new Date("2026-09-01")` is midnight UTC, which is 7 p.m. Central on
     * 31 August. A data-through date rendered through a zone would read as the
     * previous month on every first of the month.
     */
    expect(formatDataThrough("2026-09-01")).toBe("September 1, 2026");
    expect(formatDataThrough("2026-09-01")).not.toContain("August");
  });

  it("returns null rather than guessing for an unusable value", () => {
    expect(formatDataThrough(null)).toBeNull();
    expect(formatDataThrough("")).toBeNull();
    expect(formatDataThrough("not a date")).toBeNull();
    expect(formatDataThrough("2026-13-01")).toBeNull();
  });
});

describe("the salon count is counted, and says whose salons when scoped", () => {
  it("reads as the review asked", () => {
    expect(formatSalonCount(15)).toBe("15 salons included");
    expect(formatSalonCount(1)).toBe("1 salon included");
  });

  it("names the assignment for a restricted reader", () => {
    expect(formatSalonCount(1, "MO Kansas City Wornall")).toBe(
      "MO Kansas City Wornall · 1 salon",
    );
  });

  it("shows nothing rather than a zero it cannot vouch for", () => {
    expect(formatSalonCount(null)).toBeNull();
    expect(formatSalonCount(-1)).toBeNull();
    // Zero IS a real answer and is shown: no salon reported this delivery.
    expect(formatSalonCount(0)).toBe("0 salons included");
  });
});

describe("a segment with nothing behind it is omitted, not filled", () => {
  it("drops the refresh stamp when none was recorded", () => {
    const segments = freshnessSegments({
      dataThrough: "2026-09-12",
      refreshedAt: null,
      salonCount: 15,
      cadence: "daily",
    });
    expect(segments).toEqual([
      "Data through September 12, 2026",
      "15 salons included",
      "Updated daily",
    ]);
    expect(segments.join(" ")).not.toContain("Refreshed");
  });

  it("still states the cadence when everything else is missing", () => {
    expect(
      freshnessSegments({
        dataThrough: null,
        refreshedAt: null,
        salonCount: null,
        cadence: "monthly",
      }),
    ).toEqual(["Updated monthly"]);
  });

  it("never contains an empty or dangling segment", () => {
    const line = freshnessLine({
      dataThrough: null,
      refreshedAt: "not an instant",
      salonCount: null,
      cadence: "weekly",
    });
    expect(line).toBe("Updated weekly");
    expect(line).not.toContain("| |");
    expect(line).not.toMatch(/\|\s*$/);
  });
});

describe("no example date from the review is hard-coded", () => {
  it("holds no date as a value, only in the comments that explain the format", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("src/lib/reporting/read/freshness-line.ts", "utf8");

    /*
     * Comments are stripped before the check. The review's example dates SHOULD
     * appear in the header — that is where the requested format is recorded and
     * where the day-shift trap is explained — and must not appear in the code,
     * where they would be a fixture pretending to be a measurement.
     */
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");

    expect(code).not.toMatch(/\b20\d\d\b/);
    /*
     * `September` DOES appear in the code, in the month-name table that renders
     * a calendar date without a Date object. That is a lookup table, not a
     * fixture — so what is asserted is that no month name is paired with a day
     * and a year, which is what a hard-coded example date would look like.
     */
    expect(code).not.toMatch(/September \d/);
  });
});

describe("is this the most recently completed month, or is one missing", () => {
  /*
   * The review, on Bed Usage: "Clearly identify whether the data is current
   * through the most recently completed month so managers do not assume it is
   * outdated." And: "there is no way for a manager to know whether August data
   * on Bed Usage is stale or whether August is simply the most recently
   * released report."
   */
  it("calls the newest completed month current, not stale", () => {
    // Read on 14 September, the August report IS the newest month.
    const reading = monthlyCurrency("2026-08-31", "2026-09-14");
    expect(reading.state).toBe("current");
    expect(reading.monthsBehind).toBe(0);
    expect(reading.note).toMatch(/most recently completed month/i);
  });

  it("says how many deliveries are missing when one is", () => {
    // Read on 14 September with only July loaded: August never arrived.
    const reading = monthlyCurrency("2026-07-31", "2026-09-14");
    expect(reading.state).toBe("behind");
    expect(reading.monthsBehind).toBe(1);
    expect(reading.note).toContain("August 2026");
    expect(reading.note).toMatch(/one delivery has not arrived/i);
  });

  it("counts several missing deliveries", () => {
    const reading = monthlyCurrency("2026-05-31", "2026-09-14");
    expect(reading.monthsBehind).toBe(3);
    expect(reading.note).toMatch(/3 deliveries have not arrived/i);
  });

  it("crosses a year boundary correctly", () => {
    // Read on 3 January, the December report is the newest month.
    expect(monthlyCurrency("2026-12-31", "2027-01-03").state).toBe("current");
    // And November is one behind.
    const behind = monthlyCurrency("2026-11-30", "2027-01-03");
    expect(behind.state).toBe("behind");
    expect(behind.monthsBehind).toBe(1);
    expect(behind.note).toContain("December 2026");
  });

  it("handles February's length rather than assuming 30 or 31", () => {
    expect(monthlyCurrency("2026-02-28", "2026-03-10").state).toBe("current");
    // 2028 is a leap year.
    expect(monthlyCurrency("2028-02-29", "2028-03-10").state).toBe("current");
  });

  it("does not call a PARTIAL month behind", () => {
    /*
     * A month-to-date window ending on the 12th is exactly what it says it is.
     * Reporting it as a missing delivery would report a working report as
     * broken.
     */
    expect(monthlyCurrency("2026-09-12", "2026-09-14").state).toBe("not_applicable");
    expect(monthlyCurrency("2026-08-15", "2026-09-14").state).toBe("not_applicable");
  });

  it("says nothing it cannot establish", () => {
    expect(monthlyCurrency(null, "2026-09-14").state).toBe("not_applicable");
    expect(monthlyCurrency("2026-08-31", "not a date").state).toBe("not_applicable");
    expect(monthlyCurrency("2026-08-31", "not a date").note).toBeNull();
  });

  it("does not guess WHY a delivery is missing", () => {
    const note = monthlyCurrency("2026-07-31", "2026-09-14").note!;
    expect(note).not.toMatch(/late|delayed|failed|error/i);
  });
});
