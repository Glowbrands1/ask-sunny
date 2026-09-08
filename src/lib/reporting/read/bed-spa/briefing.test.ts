import { describe, expect, it } from "vitest";

import {
  buildBedSpaBriefing,
  BED_SPA_BRIEFING_RULES,
  MAX_BRIEFING_ROWS,
  type BedSpaBriefingInput,
} from "./briefing";
import { summarizeLevels, summarizeSalons, totalsFor } from "./bed-usage-analytics";
import { buildCombinedView } from "./combined";
import { engagementTotals, summarizeEngagement } from "./spa-engagement-analytics";
import {
  equipmentPerformance,
  spaWellnessTotals,
  summarizeSpaSalons,
} from "./spa-wellness-analytics";
import type {
  BedSpaPeriod,
  BedSpaProvenance,
  BedUsageChainBenchmarkRow,
  BedUsageEquipmentRow,
  BedUsageSalonRow,
  SpaEngagementSalonRow,
  SpaEquipmentBenchmarkRow,
  SpaEquipmentTypeRow,
  SpaEquipmentUseRow,
  SpaWellnessSalonRow,
} from "./types";

/**
 * ============================================================================
 * WHAT THE ASSISTANT IS ALLOWED TO SEE, AND WHAT IT IS TOLD ABOUT IT
 * ============================================================================
 *
 * These are not rendering tests. Each one asserts a property of the text that,
 * if it were absent, would let the model produce a specific wrong answer:
 *
 *   * a figure with no period, so two months could be compared;
 *   * a FAST shortfall with no exemption, so a deliberate removal reads as a
 *     failure;
 *   * "Spa Per Unique %" and "per Unique per Bed" as one measure, so a store
 *     converting 45% of its customers is reported as converting 11%;
 *   * an N/A with no reason, so a zero gets substituted;
 *   * a truncated list with no note, so "which salons are lowest" is answered
 *     off the visible half.
 *
 * SALON NAMES HERE ARE INVENTED, like the parser fixtures': the real estate's
 * names and monthly figures are business data and do not belong in git.
 */

const PERIOD: BedSpaPeriod = {
  grain: "mtd",
  periodStart: "2026-08-01",
  periodEnd: "2026-08-31",
  labelRaw: "8/1/2026 - 8/31/2026",
};

/** A DIFFERENT period, for the mismatch cases. Same end date, wider grain. */
const YTD_PERIOD: BedSpaPeriod = {
  grain: "ytd",
  periodStart: "2026-01-01",
  periodEnd: "2026-08-31",
  labelRaw: "1/1/2026 - 8/31/2026",
};

function provenance(period: BedSpaPeriod, salonCount: number): BedSpaProvenance {
  return {
    period,
    ingestedAt: "2026-09-08T12:00:00Z",
    originalFilename: "Report.xlsx",
    sourcePeriodLabel: "Bed Usage Report: 8/1/2026 to 8/31/2026",
    parserKey: "bed_usage_monthly",
    parserVersion: 1,
    sourceSheetNames: ["Sheet1"],
    salonCount,
    sourceSalonCount: 252,
  };
}

/* ------------------------------------------------------------ bed usage in -- */

const BED_SALONS: BedUsageSalonRow[] = [
  {
    salonNumber: "0101",
    storeName: "Northlake Commons",
    districtLabel: "D1",
    regionLabel: "R1",
    totalTans: 6000,
    bedCount: 20,
  },
  {
    salonNumber: "0102",
    storeName: "Westbrook Landing",
    districtLabel: "D1",
    regionLabel: "R1",
    totalTans: 2000,
    bedCount: 10,
  },
];

function equipment(
  storeName: string,
  salonNumber: string,
  level: string,
  qty: number,
  tans: number,
  vChain: number,
): BedUsageEquipmentRow {
  return {
    salonNumber,
    storeName,
    districtLabel: "D1",
    regionLabel: "R1",
    level,
    bedType: `${level} unit`,
    qty,
    clientTans: tans,
    perBed: tans / qty,
    vChainPercent: vChain,
    vBedTypePercent: null,
  };
}

const BED_EQUIPMENT: BedUsageEquipmentRow[] = [
  // FAST runs far below the chain. Intentional; must never read as a failure.
  equipment("Northlake Commons", "0101", "FAST", 10, 1000, -28.5),
  equipment("Westbrook Landing", "0102", "FAST", 5, 500, -28.5),
  // FASTEST just clears the +2% rung, which is the boundary the ladder exists for.
  equipment("Northlake Commons", "0101", "FASTEST", 10, 5000, 2.1),
  equipment("Westbrook Landing", "0102", "FASTEST", 5, 1500, 2.1),
];

