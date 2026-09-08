import { describe, expect, it } from "vitest";

import {
  detailRows,
  fastMigrationView,
  perBed,
  rankSalons,
  reconcile,
  summarizeLevels,
  summarizeSalons,
  totalsFor,
} from "./bed-usage-analytics";
import { buildCombinedView, worstPeerBandBySalon } from "./combined";
import {
  engagementTotals,
  spaPerUniquePercent,
  spaSessionsPerBed,
  spaSessionsPerUniquePerBed,
  summarizeEngagement,
  uniqueSpaTannerPercent,
} from "./spa-engagement-analytics";
import {
  daysSinceFirstUse,
  equipmentPerformance,
  firstUsedWithinPeriod,
  spaWellnessTotals,
  summarizeSpaSalons,
} from "./spa-wellness-analytics";
import type {
  BedSpaPeriod,
  BedUsageChainBenchmarkRow,
  BedUsageEquipmentRow,
  BedUsageSalonRow,
  SpaEngagementSalonRow,
  SpaEquipmentBenchmarkRow,
  SpaEquipmentTypeRow,
  SpaEquipmentUseRow,
  SpaWellnessSalonRow,
} from "./types";

const AUGUST: BedSpaPeriod = {
  grain: "mtd",
  periodStart: "2026-08-01",
  periodEnd: "2026-08-31",
  labelRaw: "August",
};
const SEPTEMBER: BedSpaPeriod = {
  grain: "mtd",
  periodStart: "2026-09-01",
  periodEnd: "2026-09-01",
  labelRaw: "September",
};

// ------------------------------------------------------------- bed usage ---

const SALONS: BedUsageSalonRow[] = [
  {
    salonNumber: "0001",
    storeName: "Aurora Springs",
    districtLabel: "Hale, Rowan",
    regionLabel: "Vance, Imogen",
    totalTans: 1000,
    bedCount: 5,
  },
  {
    salonNumber: "0002",
    storeName: "Brookmere Park",
    districtLabel: "Hale, Rowan",
    regionLabel: "Vance, Imogen",
    totalTans: 600,
    bedCount: 20,
  },
];

const EQUIPMENT: BedUsageEquipmentRow[] = [
  {
    salonNumber: "0001",
    storeName: "Aurora Springs",
    districtLabel: "Hale, Rowan",
    regionLabel: "Vance, Imogen",
    level: "FASTER",
    bedType: "Solstice 400",
    qty: 4,
    clientTans: 800,
    perBed: 200,
    vChainPercent: 0,
    vBedTypePercent: null,
  },
  {
    salonNumber: "0001",
    storeName: "Aurora Springs",
    districtLabel: "Hale, Rowan",
    regionLabel: "Vance, Imogen",
    level: "SPA",
    bedType: "Calmwave",
    qty: 1,
    clientTans: 200,
    perBed: 200,
    vChainPercent: 66.6666,
    vBedTypePercent: null,
  },
  {
    salonNumber: "0002",
    storeName: "Brookmere Park",
    districtLabel: "Hale, Rowan",
    regionLabel: "Vance, Imogen",
    level: "FAST",
    bedType: "Embers 120",
    qty: 10,
    clientTans: 100,
    perBed: 10,
    vChainPercent: -90,
    vBedTypePercent: null,
  },
  {
    salonNumber: "0002",
    storeName: "Brookmere Park",
    districtLabel: "Hale, Rowan",
    regionLabel: "Vance, Imogen",
    level: "FASTER",
    bedType: "Solstice 400",
    qty: 10,
    clientTans: 500,
    perBed: 50,
    vChainPercent: -75,
    vBedTypePercent: null,
  },
];

const BENCHMARKS: BedUsageChainBenchmarkRow[] = [
  { level: "FAST", tansPerBed: 100, totalBeds: 300 },
  { level: "FASTER", tansPerBed: 200, totalBeds: 1000 },
  { level: "SPA", tansPerBed: 120, totalBeds: 1100 },
];

