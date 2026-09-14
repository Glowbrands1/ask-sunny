import { describe, expect, it } from "vitest";

import {
  interpretBedUsage,
  interpretSpaEngagement,
  interpretSpaWellness,
  worstBand,
  type BedUsageInterpretationInput,
  type SpaEngagementInterpretationInput,
  type SpaWellnessInterpretationInput,
} from "./interpretation";
import type { BedUsageLevelSummary, FastMigrationView } from "./bed-usage-analytics";
import type { CombinedView } from "./combined";
import type { SpaEquipmentPerformance, SpaUnitReconciliation } from "./spa-wellness-analytics";

/**
 * ============================================================================
 * THE SENTENCES A MANAGER READS, ASSERTED
 * ============================================================================
 *
 * A plain-language reading is the one part of a report that can be confidently
 * wrong: prose has no units to disagree with, so a sentence that drifts away
 * from its figures still looks like a sentence. These tests pin the four rules
 * the module is built on — every sentence carries its figure, a null produces no
 * sentence, FAST is never named as underperformance, and no recommendation is
 * issued — rather than checking that some text came back.
 */

/* --------------------------------------------------------------- bed usage */

function level(
  overrides: Partial<BedUsageLevelSummary> & { level: string },
): BedUsageLevelSummary {
  return {
    salonCount: 15,
    units: 20,
    clientTans: 5000,
    perBed: 250,
    chainPerBed: 250,
    advisoryOnly: false,
    versusChain: {
      value: 250,
      benchmark: 250,
      deltaPercent: 0,
      band: "at_market",
      reportableFinding: true,
      unavailableReason: null,
    },
    ...overrides,
  };
}

function bedInput(
  overrides: Partial<BedUsageInterpretationInput> = {},
): BedUsageInterpretationInput {
  const levels: BedUsageLevelSummary[] = [
    level({
      level: "INSTANT",
      perBed: 300,
      chainPerBed: 280,
      versusChain: {
        value: 300,
        benchmark: 280,
        deltaPercent: 7.14,
        band: "outperforming",
        reportableFinding: true,
        unavailableReason: null,
      },
    }),
    level({
      level: "FASTER",
      perBed: 200,
      chainPerBed: 230,
      versusChain: {
        value: 200,
        benchmark: 230,
        deltaPercent: -13.04,
        band: "significantly_underperforming",
        reportableFinding: true,
        unavailableReason: null,
      },
    }),
  ];

  const fast: FastMigrationView = {
    fastUnits: 20,
    fastTans: 2000,
    fastPerBed: 100,
    premiumUnits: 40,
    premiumTans: 10_000,
    premiumPerBed: 250,
    fastShareOfBeds: 0.25,
    fastShareOfTans: 0.14,
    salonsWithFast: 10,
    note: "",
  };

  return {
    totals: {
      salonCount: 15,
      totalTans: 30_000,
      bedCount: 120,
      perBed: 250,
      salonsMissingTans: 0,
    },
    levels,
    fast,
    ...overrides,
  };
}

