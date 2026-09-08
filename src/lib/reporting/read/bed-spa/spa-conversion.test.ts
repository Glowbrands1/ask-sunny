import { describe, expect, it } from "vitest";

import {
  aggregateSpaConversion,
  computeSpaConversion,
  CONVERSION_REASON_TEXT,
  describePeriodMismatch,
  periodsMatch,
} from "./spa-conversion";
import type { BedSpaPeriod } from "./types";

const AUGUST: BedSpaPeriod = {
  grain: "mtd",
  periodStart: "2026-08-01",
  periodEnd: "2026-08-31",
  labelRaw: "Bed Usage Report: 8/1/2026 to 8/31/2026",
};
const SEPTEMBER: BedSpaPeriod = {
  grain: "mtd",
  periodStart: "2026-09-01",
  periodEnd: "2026-09-01",
  labelRaw: "Spa Sessions per Unique Tanner per Spa Bed: 9/1 - 9/1",
};
const AUGUST_YTD: BedSpaPeriod = {
  grain: "ytd",
  periodStart: "2026-01-01",
  periodEnd: "2026-08-31",
  labelRaw: "STC SPA Wellness Tracking - Year to Date",
};

const matching = { trafficPeriod: AUGUST, spaPeriod: AUGUST };

describe("period matching", () => {
  it("accepts two identical periods", () => {
    expect(periodsMatch(AUGUST, { ...AUGUST })).toBe(true);
  });

  it("rejects two periods that end on the same day with different grains", () => {
    /*
     * THE CASE A DATE-ONLY CHECK PASSES AND MUST NOT. Month-to-date through
     * 31 August and year-to-date through 31 August share a `periodEnd` and
     * cover eight times the traffic.
     */
    expect(AUGUST.periodEnd).toBe(AUGUST_YTD.periodEnd);
    expect(periodsMatch(AUGUST, AUGUST_YTD)).toBe(false);
  });

  it("rejects different date ranges", () => {
    expect(periodsMatch(AUGUST, SEPTEMBER)).toBe(false);
  });

  it("rejects a missing period on either side", () => {
    expect(periodsMatch(AUGUST, null)).toBe(false);
    expect(periodsMatch(null, AUGUST)).toBe(false);
    expect(periodsMatch(undefined, undefined)).toBe(false);
  });

  it("describes a mismatch in terms a reader can act on", () => {
    const note = describePeriodMismatch(AUGUST, SEPTEMBER);
    expect(note).toContain("MTD 2026-08-01 to 2026-08-31");
    expect(note).toContain("MTD 2026-09-01 to 2026-09-01");
  });

  it("says which side is missing when one is", () => {
    expect(describePeriodMismatch(AUGUST, null)).toContain("none loaded");
  });
});

describe("Spa Conversion Rate", () => {
  it("divides spa sessions by tanning traffic", () => {
    const result = computeSpaConversion({
      salonNumber: "0307",
      spaSessions: 494,
      totalTans: 2644,
      ...matching,
    });
    expect(result.available).toBe(true);
    if (!result.available) throw new Error("unreachable");
    expect(result.rate).toBeCloseTo(494 / 2644, 12);
    // 18.68%
    expect(result.rate * 100).toBeCloseTo(18.6838, 4);
  });

  it("refuses across mismatched periods, before anything else", () => {
    // The live case in the supplied material: the bed usage report covers all
    // of August and the spa engagement report covers 1 September.
    const result = computeSpaConversion({
      salonNumber: "0307",
      spaSessions: 33,
      totalTans: 2644,
      trafficPeriod: AUGUST,
      spaPeriod: SEPTEMBER,
    });
    expect(result).toMatchObject({
      available: false,
      reason: "period_mismatch",
      reasonText: CONVERSION_REASON_TEXT.period_mismatch,
    });
  });

  it("reports a period mismatch even when both figures are present and sane", () => {
    // The whole hazard: every input looks fine and the answer is meaningless.
    const result = computeSpaConversion({
      salonNumber: "0307",
      spaSessions: 100,
      totalTans: 1000,
      trafficPeriod: AUGUST,
      spaPeriod: AUGUST_YTD,
    });
    expect(result.available).toBe(false);
  });

  it("refuses an unresolved salon rather than pairing it with someone's traffic", () => {
    const result = computeSpaConversion({
      salonNumber: null,
      spaSessions: 494,
      totalTans: 2644,
      ...matching,
    });
    expect(result).toMatchObject({ available: false, reason: "salon_unresolved" });
  });

  it("refuses a missing denominator", () => {
    const result = computeSpaConversion({
      salonNumber: "0307",
      spaSessions: 494,
      totalTans: null,
      ...matching,
    });
    expect(result).toMatchObject({ available: false, reason: "traffic_missing" });
    // The known side is still carried, so a table can show the parts.
    expect(result.available).toBe(false);
    if (result.available) throw new Error("unreachable");
    expect(result.spaSessions).toBe(494);
  });

  it("refuses a zero denominator rather than producing an infinity", () => {
    const result = computeSpaConversion({
      salonNumber: "0307",
      spaSessions: 494,
      totalTans: 0,
      ...matching,
    });
    expect(result).toMatchObject({ available: false, reason: "traffic_zero" });
  });

  it("treats a negative denominator as missing rather than inverting the sign", () => {
    const result = computeSpaConversion({
      salonNumber: "0307",
      spaSessions: 494,
      totalTans: -100,
      ...matching,
    });
    expect(result).toMatchObject({ available: false, reason: "traffic_missing" });
  });

  it("refuses a missing numerator", () => {
    const result = computeSpaConversion({
      salonNumber: "0307",
      spaSessions: null,
      totalTans: 2644,
      ...matching,
    });
    expect(result).toMatchObject({ available: false, reason: "sessions_missing" });
  });

  it("treats zero spa sessions as a real answer, not a refusal", () => {
    // A salon with spa equipment and no sessions IS a 0% conversion, and that
    // is a finding somebody should see.
    const result = computeSpaConversion({
      salonNumber: "0307",
      spaSessions: 0,
      totalTans: 2644,
      ...matching,
    });
    expect(result).toMatchObject({ available: true, rate: 0 });
  });

  it("gives every refusal a sentence a manager can read", () => {
    for (const reason of Object.keys(CONVERSION_REASON_TEXT) as (keyof typeof CONVERSION_REASON_TEXT)[]) {
      expect(CONVERSION_REASON_TEXT[reason].length).toBeGreaterThan(30);
      expect(CONVERSION_REASON_TEXT[reason]).not.toContain("null");
    }
  });
});