describe("per-bed usage", () => {
  it("divides tans by beds", () => {
    expect(perBed(1000, 5)).toBe(200);
  });

  it("returns null rather than infinity for zero beds", () => {
    // A salon with no beds has no per-bed usage, which is not a per-bed usage
    // of zero.
    expect(perBed(1000, 0)).toBeNull();
    expect(perBed(1000, null)).toBeNull();
    expect(perBed(null, 5)).toBeNull();
  });

  it("is RECOMPUTED across salons, never averaged", () => {
    const summaries = summarizeSalons(SALONS, EQUIPMENT);
    const totals = totalsFor(summaries);
    // (1000 + 600) / (5 + 20) = 64.
    expect(totals.perBed).toBe(64);
    // Averaging the two salons' per-bed figures gives (200 + 30) / 2 = 115,
    // which weights a 5-bed salon like a 20-bed one.
    const averaged =
      summaries.reduce((total, salon) => total + (salon.perBed ?? 0), 0) / summaries.length;
    expect(averaged).toBe(115);
    expect(totals.perBed).not.toBe(averaged);
  });

  it("counts the salons whose Total Tans the source did not report", () => {
    const totals = totalsFor(
      summarizeSalons([...SALONS, { ...SALONS[0], storeName: "Ghost", totalTans: null }], EQUIPMENT),
    );
    expect(totals.salonsMissingTans).toBe(1);
    // The reported salons still total correctly.
    expect(totals.totalTans).toBe(1600);
  });
});

describe("level roll-up against the chain", () => {
  it("recomputes each level's per-bed figure from its own totals", () => {
    const levels = summarizeLevels(EQUIPMENT, BENCHMARKS);
    const faster = levels.find((level) => level.level === "FASTER")!;
    // (800 + 500) / (4 + 10) = 92.857...
    expect(faster.perBed).toBeCloseTo(1300 / 14, 10);
    expect(faster.chainPerBed).toBe(200);
    expect(faster.versusChain.deltaPercent).toBeCloseTo((1300 / 14 / 200 - 1) * 100, 10);
    expect(faster.versusChain.band).toBe("significantly_underperforming");
  });

  it("does not average the rows' own v Chain figures", () => {
    // Aurora's FASTER row is at 0% and Brookmere's at -75%; their mean is
    // -37.5%, which weights a 4-unit row like a 10-unit one.
    const faster = summarizeLevels(EQUIPMENT, BENCHMARKS).find(
      (level) => level.level === "FASTER",
    )!;
    expect(faster.versusChain.deltaPercent).not.toBeCloseTo(-37.5, 3);
  });

  it("classifies a level with no benchmark as unclassified, with a reason", () => {
    const levels = summarizeLevels(EQUIPMENT, [{ level: "FASTER", tansPerBed: 200, totalBeds: 1 }]);
    const spa = levels.find((level) => level.level === "SPA")!;
    expect(spa.versusChain.band).toBeNull();
    expect(spa.versusChain.unavailableReason).toContain("no chain benchmark");
  });

  it("counts the salons contributing to each level", () => {
    const levels = summarizeLevels(EQUIPMENT, BENCHMARKS);
    expect(levels.find((level) => level.level === "FASTER")!.salonCount).toBe(2);
    expect(levels.find((level) => level.level === "SPA")!.salonCount).toBe(1);
  });
});