const BED_BENCHMARKS: BedUsageChainBenchmarkRow[] = [
  { level: "FAST", tansPerBed: 139.9, totalBeds: 4000 },
  { level: "FASTEST", tansPerBed: 320.0, totalBeds: 3000 },
];

function bedUsageInput() {
  const salons = summarizeSalons(BED_SALONS, BED_EQUIPMENT);
  return {
    period: PERIOD,
    provenance: provenance(PERIOD, 2),
    totals: totalsFor(salons),
    levels: summarizeLevels(BED_EQUIPMENT, BED_BENCHMARKS),
    salons: [...salons].sort((a, b) => (b.totalTans ?? -1) - (a.totalTans ?? -1)),
  };
}

/* --------------------------------------------------------- spa wellness in -- */

const SPA_TYPES: SpaEquipmentTypeRow[] = [
  {
    code: "hydromassage",
    label: "SPA Hydromassage",
    shortLabel: "Hydromassage",
    isComparable: true,
    displayOrder: 1,
  },
  {
    code: "ovation",
    label: "SPA Ovation",
    shortLabel: "Ovation",
    isComparable: true,
    displayOrder: 2,
  },
  { code: "other", label: "Other", shortLabel: "Other", isComparable: false, displayOrder: 99 },
];

/*
 * WESTBROOK HAS NO OVATION ROW AT ALL. That is the presence rule in the data:
 * the source wrote a zero, the parser stored nothing, and no figure below may
 * describe Westbrook as underusing an Ovation.
 */
const SPA_USE: SpaEquipmentUseRow[] = [
  {
    salonNumber: "0101",
    storeName: "Northlake Commons",
    equipmentCode: "hydromassage",
    sessions: 700,
    firstUseDate: "2024-03-01",
    lastUseDate: "2026-08-30",
  },
  {
    salonNumber: "0102",
    storeName: "Westbrook Landing",
    equipmentCode: "hydromassage",
    sessions: 200,
    firstUseDate: "2024-05-01",
    lastUseDate: "2026-08-29",
  },
  {
    salonNumber: "0101",
    storeName: "Northlake Commons",
    equipmentCode: "ovation",
    sessions: 100,
    firstUseDate: "2026-08-15",
    lastUseDate: "2026-08-31",
  },
  {
    salonNumber: "0101",
    storeName: "Northlake Commons",
    equipmentCode: "other",
    sessions: 40,
    firstUseDate: null,
    lastUseDate: null,
  },
];

const SPA_SALONS: SpaWellnessSalonRow[] = [
  {
    salonNumber: "0101",
    storeName: "Northlake Commons",
    districtLabel: "D1",
    regionLabel: "R1",
    totalSessions: 840,
    equipmentPieces: 3,
    equipmentTypesUsed: 3,
    firstUseDate: "2024-03-01",
    newestFirstUseDate: "2026-08-15",
  },
  {
    salonNumber: "0102",
    storeName: "Westbrook Landing",
    districtLabel: "D1",
    regionLabel: "R1",
    totalSessions: 200,
    equipmentPieces: 1,
    equipmentTypesUsed: 1,
    firstUseDate: "2024-05-01",
    newestFirstUseDate: "2024-05-01",
  },
];

const SPA_BENCHMARKS: SpaEquipmentBenchmarkRow[] = [
  {
    equipmentCode: "hydromassage",
    chainSalonCount: 200,
    chainAverageSessions: 500,
    peerSalonCount: 198,
    peerAverageSessions: 503,
  },
  {
    equipmentCode: "ovation",
    chainSalonCount: 20,
    chainAverageSessions: 60,
    peerSalonCount: 19,
    peerAverageSessions: 54,
  },
  {
    // No peer used the catch-all bucket. It is also not comparable.
    equipmentCode: "other",
    chainSalonCount: 1,
    chainAverageSessions: 40,
    peerSalonCount: 0,
    peerAverageSessions: null,
  },
];

function spaWellnessInput(period: BedSpaPeriod = PERIOD) {
  const performance = equipmentPerformance(SPA_TYPES, SPA_USE, SPA_BENCHMARKS);
  return {
    period,
    provenance: provenance(period, 2),
    totals: spaWellnessTotals(SPA_SALONS, performance),
    equipment: performance,
  };
}