describe("the bed usage reading", () => {
  it("leads with traffic and the utilization it produces", () => {
    const reading = interpretBedUsage(bedInput());

    expect(reading.headline).toBe(
      "30,000 tans across 15 salons and 120 beds — 250.0 tans per bed.",
    );
    expect(reading.unavailableReason).toBeNull();
  });

  it("names the level furthest behind, with both sides of the comparison", () => {
    const reading = interpretBedUsage(bedInput());

    expect(reading.points).toContain(
      "FASTER is furthest behind at -13.0% — 200.0 tans per bed against the chain's 230.0.",
    );
    expect(reading.points).toContain("INSTANT leads the chain by +7.1%.");
  });

  it("never names FAST as underperformance, however far behind it is", () => {
    /*
     * THE RULE: "FAST removals are intentional and are not treated as a
     * negative KPI." A FAST level at -28.5% is the worst number on the page and
     * must not be the sentence a manager reads as the headline problem.
     */
    const input = bedInput();
    const reading = interpretBedUsage({
      ...input,
      levels: [
        ...input.levels,
        level({
          level: "FAST",
          advisoryOnly: true,
          perBed: 100,
          chainPerBed: 140,
          versusChain: {
            value: 100,
            benchmark: 140,
            deltaPercent: -28.5,
            band: "significantly_underperforming",
            reportableFinding: false,
            unavailableReason: null,
          },
        }),
      ],
    });

    expect(reading.points.some((point) => point.includes("FAST is furthest behind"))).toBe(false);
    expect(reading.points.some((point) => point.includes("-28.5%"))).toBe(false);
    // Still counted as two compared levels, not three: FAST is outside the pass.
    expect(reading.points).toContain(
      "Against the chain, 1 of 2 compared levels is outperforming and 1 is behind.",
    );
  });

  it("reads FAST as capacity and migration instead", () => {
    const reading = interpretBedUsage(bedInput());

    expect(reading.points).toContain(
      "FAST is a planned reduction, not a shortfall: 20 units left carrying 14.0% of tans, at 100.0 per bed against 250.0 on FASTER, FASTEST and INSTANT.",
    );
  });

  it("says nothing about FAST when there is none left", () => {
    const input = bedInput();
    const reading = interpretBedUsage({
      ...input,
      fast: { ...input.fast, fastUnits: 0 },
    });

    expect(reading.points.some((point) => point.startsWith("FAST is a planned"))).toBe(false);
  });

  it("flags salons missing traffic rather than folding them into the total", () => {
    const input = bedInput();
    const reading = interpretBedUsage({
      ...input,
      totals: { ...input.totals, salonsMissingTans: 2 },
    });

    expect(reading.points).toContain(
      "2 salons reported no Total Tans, so they are outside the traffic figure above.",
    );
  });

  it("returns a reason rather than a sentence when there is nothing in view", () => {
    const input = bedInput();
    const reading = interpretBedUsage({
      ...input,
      totals: { ...input.totals, salonCount: 0 },
    });

    expect(reading.points).toEqual([]);
    expect(reading.unavailableReason).toBe("This period has no figures to read.");
  });
});

/* ------------------------------------------------------------ spa wellness */

function equipment(
  overrides: Partial<SpaEquipmentPerformance> & { equipmentCode: string; label: string },
): SpaEquipmentPerformance {
  return {
    shortLabel: overrides.label,
    ourSalonCount: 15,
    ourSessions: 1500,
    ourAverageSessions: 100,
    peerSalonCount: 197,
    peerAverageSessions: 100,
    chainSalonCount: 212,
    chainAverageSessions: 100,
    comparable: true,
    firstUseDate: null,
    newestFirstUseDate: null,
    versusPeers: {
      value: 100,
      benchmark: 100,
      deltaPercent: 0,
      band: "at_market",
      reportableFinding: true,
      unavailableReason: null,
    },
    ...overrides,
  };
}

const UNITS_AGREE: SpaUnitReconciliation = {
  installedUnits: 57,
  equipmentRows: 57,
  multiUnitSalons: [],
  contradictorySalons: [],
  unexplainedUnits: 0,
};

function spaInput(
  overrides: Partial<SpaWellnessInterpretationInput> = {},
): SpaWellnessInterpretationInput {
  return {
    totals: {
      salonCount: 15,
      totalSessions: 5893,
      equipmentPieces: 61,
      equipmentTypes: 5,
      weightedPeerDeltaPercent: -8.2,
      comparedTypeCount: 4,
    },
    equipment: [
      equipment({
        equipmentCode: "spa_hydromassage",
        label: "SPA Hydromassage",
        ourAverageSessions: 79,
        peerAverageSessions: 100,
        versusPeers: {
          value: 79,
          benchmark: 100,
          deltaPercent: -21,
          band: "significantly_underperforming",
          reportableFinding: true,
          unavailableReason: null,
        },
      }),
      equipment({
        equipmentCode: "spa_ovation",
        label: "SPA Ovation",
        peerSalonCount: 2,
        ourAverageSessions: 186,
        peerAverageSessions: 100,
        versusPeers: {
          value: 186,
          benchmark: 100,
          deltaPercent: 86,
          band: "outperforming",
          reportableFinding: true,
          unavailableReason: null,
        },
      }),
    ],
    unitCounts: UNITS_AGREE,
    ...overrides,
  };
}