describe("the FAST rule in the roll-up", () => {
  it("marks the FAST level advisory and its shortfall unreportable", () => {
    const levels = summarizeLevels(EQUIPMENT, BENCHMARKS);
    const fast = levels.find((level) => level.level === "FAST")!;
    expect(fast.advisoryOnly).toBe(true);
    expect(fast.versusChain.band).toBe("significantly_underperforming");
    expect(fast.versusChain.reportableFinding).toBe(false);
  });

  it("presents FAST as capacity and migration rather than performance", () => {
    const view = fastMigrationView(summarizeLevels(EQUIPMENT, BENCHMARKS));
    expect(view.fastUnits).toBe(10);
    expect(view.fastTans).toBe(100);
    expect(view.fastPerBed).toBe(10);
    // FASTER is the only premium level present: 1,300 tans over 14 units.
    expect(view.premiumUnits).toBe(14);
    expect(view.premiumTans).toBe(1300);
    expect(view.premiumPerBed).toBeCloseTo(1300 / 14, 10);
    expect(view.note).toContain("not as a performance KPI");
  });

  it("computes FAST's share of the estate's beds and tans", () => {
    const view = fastMigrationView(summarizeLevels(EQUIPMENT, BENCHMARKS));
    // 10 of 25 units, 100 of 1,600 tans.
    expect(view.fastShareOfBeds).toBeCloseTo(10 / 25, 10);
    expect(view.fastShareOfTans).toBeCloseTo(100 / 1600, 10);
  });
});

describe("the equipment detail table", () => {
  it("prefers the source's own v Chain over a recomputed one", () => {
    // It is what the report published, and a manager may be holding a printout.
    const rows = detailRows(EQUIPMENT, SALONS, BENCHMARKS);
    const spa = rows.find((row) => row.level === "SPA")!;
    expect(spa.versusChain.deltaPercent).toBe(66.6666);
  });

  it("recomputes when the source's column was absent", () => {
    const rows = detailRows(
      [{ ...EQUIPMENT[0], vChainPercent: null }],
      SALONS,
      BENCHMARKS,
    );
    // 200 per bed against a chain average of 200.
    expect(rows[0].versusChain.deltaPercent).toBeCloseTo(0, 10);
  });

  it("recomputes each row's share of its salon's tans", () => {
    const rows = detailRows(EQUIPMENT, SALONS, BENCHMARKS);
    expect(rows.find((row) => row.level === "SPA")!.shareOfSalonTans).toBeCloseTo(0.2, 10);
  });
});

describe("reconciliation between the two grains", () => {
  it("finds no disagreement when the source is consistent", () => {
    expect(reconcile(SALONS, EQUIPMENT)).toEqual([]);
  });

  it("names a salon whose totals do not add up", () => {
    // A disagreement means one of the two columns was read wrongly, which is a
    // parse defect rather than a data quirk.
    const problems = reconcile([{ ...SALONS[0], totalTans: 999 }, SALONS[1]], EQUIPMENT);
    expect(problems).toEqual([{ storeName: "Aurora Springs", reported: 999, summed: 1000 }]);
  });
});

describe("ranking salons", () => {
  it("excludes salons with no value rather than ranking them last", () => {
    // A salon that did not report is not the worst performer, and putting it
    // at the bottom of a "needs attention" list sends somebody to the wrong
    // store.
    const rows = [
      { name: "a", value: 10 },
      { name: "b", value: null },
      { name: "c", value: 30 },
    ];
    expect(rankSalons(rows, (row) => row.value).map((row) => row.name)).toEqual(["c", "a"]);
  });

  it("ranks ascending and limits when asked", () => {
    const rows = [
      { name: "a", value: 10 },
      { name: "b", value: 20 },
      { name: "c", value: 30 },
    ];
    expect(
      rankSalons(rows, (row) => row.value, { direction: "asc", limit: 2 }).map((row) => row.name),
    ).toEqual(["a", "b"]);
  });
});

// ---------------------------------------------------------- spa wellness ---

const TYPES: SpaEquipmentTypeRow[] = [
  { code: "spa_hydromassage", label: "SPA Hydromassage", shortLabel: "Hydromassage", isComparable: true, displayOrder: 1 },
  { code: "spa_ovation", label: "SPA Ovation", shortLabel: "Ovation", isComparable: true, displayOrder: 2 },
  { code: "other", label: "Other", shortLabel: "Other", isComparable: false, displayOrder: 3 },
];

