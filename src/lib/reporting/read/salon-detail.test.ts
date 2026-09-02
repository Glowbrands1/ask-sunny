import { describe, expect, it } from "vitest";

import type { FactRow } from "./dashboard";
import {
  buildSalonKpis,
  buildSalonMetricRows,
  buildSalonWindowComparisons,
  reportedComparisons,
  salonDescriptorEntries,
} from "./salon-detail";
import type { MetricDescriptor, SalonPeriodDescriptors } from "./types";
import { basisYearWindow, currentWindow, rollingWindow } from "./windows";

/**
 * THE SALON DRILL-DOWN VIEW MODEL.
 *
 * Every figure below is invented. What is real is the SHAPE: two month-to-date
 * sheets that describe the same period and carry same-named codes, one
 * year-to-date sheet on its own period, and a measure (`spa_sessions`) the
 * source genuinely has no 2019 figures for.
 *
 * The tests worth reading are the ones about mixing: a page that shows one
 * sheet's number under another sheet's heading is wrong in a way nobody would
 * notice by looking at it.
 */

const VS2024 = "CompReport(MTD) vs 2024";
const ROLLING = "CompReport(MTD)";
const YTD = "CompReport(YTD)";
const YEAR = 2026;

function metric(
  code: string,
  overrides: Partial<MetricDescriptor> = {},
): MetricDescriptor {
  return {
    code,
    label: code.replace(/_/g, " "),
    family: "revenue",
    unit: "currency",
    higherIsBetter: true,
    basisYearRequired: true,
    comparisonOfCode: null,
    description: "",
    availableBasisYears: [2026, 2024],
    factCount: 15,
    salonCount: 15,
    sourceSheet: VS2024,
    ...overrides,
  };
}

function fact(
  metricCode: string,
  basisYear: number | null,
  value: number,
  sourceSheet = VS2024,
  sourceColumn = "H",
): FactRow {
  return {
    salonNumber: "0468",
    storeName: "Invented Store",
    metricCode,
    basisYear,
    value,
    sourceSheet,
    sourceColumn,
  };
}