describe("the spa wellness reading", () => {
  it("leads with sessions and installed units", () => {
    const reading = interpretSpaWellness(spaInput());

    expect(reading.headline).toBe(
      "5,893 spa sessions across 15 salons and 57 installed units.",
    );
  });

  it("explains the two unit counts instead of leaving a reader to subtract them", () => {
    /*
     * The reading a zero-usage rule forbids is "four units recorded no
     * sessions". Where the counts differ, the sentence must attribute the gap.
     */
    const reading = interpretSpaWellness(
      spaInput({
        unitCounts: {
          installedUnits: 61,
          equipmentRows: 57,
          multiUnitSalons: [
            { storeName: "MO Kansas City Liberty", units: 7, typesUsed: 5, extraUnits: 2 },
            { storeName: "MO St Joseph", units: 6, typesUsed: 4, extraUnits: 2 },
          ],
          contradictorySalons: [],
          unexplainedUnits: 0,
        },
      }),
    );

    expect(reading.points).toContain(
      "Every installed unit recorded sessions. The 61 units appear as 57 salon-and-equipment rows because MO Kansas City Liberty and MO St Joseph hold more than one unit of a type.",
    );
    expect(reading.points.some((point) => point.includes("no sessions"))).toBe(false);
  });

  it("qualifies a benchmark drawn from one or two peer salons", () => {
    const reading = interpretSpaWellness(spaInput());

    expect(reading.points).toContain(
      "SPA Ovation leads its installed peers by +86.0%, on a benchmark of 2 peer salons.",
    );
  });

  it("names the weakest type with both averages behind it", () => {
    const reading = interpretSpaWellness(spaInput());

    expect(reading.points).toContain(
      "SPA Hydromassage is furthest behind at -21.0% — 79 sessions per installed salon against the peers' 100.",
    );
    expect(reading.points).toContain(
      "Weighted by sessions, your salons run -8.2% against installed peers across those types.",
    );
  });

  it("says there is no comparison rather than inventing one", () => {
    const reading = interpretSpaWellness(
      spaInput({
        equipment: [
          equipment({
            equipmentCode: "other",
            label: "Other",
            comparable: false,
            peerAverageSessions: null,
            versusPeers: {
              value: 100,
              benchmark: null,
              deltaPercent: null,
              band: null,
              reportableFinding: false,
              unavailableReason: "not comparable",
            },
          }),
        ],
      }),
    );

    expect(reading.points).toContain(
      "No equipment type in view has a peer average, so there is no like-for-like comparison this period.",
    );
    expect(reading.points.some((point) => point.includes("furthest behind"))).toBe(false);
  });
});

/* ---------------------------------------------------------- spa engagement */

function combinedRow(storeName: string, status: string) {
  return {
    salonNumber: null,
    storeName,
    districtLabel: null,
    regionLabel: null,
    totalTans: 2000,
    bedCount: 10,
    perBedUsage: 200,
    spaSessions: 300,
    spaBeds: 4,
    spaEquipmentPieces: 4,
    conversion: { available: true, rate: 0.15, spaSessions: 300, totalTans: 2000 },
    spaPerUniquePercent: null,
    uniqueSpaTannerPercent: null,
    peerBand: null,
    status,
    sources: { bedUsage: true, spaWellness: true, spaEngagement: true },
  } as unknown as CombinedView["rows"][number];
}