const USE: SpaEquipmentUseRow[] = [
  {
    salonNumber: "0001",
    storeName: "Aurora Springs",
    equipmentCode: "spa_hydromassage",
    sessions: 100,
    firstUseDate: "2024-02-20",
    lastUseDate: "2026-08-31",
  },
  {
    salonNumber: "0002",
    storeName: "Brookmere Park",
    equipmentCode: "spa_hydromassage",
    sessions: 300,
    firstUseDate: "2026-08-10",
    lastUseDate: "2026-08-31",
  },
  {
    salonNumber: "0001",
    storeName: "Aurora Springs",
    equipmentCode: "other",
    sessions: 40,
    firstUseDate: null,
    lastUseDate: null,
  },
];

const SPA_BENCHMARKS: SpaEquipmentBenchmarkRow[] = [
  {
    equipmentCode: "spa_hydromassage",
    chainSalonCount: 5,
    chainAverageSessions: 320,
    peerSalonCount: 3,
    peerAverageSessions: 500,
  },
  {
    equipmentCode: "spa_ovation",
    chainSalonCount: 2,
    chainAverageSessions: 195,
    peerSalonCount: 2,
    peerAverageSessions: 195,
  },
  {
    equipmentCode: "other",
    chainSalonCount: 1,
    chainAverageSessions: 40,
    peerSalonCount: 0,
    peerAverageSessions: null,
  },
];

const SPA_SALONS: SpaWellnessSalonRow[] = [
  {
    salonNumber: "0001",
    storeName: "Aurora Springs",
    districtLabel: "Hale, Rowan",
    regionLabel: "Vance, Imogen",
    totalSessions: 140,
    equipmentPieces: 4,
    equipmentTypesUsed: 2,
    firstUseDate: "2024-02-20",
    newestFirstUseDate: "2024-02-20",
  },
  {
    salonNumber: "0002",
    storeName: "Brookmere Park",
    districtLabel: "Hale, Rowan",
    regionLabel: "Vance, Imogen",
    totalSessions: 300,
    equipmentPieces: 2,
    equipmentTypesUsed: 1,
    firstUseDate: "2026-08-10",
    newestFirstUseDate: "2026-08-10",
  },
];

describe("spa equipment performance against installed peers", () => {
  it("averages ours over our installed salons and theirs over theirs", () => {
    const performance = equipmentPerformance(TYPES, USE, SPA_BENCHMARKS);
    const hydro = performance.find((entry) => entry.equipmentCode === "spa_hydromassage")!;
    // Ours: 100 and 300 -> 200. Peers: 500.
    expect(hydro.ourSalonCount).toBe(2);
    expect(hydro.ourAverageSessions).toBe(200);
    expect(hydro.peerSalonCount).toBe(3);
    expect(hydro.versusPeers.deltaPercent).toBeCloseTo(-60, 10);
    expect(hydro.versusPeers.band).toBe("significantly_underperforming");
  });

  it("does not compare against the chain average, which is a different answer", () => {
    const hydro = equipmentPerformance(TYPES, USE, SPA_BENCHMARKS).find(
      (entry) => entry.equipmentCode === "spa_hydromassage",
    )!;
    // Against the chain's 320 the delta would be -37.5%: Below Market instead
    // of Significantly Underperforming.
    expect(hydro.versusPeers.deltaPercent).not.toBeCloseTo(-37.5, 3);
  });

  it("produces no entry for equipment nobody in view has", () => {
    // Not a zero-session entry: there is nothing to say about a machine that
    // is not installed.
    const performance = equipmentPerformance(TYPES, USE, SPA_BENCHMARKS);
    expect(performance.map((entry) => entry.equipmentCode)).not.toContain("spa_ovation");
  });

  it("ignores a zero-valued row that an older ingestion might carry", () => {
    // Defence in depth: the parser writes none, but an average must not admit
    // one if a historical period does.
    const performance = equipmentPerformance(
      TYPES,
      [...USE, { ...USE[0], storeName: "Ghost", sessions: 0 }],
      SPA_BENCHMARKS,
    );
    const hydro = performance.find((entry) => entry.equipmentCode === "spa_hydromassage")!;
    expect(hydro.ourSalonCount).toBe(2);
    expect(hydro.ourAverageSessions).toBe(200);
  });

  it("withholds a comparison for the `Other` bucket, with a reason", () => {
    const other = equipmentPerformance(TYPES, USE, SPA_BENCHMARKS).find(
      (entry) => entry.equipmentCode === "other",
    )!;
    expect(other.comparable).toBe(false);
    expect(other.versusPeers.deltaPercent).toBeNull();
    expect(other.versusPeers.unavailableReason).toContain("not the same machine");
    // Its sessions still count towards the estate total.
    expect(other.ourSessions).toBe(40);
  });

  it("withholds a comparison when nobody outside the company has the equipment", () => {
    const performance = equipmentPerformance(
      [TYPES[0]],
      [USE[0]],
      [
        {
          equipmentCode: "spa_hydromassage",
          chainSalonCount: 1,
          chainAverageSessions: 100,
          peerSalonCount: 0,
          peerAverageSessions: null,
        },
      ],
    );
    expect(performance[0].versusPeers.band).toBeNull();
    expect(performance[0].versusPeers.unavailableReason).toContain("no peer average");
  });

  it("keeps the earliest and latest first use across our salons", () => {
    const hydro = equipmentPerformance(TYPES, USE, SPA_BENCHMARKS).find(
      (entry) => entry.equipmentCode === "spa_hydromassage",
    )!;
    expect(hydro.firstUseDate).toBe("2024-02-20");
    expect(hydro.newestFirstUseDate).toBe("2026-08-10");
  });
});