describe("headline measures for one salon", () => {
  const catalogue = [
    metric("total_revenue"),
    metric("total_revenue_pct_change", {
      unit: "percent",
      comparisonOfCode: "total_revenue",
      availableBasisYears: [2024],
    }),
  ];

  it("shows the salon's own figure, not an aggregate of anything", () => {
    const [kpi] = buildSalonKpis({
      metricCodes: ["total_revenue"],
      catalogue,
      facts: [fact("total_revenue", 2026, 41_000), fact("total_revenue", 2024, 38_000)],
      window: basisYearWindow(2024, VS2024),
      currentYear: YEAR,
    });

    expect(kpi.current.value).toBe(41_000);
    expect(kpi.baseline?.value).toBe(38_000);
    expect(kpi.supported).toBe(true);
    expect(kpi.unavailableReason).toBeNull();
  });

  it("carries the sheet and column each figure came from", () => {
    // The whole point of the lineage action on the page: the answer has to be
    // attached to the figure, not looked up afterwards from the report.
    const [kpi] = buildSalonKpis({
      metricCodes: ["total_revenue"],
      catalogue,
      facts: [
        fact("total_revenue", 2026, 41_000, VS2024, "H"),
        fact("total_revenue", 2024, 38_000, VS2024, "I"),
      ],
      window: basisYearWindow(2024, VS2024),
      currentYear: YEAR,
    });

    expect(kpi.current.sourceSheet).toBe(VS2024);
    expect(kpi.current.sourceColumn).toBe("H");
    expect(kpi.baseline?.sourceColumn).toBe("I");
  });

  it("prefers the change the source reported over one it could derive", () => {
    const [kpi] = buildSalonKpis({
      metricCodes: ["total_revenue"],
      catalogue,
      facts: [
        fact("total_revenue", 2026, 41_000),
        fact("total_revenue", 2024, 38_000),
        // Not what (41000-38000)/38000 gives. The source's figure wins anyway,
        // because it may be computed against a population this copy lacks.
        fact("total_revenue_pct_change", 2024, 0.0512, VS2024, "J"),
      ],
      window: basisYearWindow(2024, VS2024),
      currentYear: YEAR,
    });

    expect(kpi.change.source).toBe("reported");
    expect(kpi.change.value).toBe(0.0512);
  });

  it("derives a change only when the source states none, and says so", () => {
    const [kpi] = buildSalonKpis({
      metricCodes: ["total_revenue"],
      catalogue,
      facts: [fact("total_revenue", 2026, 40_000), fact("total_revenue", 2024, 32_000)],
      window: basisYearWindow(2024, VS2024),
      currentYear: YEAR,
    });

    expect(kpi.change.source).toBe("derived");
    expect(kpi.change.value).toBeCloseTo(0.25, 10);
    expect(kpi.change.note).toMatch(/computed from this salon/i);
  });

  it("reports a missing figure as unavailable, never as zero", () => {
    const [kpi] = buildSalonKpis({
      metricCodes: ["total_revenue"],
      catalogue,
      // This salon simply has no row for the measure.
      facts: [],
      window: basisYearWindow(2024, VS2024),
      currentYear: YEAR,
    });

    expect(kpi.current.value).toBeNull();
    expect(kpi.unavailableReason).toMatch(/no .* figure/i);
    expect(kpi.change.value).toBeNull();
    expect(kpi.change.source).toBe("unavailable");
  });

  it("gives no baseline side at all when the comparison figure is absent", () => {
    // Zero would show a total collapse that never happened; a zero baseline
    // would also make any derived change infinite.
    const [kpi] = buildSalonKpis({
      metricCodes: ["total_revenue"],
      catalogue,
      facts: [fact("total_revenue", 2026, 41_000)],
      window: basisYearWindow(2024, VS2024),
      currentYear: YEAR,
    });

    expect(kpi.baseline).toBeNull();
    expect(kpi.change.value).toBeNull();
  });

  it("does not fabricate a 2019 baseline for a measure that has none", () => {
    // Spa Sessions is the real case: the workbook carries no 2019 block for it.
    const spa = [
      metric("spa_sessions", {
        family: "spa",
        unit: "count",
        availableBasisYears: [2026, 2024],
      }),
    ];
    const [kpi] = buildSalonKpis({
      metricCodes: ["spa_sessions"],
      catalogue: spa,
      facts: [fact("spa_sessions", 2026, 210, VS2024, "AB")],
      window: basisYearWindow(2019, VS2024),
      currentYear: YEAR,
    });

    expect(kpi.supported).toBe(false);
    expect(kpi.baseline).toBeNull();
    // The 2026 figure IS reported, so the tile shows it; what is absent is the
    // comparison, and the note says the report does not carry it.
    expect(kpi.current.value).toBe(210);
    expect(kpi.unavailableReason).toBeNull();
    expect(kpi.change.value).toBeNull();
    expect(kpi.change.note).toMatch(/does not carry/i);
  });

  it("offers no comparison at all on a current-only window", () => {
    const [kpi] = buildSalonKpis({
      metricCodes: ["total_revenue"],
      catalogue,
      facts: [fact("total_revenue", 2026, 41_000)],
      window: currentWindow("MTD", VS2024),
      currentYear: YEAR,
    });

    expect(kpi.baselineLabel).toBeNull();
    expect(kpi.change.source).toBe("unavailable");
    expect(kpi.change.note).toMatch(/no comparison window/i);
  });

  it("skips a measure with no approved definition rather than showing its code", () => {
    const kpis = buildSalonKpis({
      metricCodes: ["total_revenue", "not_in_the_vocabulary"],
      catalogue,
      facts: [fact("total_revenue", 2026, 1)],
      window: basisYearWindow(2024, VS2024),
      currentYear: YEAR,
    });

    expect(kpis).toHaveLength(1);
    expect(kpis[0].metricCode).toBe("total_revenue");
  });
});