function engagementInput(
  rows: readonly CombinedView["rows"][number][],
  conversionAvailable = true,
): SpaEngagementInterpretationInput {
  return {
    totals: {
      salonCount: rows.length,
      spaSessions: 4500,
      totalUniqueTanners: 12_000,
      uniqueSpaTanners: 2400,
      spaBeds: 60,
      spaPerUniquePercent: 0.375,
      uniqueSpaTannerPercent: 0.2,
      spaSessionsPerBed: 75,
      spaSessionsPerUniquePerBed: 0.0029,
      bestOverallRank: 12,
      worstOverallRank: 180,
    },
    combined: {
      rows,
      totals: {
        salonCount: rows.length,
        totalTans: 30_000,
        spaSessions: 4500,
        conversion: conversionAvailable
          ? { available: true, rate: 0.15, spaSessions: 4500, totalTans: 30_000 }
          : {
              available: false,
              reason: "period_mismatch",
              reasonText:
                "The Bed Usage and Spa reports loaded for this view cover different periods, so their figures cannot be divided.",
            },
        perBedUsage: 250,
      },
      conversionAvailable,
      periodMismatchNote: null,
      unjoined: {
        missingFromBedUsage: [],
        missingFromSpaWellness: [],
        missingFromSpaEngagement: [],
      },
    } as unknown as CombinedView,
  };
}

describe("the spa engagement reading", () => {
  it("leads with the documented primary metric and both of its terms", () => {
    const reading = interpretSpaEngagement(
      engagementInput([combinedRow("NE Grand Island", "strong_execution")]),
    );

    expect(reading.headline).toBe(
      "15.0% spa conversion — 4,500 spa sessions on 30,000 tans across 1 salon.",
    );
  });

  it("separates reach from frequency rather than blurring them", () => {
    const reading = interpretSpaEngagement(
      engagementInput([combinedRow("NE Grand Island", "strong_execution")]),
    );

    expect(reading.points).toContain(
      "Reach and frequency are different questions: 20.0% of tanning customers used the spa at all, and spa sessions run at 37.5% of unique tanners.",
    );
  });

  it("places salons on the approved capital framework's two sides, and proposes nothing", () => {
    const reading = interpretSpaEngagement(
      engagementInput([
        combinedRow("NE Grand Island", "strong_execution"),
        combinedRow("MO Kansas City Liberty", "traffic_without_conversion"),
        combinedRow("NE Omaha Pacific", "low_traffic_and_conversion"),
      ]),
    );

    expect(reading.points).toContain(
      "1 salon converts above your average with equipment at or above peers — NE Grand Island. That is the profile the approved rules favour for more equipment.",
    );
    expect(reading.points).toContain(
      "1 salon has traffic or conversion working against weak equipment or weak execution — MO Kansas City Liberty. The approved rules put these on the fix-before-expanding side.",
    );
    expect(reading.points).toContain(
      "1 salon is below your average on BOTH traffic and conversion — NE Omaha Pacific. That is a traffic question before it is a spa one.",
    );

    /*
     * RULE 4. The document's framework names where capital is FAVOURED; it does
     * not authorise a purchase, and neither does this. No sentence may instruct.
     */
    for (const point of reading.points) {
      expect(point).not.toMatch(/\b(should buy|must install|recommend|we will|purchase)\b/i);
    }
  });

  it("says why conversion is missing instead of showing a rate without one", () => {
    const reading = interpretSpaEngagement(
      engagementInput([combinedRow("NE Grand Island", "insufficient_data")], false),
    );

    expect(reading.headline).toContain("Spa Conversion Rate is not available");
    expect(reading.points).toContain(
      "The Bed Usage and Spa reports loaded for this view cover different periods, so their figures cannot be divided.",
    );
    expect(reading.points).toContain(
      "1 salon could not be read: the reports loaded for this period do not join for it.",
    );
  });

  it("flags equipment that came online inside the window", () => {
    const reading = interpretSpaEngagement(
      engagementInput([combinedRow("KS Manhattan", "partial_period_equipment")]),
    );

    expect(reading.points).toContain(
      "1 salon had spa equipment first used inside this period, so its figure covers less of the window than its peers'.",
    );
  });
});

describe("worstBand", () => {
  it("returns the band a reader asks about first", () => {
    expect(worstBand(["outperforming", "below_market", "at_market"])).toBe("below_market");
    expect(worstBand(["outperforming", "significantly_underperforming", "below_market"])).toBe(
      "significantly_underperforming",
    );
    expect(worstBand([null, null])).toBeNull();
    expect(worstBand([])).toBeNull();
  });
});