describe("spa wellness totals", () => {
  it("sums sessions and installed units and counts types in use", () => {
    const performance = equipmentPerformance(TYPES, USE, SPA_BENCHMARKS);
    const totals = spaWellnessTotals(SPA_SALONS, performance);
    expect(totals.totalSessions).toBe(440);
    expect(totals.equipmentPieces).toBe(6);
    expect(totals.equipmentTypes).toBe(2);
  });

  it("weights the average peer delta by sessions, and says how many types it covers", () => {
    // An unweighted mean would let a two-salon type cancel a fifteen-salon one.
    const performance = equipmentPerformance(TYPES, USE, SPA_BENCHMARKS);
    const totals = spaWellnessTotals(SPA_SALONS, performance);
    // Only Hydromassage is comparable and has a peer average.
    expect(totals.comparedTypeCount).toBe(1);
    expect(totals.weightedPeerDeltaPercent).toBeCloseTo(-60, 10);
  });

  it("leaves the average delta null when nothing in view can be compared", () => {
    const totals = spaWellnessTotals(SPA_SALONS, []);
    expect(totals.weightedPeerDeltaPercent).toBeNull();
    expect(totals.comparedTypeCount).toBe(0);
  });
});

describe("spa salon summaries and equipment age", () => {
  it("breaks sessions down by equipment and derives sessions per unit", () => {
    const summaries = summarizeSpaSalons(SPA_SALONS, USE);
    const aurora = summaries.find((salon) => salon.storeName === "Aurora Springs")!;
    expect(aurora.sessionsByEquipment).toEqual({ spa_hydromassage: 100, other: 40 });
    expect(aurora.sessionsPerPiece).toBe(35);
  });

  it("returns null sessions per unit rather than dividing by zero", () => {
    const summaries = summarizeSpaSalons(
      [{ ...SPA_SALONS[0], equipmentPieces: 0 }],
      USE,
    );
    expect(summaries[0].sessionsPerPiece).toBeNull();
  });

  it("computes equipment age against a supplied date, never the clock", () => {
    // A figure on an August report must be as of the report's own period end,
    // or it changes every day the page is loaded.
    expect(daysSinceFirstUse("2026-08-01", "2026-08-31")).toBe(30);
    expect(daysSinceFirstUse(null, "2026-08-31")).toBeNull();
  });

  it("flags equipment first used inside the period without judging it", () => {
    const flagged = firstUsedWithinPeriod(USE, AUGUST);
    expect(flagged.map((row) => row.storeName)).toEqual(["Brookmere Park"]);
  });
});

// -------------------------------------------------------- spa engagement ---