describe("every figure reported for the salon", () => {
  const catalogue = [
    metric("total_revenue"),
    metric("eft_revenue"),
    metric("total_tans", { family: "volume", unit: "count" }),
    metric("total_revenue_pct_change", {
      unit: "percent",
      comparisonOfCode: "total_revenue",
    }),
  ];

  it("builds a row per fact, keeping its basis year and lineage", () => {
    const rows = buildSalonMetricRows({
      catalogue,
      facts: [
        fact("total_revenue", 2026, 41_000, VS2024, "H"),
        fact("total_revenue", 2024, 38_000, VS2024, "I"),
        fact("total_revenue_pct_change", 2024, 0.078, VS2024, "J"),
      ],
      currentYear: YEAR,
    });

    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.sourceColumn)).toEqual(
      expect.arrayContaining(["H", "I", "J"]),
    );
  });

  it("puts the current year ahead of its comparisons", () => {
    const rows = buildSalonMetricRows({
      catalogue,
      facts: [
        fact("total_revenue", 2019, 30_000),
        fact("total_revenue", 2024, 38_000),
        fact("total_revenue", 2026, 41_000),
      ],
      currentYear: YEAR,
    });

    expect(rows.map((row) => row.basisYear)).toEqual([2026, 2024, 2019]);
  });

  it("groups related measures together", () => {
    const rows = buildSalonMetricRows({
      catalogue,
      facts: [
        fact("total_tans", 2026, 900),
        fact("total_revenue", 2026, 41_000),
        fact("eft_revenue", 2026, 22_000),
      ],
      currentYear: YEAR,
    });

    // revenue before volume, and alphabetical within the family.
    expect(rows.map((row) => row.metricCode)).toEqual([
      "eft_revenue",
      "total_revenue",
      "total_tans",
    ]);
  });

  it("omits a fact with no approved definition rather than inventing a label", () => {
    const rows = buildSalonMetricRows({
      catalogue,
      facts: [fact("total_revenue", 2026, 1), fact("mystery_code", 2026, 2)],
      currentYear: YEAR,
    });

    expect(rows).toHaveLength(1);
  });

  it("keeps a percentage as a percentage rather than flattening every unit", () => {
    const rows = buildSalonMetricRows({
      catalogue,
      facts: [fact("total_revenue_pct_change", 2024, -0.0299)],
      currentYear: YEAR,
    });

    expect(rows[0].unit).toBe("percent");
    expect(rows[0].value).toBe(-0.0299);
    expect(rows[0].comparisonOfCode).toBe("total_revenue");
  });
});

