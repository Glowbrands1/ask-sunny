import { describe, expect, it } from "vitest";

import {
  formatBedSpaDate,
  formatLoadedAt,
  matchingPeriod,
  parsePeriodToken,
  periodLabel,
  periodToken,
  resolvePeriod,
  type BedSpaPeriodOption,
} from "./period-token";
import type { BedSpaPeriod } from "./types";

/**
 * PERIOD IDENTITY.
 *
 * The whole reason this module exists is that MTD, YTD and LTM through
 * 31 August are three periods ending on the same day, covering one month,
 * eight months and twelve months of sessions. Everything below is about not
 * confusing them.
 */

function option(
  grain: "mtd" | "ytd" | "ltm",
  periodStart: string,
  periodEnd: string,
): BedSpaPeriodOption {
  return {
    periodId: `${grain}-${periodEnd}`,
    grain,
    periodStart,
    periodEnd,
    labelRaw: "Invented",
    label: periodLabel(grain, periodStart, periodEnd),
    ingestedAt: "2026-09-08T10:24:00.000Z",
    salonCount: 15,
  };
}

const AUGUST_MTD = option("mtd", "2026-08-01", "2026-08-31");
const AUGUST_YTD = option("ytd", "2026-01-01", "2026-08-31");
const AUGUST_LTM = option("ltm", "2025-08-31", "2026-08-31");
const JULY_MTD = option("mtd", "2026-07-01", "2026-07-31");

describe("the period token", () => {
  it("carries the grain, not just the date", () => {
    expect(periodToken(AUGUST_MTD)).toBe("mtd:2026-08-31");
    expect(periodToken(AUGUST_YTD)).toBe("ytd:2026-08-31");
    // Same date, different token. A bare date would name one at random.
    expect(periodToken(AUGUST_MTD)).not.toBe(periodToken(AUGUST_YTD));
  });

  it("parses a qualified token", () => {
    expect(parsePeriodToken("ltm:2026-08-31")).toEqual({
      grain: "ltm",
      periodEnd: "2026-08-31",
    });
    expect(parsePeriodToken("MTD:2026-08-31")).toEqual({
      grain: "mtd",
      periodEnd: "2026-08-31",
    });
  });

  it("refuses a bare date and an unknown grain", () => {
    expect(parsePeriodToken("2026-08-31")).toBeNull();
    expect(parsePeriodToken("weekly:2026-08-31")).toBeNull();
    expect(parsePeriodToken("mtd:31-08-2026")).toBeNull();
    expect(parsePeriodToken(null)).toBeNull();
    expect(parsePeriodToken("")).toBeNull();
  });
});

describe("period labels", () => {
  it("names both ends for LTM, so it cannot be mistaken for that month", () => {
    // "LTM · Aug 2026" would look identical to the month's own MTD row in a
    // dropdown while covering twelve times as much.
    expect(periodLabel("mtd", "2026-08-01", "2026-08-31")).toBe("MTD · Aug 2026");
    expect(periodLabel("ytd", "2026-01-01", "2026-08-31")).toBe("YTD · Aug 2026");
    expect(periodLabel("ltm", "2025-08-31", "2026-08-31")).toBe(
      "LTM · Aug 2025 – Aug 2026",
    );
  });

  it("formats dates in UTC, so the day never shifts", () => {
    expect(formatBedSpaDate("2026-08-31")).toBe("Aug 31, 2026");
    expect(formatBedSpaDate("2026-01-01")).toBe("Jan 1, 2026");
  });

  it("formats the stored load time in UTC", () => {
    expect(formatLoadedAt("2026-09-08T10:24:00.000Z")).toBe("Sep 8, 2026 10:24 UTC");
  });

  it("says so rather than inventing a load time", () => {
    // A "loaded" time that moves when the page is refreshed is not a
    // provenance claim.
    expect(formatLoadedAt(null)).toBe("load time not recorded");
    expect(formatLoadedAt("not a date")).toBe("load time not recorded");
  });
});

describe("resolving the period a link asked for", () => {
  const options = [AUGUST_MTD, AUGUST_YTD, AUGUST_LTM, JULY_MTD];

  it("finds the exact period, grain and all", () => {
    expect(resolvePeriod("ytd:2026-08-31", options)).toEqual({
      period: AUGUST_YTD,
      fellBack: false,
    });
    expect(resolvePeriod("ltm:2026-08-31", options).period).toBe(AUGUST_LTM);
  });

  it("falls back to the first option for an unknown period, and says it did", () => {
    const resolved = resolvePeriod("mtd:1999-01-31", options);
    expect(resolved.period).toBe(AUGUST_MTD);
    expect(resolved.fellBack).toBe(true);
  });

  it("treats no token as the default rather than a fallback", () => {
    // An unqualified dashboard link should mean "the newest", forever — not a
    // date frozen into a bookmark, and not a warning.
    expect(resolvePeriod(null, options)).toEqual({ period: AUGUST_MTD, fellBack: false });
  });

  it("reports a bare date as a fallback", () => {
    expect(resolvePeriod("2026-08-31", options)).toEqual({
      period: AUGUST_MTD,
      fellBack: true,
    });
  });

  it("has nothing to resolve when nothing is loaded", () => {
    expect(resolvePeriod("mtd:2026-08-31", [])).toEqual({ period: null, fellBack: false });
  });
});

describe("matching one report's period against another's", () => {
  const period = (grain: "mtd" | "ytd", start: string, end: string): BedSpaPeriod => ({
    grain,
    periodStart: start,
    periodEnd: end,
    labelRaw: "Invented",
  });

  it("matches on the grain and BOTH dates", () => {
    expect(matchingPeriod(period("mtd", "2026-08-01", "2026-08-31"), [AUGUST_MTD])).toBe(
      AUGUST_MTD,
    );
  });

  it("refuses two periods that end on the same day with different grains", () => {
    /*
     * THE CASE A DATE-ONLY MATCH PASSES AND MUST NOT. Dividing a year's spa
     * sessions by a month's tanning traffic produces a plausible percentage
     * that means nothing.
     */
    expect(
      matchingPeriod(period("mtd", "2026-08-01", "2026-08-31"), [AUGUST_YTD, AUGUST_LTM]),
    ).toBeNull();
  });

  it("refuses two periods with the same grain and different dates", () => {
    expect(matchingPeriod(period("mtd", "2026-08-01", "2026-08-31"), [JULY_MTD])).toBeNull();
  });

  it("returns null when nothing is loaded, which is the honest answer", () => {
    // Null is what makes the dashboard show N/A with a reason rather than a
    // plausible number.
    expect(matchingPeriod(period("mtd", "2026-08-01", "2026-08-31"), [])).toBeNull();
  });
});