describe("the four engagement formulas, kept apart", () => {
  it("computes Spa Per Unique % as sessions over unique tanners", () => {
    expect(spaPerUniquePercent(33, 74)).toBeCloseTo(33 / 74, 12);
    expect(spaPerUniquePercent(33, 74)! * 100).toBeCloseTo(44.5946, 4);
  });

  it("computes Spa Sessions per Bed as sessions over beds", () => {
    expect(spaSessionsPerBed(33, 4)).toBeCloseTo(8.25, 12);
  });

  it("computes the bed-normalized figure as sessions over unique over beds", () => {
    expect(spaSessionsPerUniquePerBed(33, 74, 4)).toBeCloseTo(33 / 74 / 4, 12);
    expect(spaSessionsPerUniquePerBed(33, 74, 4)).toBeCloseTo(0.11148648648648649, 15);
  });

  it("gives Spa Per Unique % and the bed-normalized figure DIFFERENT values", () => {
    /*
     * THE CONFLATION THIS SUITE EXISTS FOR. For NE Grand Island on 1 September
     * 2026 the two are 44.6% and 0.1115. Labelling the second as the first
     * would report a store converting 45% of its customers as converting 11%.
     */
    const perUnique = spaPerUniquePercent(33, 74)!;
    const perUniquePerBed = spaSessionsPerUniquePerBed(33, 74, 4)!;
    expect(perUnique).not.toBeCloseTo(perUniquePerBed, 6);
    expect(perUnique / perUniquePerBed).toBeCloseTo(4, 10);
  });

  it("computes Unique Spa Tanner % as unique spa tanners over unique tanners", () => {
    expect(uniqueSpaTannerPercent(17, 74)).toBeCloseTo(17 / 74, 12);
  });

  it("returns null rather than zero on a missing or zero denominator", () => {
    for (const compute of [
      () => spaPerUniquePercent(33, 0),
      () => spaPerUniquePercent(33, null),
      () => spaSessionsPerBed(33, 0),
      () => spaSessionsPerUniquePerBed(33, 74, 0),
      () => spaSessionsPerUniquePerBed(33, 0, 4),
      () => uniqueSpaTannerPercent(17, 0),
    ]) {
      expect(compute()).toBeNull();
    }
  });

  it("treats a zero numerator as a real answer", () => {
    expect(spaPerUniquePercent(0, 74)).toBe(0);
    expect(uniqueSpaTannerPercent(0, 74)).toBe(0);
  });
});

const ENGAGEMENT: SpaEngagementSalonRow[] = [
  {
    salonNumber: "0001",
    storeName: "Aurora Springs",
    districtLabel: "Hale, Rowan",
    regionLabel: "Vance, Imogen",
    ownership: "Fran",
    spaSessions: 33,
    totalUniqueTanners: 74,
    uniqueSpaTanners: 17,
    spaBeds: 4,
    ranks: { rank_spa_sessions_per_bed: 20 },
    overallRank: 7,
  },
  {
    salonNumber: "0002",
    storeName: "Brookmere Park",
    districtLabel: "Hale, Rowan",
    regionLabel: "Vance, Imogen",
    ownership: "Fran",
    spaSessions: 21,
    totalUniqueTanners: 155,
    uniqueSpaTanners: 15,
    spaBeds: 6,
    ranks: { rank_spa_sessions_per_bed: 132 },
    overallRank: 171,
  },
];