describe("the estate conversion rate", () => {
  const conversion = (spaSessions: number, totalTans: number) =>
    computeSpaConversion({ salonNumber: "0000", spaSessions, totalTans, ...matching });

  it("sums the parts and divides once", () => {
    const result = aggregateSpaConversion([
      conversion(494, 2644),
      conversion(145, 1627),
      conversion(1073, 7375),
    ]);
    expect(result.available).toBe(true);
    if (!result.available) throw new Error("unreachable");
    expect(result.spaSessions).toBe(1712);
    expect(result.totalTans).toBe(11646);
    expect(result.rate).toBeCloseTo(1712 / 11646, 12);
  });

  it("is not the average of the salons' rates", () => {
    // Averaging weights a 1,627-tan salon like a 7,375-tan one.
    const parts = [conversion(494, 2644), conversion(145, 1627), conversion(1073, 7375)];
    const result = aggregateSpaConversion(parts);
    const meanOfRates =
      parts
        .filter((part) => part.available)
        .reduce((total, part) => total + (part.available ? part.rate : 0), 0) / parts.length;
    expect(result.available).toBe(true);
    if (!result.available) throw new Error("unreachable");
    expect(result.rate).not.toBeCloseTo(meanOfRates, 6);
  });

  it("excludes a salon whose own rate is unavailable from BOTH sides", () => {
    // An unmatched salon must not shrink the numerator while its traffic
    // inflates the denominator.
    const result = aggregateSpaConversion([
      conversion(100, 1000),
      computeSpaConversion({
        salonNumber: null,
        spaSessions: 50,
        totalTans: 9000,
        ...matching,
      }),
    ]);
    expect(result.available).toBe(true);
    if (!result.available) throw new Error("unreachable");
    expect(result.totalTans).toBe(1000);
    expect(result.rate).toBeCloseTo(0.1, 12);
  });

  it("reports the commonest refusal when nothing is computable", () => {
    const result = aggregateSpaConversion([
      computeSpaConversion({
        salonNumber: "0001",
        spaSessions: 1,
        totalTans: 1,
        trafficPeriod: AUGUST,
        spaPeriod: SEPTEMBER,
      }),
      computeSpaConversion({
        salonNumber: "0002",
        spaSessions: 1,
        totalTans: 1,
        trafficPeriod: AUGUST,
        spaPeriod: SEPTEMBER,
      }),
      computeSpaConversion({
        salonNumber: null,
        spaSessions: 1,
        totalTans: 1,
        ...matching,
      }),
    ]);
    expect(result).toMatchObject({ available: false, reason: "period_mismatch" });
  });

  it("answers a refusal for an empty set rather than dividing by nothing", () => {
    expect(aggregateSpaConversion([])).toMatchObject({ available: false });
  });
});