/* ------------------------------------------------------ spa engagement in -- */

const ENGAGEMENT_SALONS: SpaEngagementSalonRow[] = [
  {
    salonNumber: "0101",
    storeName: "Northlake Commons",
    districtLabel: "D1",
    regionLabel: "R1",
    ownership: "Franchise",
    spaSessions: 840,
    totalUniqueTanners: 1200,
    uniqueSpaTanners: 300,
    spaBeds: 4,
    ranks: { spa_per_unique_pct: 12 },
    overallRank: 12,
  },
  {
    salonNumber: "0102",
    storeName: "Westbrook Landing",
    districtLabel: "D1",
    regionLabel: "R1",
    ownership: "Franchise",
    spaSessions: 200,
    totalUniqueTanners: 800,
    uniqueSpaTanners: 90,
    spaBeds: 1,
    ranks: { spa_per_unique_pct: 140 },
    overallRank: 140,
  },
];

function engagementInput(period: BedSpaPeriod = PERIOD) {
  const summaries = summarizeEngagement(ENGAGEMENT_SALONS);
  return {
    period,
    provenance: provenance(period, 2),
    totals: engagementTotals(summaries),
    salons: [...summaries].sort(
      (a, b) =>
        (a.spaPerUniquePercent ?? Number.POSITIVE_INFINITY) -
        (b.spaPerUniquePercent ?? Number.POSITIVE_INFINITY),
    ),
    rankedPopulation: 248,
  };
}

/* ------------------------------------------------------------ combined in -- */

function combinedInput(spaPeriod: BedSpaPeriod = PERIOD) {
  const view = buildCombinedView({
    bedUsage: summarizeSalons(BED_SALONS, BED_EQUIPMENT),
    bedUsagePeriod: PERIOD,
    spaWellness: summarizeSpaSalons(SPA_SALONS, SPA_USE),
    spaWellnessPeriod: spaPeriod,
    spaEngagement: summarizeEngagement(ENGAGEMENT_SALONS),
    spaEngagementPeriod: PERIOD,
    peerBandBySalon: { "Westbrook Landing": "significantly_underperforming" },
    partialPeriodSalons: ["Northlake Commons"],
  });
  return { view, period: PERIOD };
}

function fullInput(): BedSpaBriefingInput {
  return {
    company: "Meridian Leisure Group",
    bedUsage: bedUsageInput(),
    spaWellness: spaWellnessInput(),
    spaEngagement: engagementInput(),
    combined: combinedInput(),
  };
}

function briefing(input: BedSpaBriefingInput = fullInput()): string {
  const text = buildBedSpaBriefing(input);
  expect(text).not.toBeNull();
  return text!;
}

/* -------------------------------------------------------------------------- */

describe("buildBedSpaBriefing — scope", () => {
  it("names the company the figures belong to, and says no other is available", () => {
    const text = briefing();
    expect(text).toContain("REPORT DATA — Meridian Leisure Group");
    expect(text).toContain("No other company's salon figures are available to you");
  });

  it("returns null when no report has loaded", () => {
    // Null rather than an empty heading: a block that announces report data and
    // lists none is an invitation to fill the gap.
    expect(
      buildBedSpaBriefing({
        company: "Meridian Leisure Group",
        bedUsage: null,
        spaWellness: null,
        spaEngagement: null,
        combined: null,
      }),
    ).toBeNull();
  });

  it("renders whichever reports did load, and nothing about the others", () => {
    const text = briefing({
      company: "Meridian Leisure Group",
      bedUsage: bedUsageInput(),
      spaWellness: null,
      spaEngagement: null,
      combined: null,
    });
    expect(text).toContain("BED USAGE");
    expect(text).not.toContain("SPA WELLNESS");
    expect(text).not.toContain("SPA ENGAGEMENT");
    expect(text).not.toContain("SPA CONVERSION RATE");
  });

  it("carries no peer or chain salon name, only averages", () => {
    const text = briefing();
    // The comparison sides are counts and averages. If a peer's identity could
    // reach the prompt, the model could name it in an answer.
    expect(text).toContain("peer salons, peer average");
    expect(text).not.toMatch(/peer.*\(0\d{3}\)/);
  });
});