describe("engagement totals", () => {
  it("recomputes every ratio from the sums", () => {
    const totals = engagementTotals(summarizeEngagement(ENGAGEMENT));
    expect(totals.spaSessions).toBe(54);
    expect(totals.totalUniqueTanners).toBe(229);
    expect(totals.spaBeds).toBe(10);
    expect(totals.spaPerUniquePercent).toBeCloseTo(54 / 229, 12);
    expect(totals.uniqueSpaTannerPercent).toBeCloseTo(32 / 229, 12);
    expect(totals.spaSessionsPerBed).toBeCloseTo(5.4, 12);
    expect(totals.spaSessionsPerUniquePerBed).toBeCloseTo(54 / 229 / 10, 12);
  });

  it("is not the average of the salons' ratios", () => {
    // The source makes the same distinction: its `All` row is a sum and its
    // `All Average` row is a per-salon mean, and they are different numbers.
    const summaries = summarizeEngagement(ENGAGEMENT);
    const totals = engagementTotals(summaries);
    const mean =
      summaries.reduce((total, salon) => total + (salon.spaPerUniquePercent ?? 0), 0) /
      summaries.length;
    expect(totals.spaPerUniquePercent).not.toBeCloseTo(mean, 6);
  });

  it("keeps the best and worst chain-wide rank in view", () => {
    const totals = engagementTotals(summarizeEngagement(ENGAGEMENT));
    expect(totals.bestOverallRank).toBe(7);
    expect(totals.worstOverallRank).toBe(171);
  });
});

// ------------------------------------------------------------- combined ---