describe("one measure across the report's comparisons", () => {
  /**
   * The shape that makes this section dangerous, and therefore worth testing:
   * BOTH month-to-date sheets carry a `total_revenue` current figure for 2026,
   * with different values and different columns. Nothing about the code alone
   * distinguishes them.
   */
  const catalogue = [
    metric("total_revenue", { sourceSheet: VS2024, availableBasisYears: [2026, 2024, 2019] }),
    metric("total_revenue_pct_change", {
      sourceSheet: VS2024,
      unit: "percent",
      comparisonOfCode: "total_revenue",
      availableBasisYears: [2024, 2019],
    }),
    metric("total_revenue_last_3m_current", {
      sourceSheet: ROLLING,
      availableBasisYears: [],
    }),
    metric("total_revenue_last_3m_prior", {
      sourceSheet: ROLLING,
      availableBasisYears: [],
    }),
  ];

  const facts = [
    fact("total_revenue", 2026, 41_000, VS2024, "H"),
    fact("total_revenue", 2024, 38_000, VS2024, "I"),
    fact("total_revenue", 2019, 31_000, VS2024, "N"),
    fact("total_revenue_pct_change", 2024, 0.0789, VS2024, "J"),
    // Same code stem, different sheet, deliberately different value. Rolling
    // figures carry no basis year: the window IS the period.
    fact("total_revenue_last_3m_current", null, 122_000, ROLLING, "D"),
    fact("total_revenue_last_3m_prior", null, 118_000, ROLLING, "E"),
  ];

  const windows = [
    basisYearWindow(2024, VS2024),
    basisYearWindow(2019, VS2024),
    rollingWindow(3, ROLLING),
  ];

  it("reads each window from its own sheet", () => {
    const comparisons = buildSalonWindowComparisons({
      metricCode: "total_revenue",
      windows,
      catalogue,
      facts,
      currentYear: YEAR,
    });

    const vs2024 = comparisons.find((entry) => entry.windowId === "2024")!;
    const rolling = comparisons.find((entry) => entry.kind === "rolling")!;

    expect(vs2024.current.value).toBe(41_000);
    expect(vs2024.current.sourceSheet).toBe(VS2024);
    // The rolling figure is the ROLLING sheet's, not the year sheet's 41,000.
    expect(rolling.current.value).toBe(122_000);
    expect(rolling.current.sourceSheet).toBe(ROLLING);
  });

  it("never lets one sheet's figure appear under another sheet's heading", () => {
    // Drop the rolling facts entirely. The rolling window must go unavailable,
    // NOT quietly borrow the year sheet's 2026 figure, which shares a period.
    const comparisons = buildSalonWindowComparisons({
      metricCode: "total_revenue",
      windows,
      catalogue,
      facts: facts.filter((entry) => entry.sourceSheet !== ROLLING),
      currentYear: YEAR,
    });

    const rolling = comparisons.find((entry) => entry.kind === "rolling")!;
    expect(rolling.current.value).toBeNull();
  });

  it("labels each comparison with its own headings", () => {
    const comparisons = buildSalonWindowComparisons({
      metricCode: "total_revenue",
      windows,
      catalogue,
      facts,
      currentYear: YEAR,
    });

    const vs2019 = comparisons.find((entry) => entry.windowId === "2019")!;
    expect(vs2019.baselineLabel).toContain("2019");
    expect(vs2019.baseline?.value).toBe(31_000);
  });

  it("uses the reported change where the source states one", () => {
    const comparisons = buildSalonWindowComparisons({
      metricCode: "total_revenue",
      windows,
      catalogue,
      facts,
      currentYear: YEAR,
    });

    const vs2024 = comparisons.find((entry) => entry.windowId === "2024")!;
    expect(vs2024.changeSource).toBe("reported");
    expect(vs2024.change).toBe(0.0789);
  });

  it("marks a window the sheet does not report as unsupported", () => {
    const comparisons = buildSalonWindowComparisons({
      metricCode: "eft_revenue",
      windows,
      // eft_revenue exists only on the year-comparison sheet.
      catalogue: [...catalogue, metric("eft_revenue", { sourceSheet: VS2024 })],
      facts: [fact("eft_revenue", 2026, 22_000, VS2024, "K")],
      currentYear: YEAR,
    });

    expect(comparisons.find((entry) => entry.kind === "rolling")!.supported).toBe(false);
  });

  it("keeps a year-to-date period to its own comparisons", () => {
    /*
     * YTD is a SEPARATE PERIOD with its own windows — here, only `vs 2025`.
     * The windows list a caller passes in comes from one period's catalogue, so
     * there is no arrangement of these arguments that puts an MTD figure into a
     * YTD row. This test pins that the YTD sheet's own figures are what appear.
     */
    const ytdCatalogue = [
      metric("total_revenue", { sourceSheet: YTD, availableBasisYears: [2026, 2025] }),
    ];
    const comparisons = buildSalonWindowComparisons({
      metricCode: "total_revenue",
      windows: [basisYearWindow(2025, YTD)],
      catalogue: ytdCatalogue,
      facts: [
        fact("total_revenue", 2026, 305_000, YTD, "F"),
        fact("total_revenue", 2025, 288_000, YTD, "G"),
        // An MTD fact for the same code, present but on another sheet.
        fact("total_revenue", 2026, 41_000, VS2024, "H"),
      ],
      currentYear: YEAR,
    });

    expect(comparisons).toHaveLength(1);
    expect(comparisons[0].current.value).toBe(305_000);
    expect(comparisons[0].current.sourceSheet).toBe(YTD);
    expect(comparisons[0].baseline?.value).toBe(288_000);
  });

  it("filters to the comparisons that actually have a figure", () => {
    const comparisons = buildSalonWindowComparisons({
      metricCode: "total_revenue",
      windows,
      catalogue,
      facts: facts.filter((entry) => entry.sourceSheet !== ROLLING),
      currentYear: YEAR,
    });

    expect(comparisons).toHaveLength(3);
    expect(reportedComparisons(comparisons)).toHaveLength(2);
  });
});

describe("the salon's descriptors", () => {
  const salon: SalonPeriodDescriptors = {
    salonNumber: "0468",
    storeName: "Invented Store",
    districtLabel: "Invented-District, Alpha",
    regionLabel: "Invented Region North",
    company: "Invented Holdings",
    ownershipGroup: "Owner Group One",
    dma: "DMA 101",
    pricingPlan: null,
    isCompSalon: true,
    quintileGroup: "Top 20%",
    revenueRank: 12,
    salonAgeYears: 7,
    avgClientAge: 31,
    spaPieces: 2,
  };

  it("lists what was reported, in reading order", () => {
    expect(salonDescriptorEntries(salon).map((entry) => entry.label)).toEqual([
      "District",
      "Region",
      "Ownership group",
      "DMA",
      "Company",
    ]);
  });

  it("drops a descriptor the source did not report rather than printing a blank", () => {
    const entries = salonDescriptorEntries({
      ...salon,
      regionLabel: null,
      dma: "",
      ownershipGroup: "   ",
    });
    expect(entries.map((entry) => entry.label)).toEqual(["District", "Company"]);
  });

  it("keeps a leading-zero salon number as text", () => {
    // Not a descriptor entry, but the invariant the whole page rests on.
    expect(salon.salonNumber).toBe("0468");
    expect(String(Number(salon.salonNumber))).not.toBe(salon.salonNumber);
  });
});