describe("buildBedSpaBriefing — periods", () => {
  it("states each report's own period, with the grain and the source's own label", () => {
    const text = briefing();
    expect(text).toContain("BED USAGE — MTD, 2026-08-01 to 2026-08-31");
    expect(text).toContain(
      'this delivery is titled "Bed Usage Report: 8/1/2026 to 8/31/2026"',
    );
    // NOT the shared period row's label, which another report may have written.
    expect(text).not.toContain("8/1/2026 - 8/31/2026)");
  });

  it("shows two reports on different periods as different periods", () => {
    const text = briefing({
      company: "Meridian Leisure Group",
      bedUsage: bedUsageInput(),
      spaWellness: spaWellnessInput(YTD_PERIOD),
      spaEngagement: null,
      combined: null,
    });
    expect(text).toContain("BED USAGE — MTD, 2026-08-01 to 2026-08-31");
    expect(text).toContain("SPA WELLNESS — YTD, 2026-01-01 to 2026-08-31");
  });

  it("forbids combining figures across periods, in the rules block", () => {
    expect(BED_SPA_BRIEFING_RULES).toContain("Never combine or compare figures from two different periods");
    expect(BED_SPA_BRIEFING_RULES).toContain("MTD, YTD and LTM through the same day");
  });

  it("records when the report was loaded and how many salons it covers", () => {
    const text = briefing();
    expect(text).toContain("covers 2 of our salons, out of 252 in the delivery");
    expect(text).toContain("loaded 2026-09-08T12:00:00Z");
  });
});

describe("buildBedSpaBriefing — the FAST rule", () => {
  it("marks the FAST level advisory-only and says the reduction was intentional", () => {
    const text = briefing();
    const line = text.split("\n").find((row) => row.trim().startsWith("FAST:"));
    expect(line).toBeDefined();
    expect(line).toContain("ADVISORY ONLY");
    expect(line).toContain("intentional reduction, not a shortfall");
  });

  it("still shows the FAST figure, including how far below chain it is", () => {
    // Suppressed as a FINDING, kept as a FIGURE. Hiding it would defeat the
    // capacity-migration analysis the level is tracked for.
    const text = briefing();
    const line = text.split("\n").find((row) => row.trim().startsWith("FAST:"))!;
    expect(line).toContain("100.0 per bed");
    expect(line).toContain("chain 139.9 per bed");
    expect(line).toMatch(/-2\d\.\d%/);
  });

  it("tells the model never to present a FAST shortfall as a failure", () => {
    expect(BED_SPA_BRIEFING_RULES).toContain("FAST reductions are intentional");
    expect(BED_SPA_BRIEFING_RULES).toContain("Never present a FAST shortfall as a failure");
  });

  it("states the FAST exemption once", () => {
    // It was written twice: the rule line prepended the sentence and then
    // interpolated FAST_ADVISORY_NOTE, which opens with it. Harmless to a
    // reader, and exactly the sort of duplication that accumulates in a prompt.
    const occurrences = BED_SPA_BRIEFING_RULES.split(
      "FAST reductions are intentional",
    ).length - 1;
    expect(occurrences).toBe(1);
  });

  it("does not exempt the other levels", () => {
    const text = briefing();
    const line = text.split("\n").find((row) => row.trim().startsWith("FASTEST:"))!;
    expect(line).not.toContain("ADVISORY ONLY");
    expect(line).toContain("Outperforming Peers");
  });
});

describe("buildBedSpaBriefing — zero means not installed", () => {
  it("says explicitly that absent equipment is not installed", () => {
    const text = briefing();
    expect(text).toContain("is NOT INSTALLED there");
    expect(text).toContain("zeroes are not stored as sessions");
  });

  it("carries the rule in the instruction block too", () => {
    expect(BED_SPA_BRIEFING_RULES).toContain("means the equipment is NOT INSTALLED");
    expect(BED_SPA_BRIEFING_RULES).toContain(
      "Never describe a salon as underusing equipment it does not have",
    );
  });

  it("counts only installed salons on each side of an equipment comparison", () => {
    // Ovation is installed in one of the two salons. Our average must be over
    // that one salon, not over both — and the peer average over its own.
    const text = briefing();
    const line = text.split("\n").find((row) => row.includes("SPA Ovation:"))!;
    expect(line).toContain("installed in 1 of our salons");
    expect(line).toContain("our average 100.0 per installed salon");
    expect(line).toContain("19 peer salons, peer average 54.0");
  });

  it("withholds a comparison for the unmapped Other bucket and says why", () => {
    const text = briefing();
    const line = text.split("\n").find((row) => row.includes("Other:"))!;
    expect(line).toContain("no comparison");
    expect(line).toContain("not the same machine between salons");
  });
});