describe("the combined operational view", () => {
  const bedSummaries = summarizeSalons(SALONS, EQUIPMENT);
  const spaSummaries = summarizeSpaSalons(SPA_SALONS, USE);
  const engagementSummaries = summarizeEngagement(ENGAGEMENT);

  it("joins the three reports on canonical salon identity", () => {
    const view = buildCombinedView({
      bedUsage: bedSummaries,
      bedUsagePeriod: AUGUST,
      spaWellness: spaSummaries,
      spaWellnessPeriod: AUGUST,
      spaEngagement: engagementSummaries,
      spaEngagementPeriod: AUGUST,
    });
    expect(view.rows).toHaveLength(2);
    const aurora = view.rows.find((row) => row.storeName === "Aurora Springs")!;
    expect(aurora.sources).toEqual({ bedUsage: true, spaWellness: true, spaEngagement: true });
    expect(aurora.totalTans).toBe(1000);
    expect(aurora.spaSessions).toBe(140);
    expect(aurora.conversion.available).toBe(true);
    if (!aurora.conversion.available) throw new Error("unreachable");
    expect(aurora.conversion.rate).toBeCloseTo(0.14, 12);
  });

  it("refuses every conversion when the two periods do not match", () => {
    const view = buildCombinedView({
      bedUsage: bedSummaries,
      bedUsagePeriod: AUGUST,
      spaWellness: spaSummaries,
      spaWellnessPeriod: SEPTEMBER,
      spaEngagement: engagementSummaries,
      spaEngagementPeriod: SEPTEMBER,
    });
    expect(view.conversionAvailable).toBe(false);
    expect(view.periodMismatchNote).toContain("2026-09-01");
    for (const row of view.rows) {
      expect(row.conversion.available).toBe(false);
      expect(row.status).toBe("insufficient_data");
    }
    expect(view.totals.conversion.available).toBe(false);
  });

  it("keeps a salon present in one report and absent from another, and says so", () => {
    // An intersection would hide exactly the salon somebody needs to know
    // about.
    const view = buildCombinedView({
      bedUsage: bedSummaries,
      bedUsagePeriod: AUGUST,
      spaWellness: [spaSummaries[0]],
      spaWellnessPeriod: AUGUST,
      spaEngagement: engagementSummaries,
      spaEngagementPeriod: AUGUST,
    });
    expect(view.rows).toHaveLength(2);
    expect(view.unjoined.missingFromSpaWellness).toEqual(["Brookmere Park"]);
    const brookmere = view.rows.find((row) => row.storeName === "Brookmere Park")!;
    expect(brookmere.conversion).toMatchObject({ available: false, reason: "sessions_missing" });
  });

  it("reads a salon converting above the estate with sound equipment as strong execution", () => {
    const view = buildCombinedView({
      bedUsage: bedSummaries,
      bedUsagePeriod: AUGUST,
      spaWellness: spaSummaries,
      spaWellnessPeriod: AUGUST,
      spaEngagement: engagementSummaries,
      spaEngagementPeriod: AUGUST,
      peerBandBySalon: { "Aurora Springs": "at_market", "Brookmere Park": "at_market" },
    });
    // Estate conversion is 440 / 1,600 = 27.5%. Brookmere is at 50%, Aurora
    // at 14%.
    const brookmere = view.rows.find((row) => row.storeName === "Brookmere Park")!;
    expect(brookmere.status).toBe("strong_execution");
  });

  it("distinguishes a converting salon whose equipment trails its peers", () => {
    const view = buildCombinedView({
      bedUsage: bedSummaries,
      bedUsagePeriod: AUGUST,
      spaWellness: spaSummaries,
      spaWellnessPeriod: AUGUST,
      spaEngagement: engagementSummaries,
      spaEngagementPeriod: AUGUST,
      peerBandBySalon: { "Brookmere Park": "significantly_underperforming" },
    });
    expect(view.rows.find((row) => row.storeName === "Brookmere Park")!.status).toBe(
      "converting_with_weak_equipment",
    );
  });

  it("reads a high-traffic low-conversion salon as traffic without conversion", () => {
    const view = buildCombinedView({
      bedUsage: bedSummaries,
      bedUsagePeriod: AUGUST,
      spaWellness: spaSummaries,
      spaWellnessPeriod: AUGUST,
      spaEngagement: engagementSummaries,
      spaEngagementPeriod: AUGUST,
    });
    // Aurora has 1,000 tans against an estate average of 800, and converts at
    // 14% against an estate rate of 27.5%.
    expect(view.rows.find((row) => row.storeName === "Aurora Springs")!.status).toBe(
      "traffic_without_conversion",
    );
  });

  it("flags mid-period equipment ahead of any performance reading", () => {
    // It changes how every other figure on the row should be read, and it is
    // a fact about the period rather than an excuse.
    const view = buildCombinedView({
      bedUsage: bedSummaries,
      bedUsagePeriod: AUGUST,
      spaWellness: spaSummaries,
      spaWellnessPeriod: AUGUST,
      spaEngagement: engagementSummaries,
      spaEngagementPeriod: AUGUST,
      partialPeriodSalons: ["Brookmere Park"],
    });
    expect(view.rows.find((row) => row.storeName === "Brookmere Park")!.status).toBe(
      "partial_period_equipment",
    );
  });

  it("computes the estate conversion from the sums, not from the rates", () => {
    const view = buildCombinedView({
      bedUsage: bedSummaries,
      bedUsagePeriod: AUGUST,
      spaWellness: spaSummaries,
      spaWellnessPeriod: AUGUST,
      spaEngagement: engagementSummaries,
      spaEngagementPeriod: AUGUST,
    });
    expect(view.totals.conversion.available).toBe(true);
    if (!view.totals.conversion.available) throw new Error("unreachable");
    expect(view.totals.conversion.rate).toBeCloseTo(440 / 1600, 12);
  });
});

describe("the worst peer band per salon", () => {
  it("takes the worst rather than an average", () => {
    // A single unit running far below its peers is the finding; averaging it
    // against three healthy ones hides what the comparison is for.
    expect(
      worstPeerBandBySalon([
        { storeName: "Aurora Springs", band: "outperforming", reportableFinding: true },
        { storeName: "Aurora Springs", band: "below_market", reportableFinding: true },
        { storeName: "Aurora Springs", band: "at_market", reportableFinding: true },
      ]),
    ).toEqual({ "Aurora Springs": "below_market" });
  });

  it("ignores an entry whose shortfall must not be raised", () => {
    expect(
      worstPeerBandBySalon([
        { storeName: "Aurora Springs", band: "at_market", reportableFinding: true },
        {
          storeName: "Aurora Springs",
          band: "significantly_underperforming",
          reportableFinding: false,
        },
      ]),
    ).toEqual({ "Aurora Springs": "at_market" });
  });

  it("records a salon with nothing comparable as null rather than omitting it", () => {
    expect(
      worstPeerBandBySalon([
        { storeName: "Aurora Springs", band: null, reportableFinding: false },
      ]),
    ).toEqual({ "Aurora Springs": null });
  });
});