describe("buildBedSpaBriefing — the two spa ratios stay separate", () => {
  it("names each measure with its own formula", () => {
    const text = briefing();
    expect(text).toContain(
      // 1,040 sessions over 2,000 unique tanners, recomputed from the sums —
      // NOT the mean of the two salons' own 70.0% and 25.0%.
      "Estate Spa Per Unique % (spa sessions / total unique tanners) = 52.0%",
    );
    expect(text).toContain(
      "Estate Spa Sessions per Unique Tanner per Spa Bed (spa sessions / total unique tanners / spa beds) = 0.1040",
    );
  });

  it("gives them different values in the salon rows, at their own precisions", () => {
    const text = briefing();
    const line = text.split("\n").find((row) => row.includes("Northlake Commons (0101): 840"))!;
    expect(line).toContain("Spa Per Unique % 70.0%");
    expect(line).toContain("per Unique per Bed 0.1750");
  });

  it("tells the model they are different measures", () => {
    expect(BED_SPA_BRIEFING_RULES).toContain(
      "Spa Per Unique % and Spa Sessions per Unique Tanner per Spa Bed are DIFFERENT measures",
    );
    expect(BED_SPA_BRIEFING_RULES).toContain("never treat one as the other");
  });

  it("carries the caveat about summing unique tanners across salons", () => {
    expect(briefing()).toContain("A customer who visited two salons is counted in both");
  });

  it("reports a rank with its population and says a low number is better", () => {
    const text = briefing();
    expect(text).toContain("rank 12 of 248");
    expect(text).toContain("a low number is better");
    expect(text).toContain("includes salons outside this company");
  });
});

describe("buildBedSpaBriefing — spa conversion", () => {
  it("states the formula and the estate rate over one matching period", () => {
    const text = briefing();
    expect(text).toContain(
      "Spa Conversion Rate = monthly spa sessions / monthly total tans, over one matching period",
    );
    // 1,040 sessions over 8,000 tans.
    expect(text).toContain("1,040 spa sessions over 8,000 tans = 13.0%");
  });

  it("orders the salons LOWEST conversion first", () => {
    const text = briefing();
    const lines = text.split("\n");
    const header = lines.findIndex((row) => row.includes("LOWEST conversion first"));
    expect(header).toBeGreaterThan(-1);
    expect(lines[header + 1]).toContain("Westbrook Landing");
    expect(lines[header + 2]).toContain("Northlake Commons");
  });

  it("refuses the whole metric when the two reports cover different periods", () => {
    const text = briefing({
      company: "Meridian Leisure Group",
      bedUsage: bedUsageInput(),
      spaWellness: spaWellnessInput(YTD_PERIOD),
      spaEngagement: engagementInput(),
      combined: combinedInput(YTD_PERIOD),
    });
    expect(text).toContain("No conversion rate can be computed for this view");
    expect(text).toContain("Do not divide the spa sessions above by the tans above");
    expect(text).not.toMatch(/conversion 1\d\.\d%/);
  });

  it("gives the reason beside any N/A rather than a blank or a zero", () => {
    const noSessions = buildCombinedView({
      bedUsage: summarizeSalons(BED_SALONS, BED_EQUIPMENT),
      bedUsagePeriod: PERIOD,
      // Northlake alone, so Westbrook has traffic and no spa row.
      spaWellness: summarizeSpaSalons([SPA_SALONS[0]!], SPA_USE),
      spaWellnessPeriod: PERIOD,
      spaEngagement: [],
      spaEngagementPeriod: null,
    });
    const text = briefing({
      company: "Meridian Leisure Group",
      bedUsage: bedUsageInput(),
      spaWellness: spaWellnessInput(),
      spaEngagement: null,
      combined: { view: noSessions, period: PERIOD },
    });
    // Scoped to the conversion section: the same salon also has a Bed Usage
    // row above, and matching the first occurrence would assert nothing.
    const lines = text.split("\n");
    const start = lines.findIndex((row) => row.includes("LOWEST conversion first"));
    const line = lines
      .slice(start)
      .find((row) => row.includes("Westbrook Landing (0102):"))!;
    expect(line).toContain("conversion N/A (No spa sessions were reported");
    expect(line).toContain("no Spa Wellness row");
    expect(line).not.toContain("conversion 0.0%");
  });

  it("tells the model to report the reason rather than substitute an estimate", () => {
    expect(BED_SPA_BRIEFING_RULES).toContain("Where a figure reads N/A the reason is given");
    expect(BED_SPA_BRIEFING_RULES).toContain("do not substitute a zero or an estimate");
  });

  it("carries each salon's reading without turning it into a recommendation", () => {
    const text = briefing();
    expect(text).toContain('reading "partial_period_equipment"');
    expect(BED_SPA_BRIEFING_RULES).toContain(
      "They do not authorise equipment purchases, removals or disciplinary action",
    );
  });
});

describe("buildBedSpaBriefing — what the model may assert", () => {
  it("says the figures are data and must not be marked with a source marker", () => {
    const text = briefing();
    expect(text).toContain("These figures are DATA, not company policy");
    expect(text).toContain("Do not attach a source marker to them");
    expect(text).not.toMatch(/\[S\d\]/);
  });

  it("forbids computing a new figure or projecting a trend", () => {
    expect(BED_SPA_BRIEFING_RULES).toContain("Quote only figures written below");
    expect(BED_SPA_BRIEFING_RULES).toContain(
      "Do not compute a new ratio, project a trend, or estimate a missing value",
    );
  });

  it("forbids calling a figure a target or a standard", () => {
    // Nothing in these reports is a target. A model that reads "the chain is at
    // 139.9" as a goal has invented a threshold nobody approved.
    expect(BED_SPA_BRIEFING_RULES).toContain(
      "Never call a figure below a policy, a target or a standard",
    );
  });

  it("requires the period to be named with any figure", () => {
    expect(BED_SPA_BRIEFING_RULES).toContain("Always name the period a figure belongs to");
  });
});

describe("buildBedSpaBriefing — truncation", () => {
  it("says how many salons it left out rather than dropping them silently", () => {
    const many: BedUsageSalonRow[] = Array.from({ length: MAX_BRIEFING_ROWS + 5 }, (_, index) => ({
      salonNumber: String(index + 200).padStart(4, "0"),
      storeName: `Salon ${index}`,
      districtLabel: "D1",
      regionLabel: "R1",
      totalTans: 1000 - index,
      bedCount: 10,
    }));
    const salons = summarizeSalons(many, []);
    const text = briefing({
      company: "Meridian Leisure Group",
      bedUsage: {
        period: PERIOD,
        provenance: provenance(PERIOD, many.length),
        totals: totalsFor(salons),
        levels: [],
        salons: [...salons].sort((a, b) => (b.totalTans ?? -1) - (a.totalTans ?? -1)),
      },
      spaWellness: null,
      spaEngagement: null,
      combined: null,
    });
    expect(text).toContain("5 further salons are not listed here");
    expect(text).toContain("Say so if a question needs the full list");
    // The estate total still counts every salon, so a truncated list cannot
    // make the estate look smaller than it is.
    expect(text).toContain(`Estate: ${MAX_BRIEFING_ROWS + 5} salons`);
  });

  it("adds no note when nothing was left out", () => {
    expect(briefing()).not.toContain("further salons are not listed");
  });
});

describe("buildBedSpaBriefing — figures match the analytics functions", () => {
  it("reports the estate roll-up the dashboard computes, not its own arithmetic", () => {
    const salons = summarizeSalons(BED_SALONS, BED_EQUIPMENT);
    const totals = totalsFor(salons);
    const text = briefing();
    expect(totals.totalTans).toBe(8000);
    expect(totals.bedCount).toBe(30);
    expect(text).toContain("Estate: 2 salons, 8,000 tans, 30 beds, 266.7 tans per bed");
  });

  it("recomputes a level's per-bed figure from the level's own totals", () => {
    // FASTEST: 6,500 tans over 15 units = 433.3, against a chain 320.0.
    const text = briefing();
    const line = text.split("\n").find((row) => row.trim().startsWith("FASTEST:"))!;
    expect(line).toContain("15 units, 6,500 tans, 433.3 per bed");
  });

  it("names the session-weighted peer figure as weighted", () => {
    const text = briefing();
    expect(text).toContain("session-weighted difference against peers");
    expect(text).toContain("weighted by sessions, not an average of the per-type differences");
  });
});
