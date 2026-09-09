import { describe, expect, it } from "vitest";

import { buildMovers, type DashboardKpi, type SalonRankingRow } from "./dashboard";
import {
  buildSalonPerformanceBriefing,
  MAX_SALON_PERFORMANCE_BRIEFING_ROWS,
  SALON_PERFORMANCE_BRIEFING_RULES,
} from "./salon-performance-briefing";
import type { MetricDescriptor, ReportScope } from "./types";
import type { PerformanceWindow } from "./windows";

/**
 * ============================================================================
 * WHAT THE SALON PERFORMANCE SECTION MUST AND MUST NOT SAY
 * ============================================================================
 *
 * Three claims this source will make if it is let, in descending order of how
 * badly they would mislead:
 *
 *   IT IS NOT THE CHAIN. The workbook is one recipient's filtered copy, so
 *   "revenue is up 4%" read as a chain figure is the most plausible wrong
 *   sentence this data can produce.
 *
 *   A CHANGE IS EITHER REPORTED OR DERIVED. The workbook publishes its own %
 *   change columns; where one is missing the read layer computes it. Presenting
 *   a derived change as the source's own overstates what is known.
 *
 *   A MEDIAN IS NOT AN AVERAGE. For anything not summable the dashboard takes
 *   the median of reported per-salon changes, because a mean would weight a
 *   small salon equally with a large one. The heading has to say median.
 */

const SCOPE: ReportScope = {
  ingestionId: "ing-1",
  periodId: "per-1",
  grain: "mtd",
  periodStart: "2026-08-01",
  periodEnd: "2026-08-30",
  periodLabel: "08/30/2026",
  fiscalYear: 2026,
  salonCount: 15,
  factCount: 4200,
  metricCount: 24,
  ingestedAt: "2026-09-01T09:15:00Z",
  parserKey: "comp_sales_mtd",
  parserVersion: 1,
  companyWide: false,
};

const WINDOW: PerformanceWindow = {
  id: "2024",
  label: "vs 2024",
  shortLabel: "2024",
  kind: "basis_year",
  basisYear: 2024,
  windowKey: null,
  months: null,
  caveat: null,
  sourceSheet: "CompReport(MTD)",
};

const REVENUE: MetricDescriptor = {
  code: "total_revenue",
  label: "Total Revenue",
  family: "revenue",
  unit: "currency",
  higherIsBetter: true,
  basisYearRequired: true,
  comparisonOfCode: null,
  description: "",
  availableBasisYears: [2024, 2026],
  factCount: 30,
  salonCount: 15,
  sourceSheet: "CompReport(MTD)",
};

function kpi(overrides: Partial<DashboardKpi> = {}): DashboardKpi {
  return {
    metricCode: "total_revenue",
    label: "Total Revenue",
    unit: "currency",
    higherIsBetter: true,
    current: {
      metricCode: "total_revenue",
      basisYear: 2026,
      kind: "sum",
      value: 412_000,
      salonCount: 15,
      companyWide: false,
    },
    baseline: {
      metricCode: "total_revenue",
      basisYear: 2024,
      kind: "sum",
      value: 396_000,
      salonCount: 15,
      companyWide: false,
    },
    change: { value: 0.0404, source: "reported", note: "" },
    salonCount: 15,
    currentLabel: "2026",
    baselineLabel: "2024",
    supported: true,
    ...overrides,
  };
}

function row(overrides: Partial<SalonRankingRow> = {}): SalonRankingRow {
  return {
    salonNumber: "0123",
    storeName: "KS Lawrence",
    current: 28_400,
    baseline: 26_900,
    change: 0.0558,
    changeSource: "reported",
    revenueRank: 74,
    quintileGroup: "Q2",
    districtLabel: "Cotton, Sarah",
    regionLabel: "Midwest",
    ...overrides,
  };
}

const ROWS = [
  row(),
  row({ salonNumber: "0456", storeName: "KS Manhattan", change: -0.0812, changeSource: "derived" }),
  row({
    salonNumber: "0789",
    storeName: "KS Topeka",
    current: null,
    baseline: null,
    change: null,
    changeSource: "unavailable",
    revenueRank: null,
  }),
];

function build(overrides: Partial<Parameters<typeof buildSalonPerformanceBriefing>[0]> = {}) {
  return (
    buildSalonPerformanceBriefing({
      scope: SCOPE,
      window: WINDOW,
      kpis: [kpi()],
      selectedMetric: REVENUE,
      rows: ROWS,
      movers: buildMovers([...ROWS]),
      periodSalonCount: 15,
      selectionLabel: null,
      fellBackToNewest: false,
      ...overrides,
    }) ?? ""
  );
}

describe("nothing loaded means no section", () => {
  it("returns null rather than an empty heading", () => {
    expect(
      buildSalonPerformanceBriefing({
        scope: SCOPE,
        window: WINDOW,
        kpis: [],
        selectedMetric: null,
        rows: [],
        movers: buildMovers([]),
        periodSalonCount: 0,
        selectionLabel: null,
        fellBackToNewest: false,
      }),
    ).toBeNull();
  });
});

describe("it is never the chain", () => {
  it("says the population and that it is the recipient's own slice", () => {
    const text = build();
    expect(text).toContain("Population: all 15 salons in the period");
    expect(text).toContain("This is the recipient's own slice, never the chain");
  });

  it("names how many salons each aggregate covers", () => {
    expect(build()).toContain("(total across the salons, 15 salons)");
  });

  it("states the rule as well", () => {
    expect(SALON_PERFORMANCE_BRIEFING_RULES).toContain("THIS DELIVERY'S SALONS ONLY");
    expect(SALON_PERFORMANCE_BRIEFING_RULES).toContain("Never describe one as company-wide");
  });

  it("names the narrowed population when a filter applied", () => {
    const text = build({ selectionLabel: "district Cotton, Sarah" });
    expect(text).toContain("3 selected salon(s) of 15 in the period (district Cotton, Sarah)");
  });
});

describe("the period and the comparison are always named", () => {
  it("carries the grain, both dates and the source's own period label", () => {
    const text = build();
    expect(text).toContain("MTD period 2026-08-01 to 2026-08-30");
    expect(text).toContain('the source labelled it "08/30/2026"');
  });

  it("names the comparison, the sheet it is a column of, and the parser", () => {
    const text = build();
    expect(text).toContain("Comparison: vs 2024");
    expect(text).toContain('workbook sheet "CompReport(MTD)"');
    expect(text).toContain("parser comp_sales_mtd v1");
  });

  it("carries a window's caveat when it has one", () => {
    // Some comparisons must never be displayed without their caveat; a chat
    // answer is a display.
    const text = build({
      window: { ...WINDOW, caveat: "The trailing window overlaps the current month." },
    });
    expect(text).toContain("Caveat that must travel with this comparison:");
    expect(text).toContain("overlaps the current month");
  });

  it("says out loud when it read a different period from the one asked for", () => {
    expect(build({ fellBackToNewest: true })).toContain("NEWEST period was read instead");
  });
});

describe("a change says how it was obtained", () => {
  it("marks a reported change as reported and a derived one as derived", () => {
    const text = build();
    expect(text).toContain("change +4.0% (reported)");
    expect(text).toContain("KS Manhattan (0456)");
    expect(text).toContain("(derived)");
  });

  it("states the rule", () => {
    expect(SALON_PERFORMANCE_BRIEFING_RULES).toContain(
      "REPORTED BY THE SOURCE OR DERIVED FROM THE TWO SIDES",
    );
    expect(SALON_PERFORMANCE_BRIEFING_RULES).toContain(
      "Do not present a derived change as the source's own",
    );
  });
});

describe("a measure the window does not carry is a gap, not a zero", () => {
  it("says NOT REPORTED and refuses to imply a zero", () => {
    const text = build({ kpis: [kpi({ supported: false })] });
    expect(text).toContain("NOT REPORTED for this comparison by the source");
    expect(text).toContain("No figure, and not a zero");
  });

  it("names a median as a median, never as an average", () => {
    /*
     * The dashboard takes the MEDIAN for anything not summable, because a mean
     * across salons weights a small salon equally with a large one. If chat
     * calls it an average the two surfaces are describing different statistics.
     */
    const text = build({
      kpis: [
        kpi({
          unit: "percent",
          label: "Total Revenue % Change",
          current: {
            metricCode: "total_revenue_pct_change",
            basisYear: 2026,
            kind: "median",
            value: 0.031,
            salonCount: 14,
            companyWide: false,
          },
        }),
      ],
    });
    expect(text).toContain("(median across the salons, 14 salons)");
    expect(text).not.toContain("average across the salons");
    expect(SALON_PERFORMANCE_BRIEFING_RULES).toContain("a MEDIAN across salons, not an average");
  });

  it("carries an aggregate's unavailable reason instead of a blank", () => {
    const text = build({
      kpis: [
        kpi({
          current: {
            metricCode: "total_revenue",
            basisYear: 2026,
            kind: "sum",
            value: null,
            salonCount: 0,
            companyWide: false,
            unavailableReason: "A rank cannot be summed.",
          },
        }),
      ],
    });
    expect(text).toContain("A rank cannot be summed.");
  });
});

describe("the ranking and the movers", () => {
  it("writes each salon's two sides, its change and its chain revenue rank", () => {
    expect(build()).toContain(
      "KS Lawrence (0123): $28,400, comparison $26,900, change +5.6% (reported), chain revenue rank 74",
    );
  });

  it("writes not reported for a salon the measure is blank for", () => {
    const text = build();
    expect(text).toContain("KS Topeka (0789): not reported");
    expect(text).toContain("chain revenue rank not reported");
  });

  it("reports movement as direction only, never as sentiment", () => {
    /*
     * Whether an increase is good depends on the measure's own
     * `higherIsBetter`, which can be null. `buildMovers` reports magnitude and
     * direction; the renderer must not upgrade that into good and bad.
     */
    const text = build();
    expect(text).toContain("Largest movements in Total Revenue");
    expect(text).toContain("Direction only — whether an increase is good depends on the measure");
    expect(text).toContain("Largest increases: KS Lawrence (0123) +5.6%");
    expect(text).toContain("Largest decreases: KS Manhattan (0456) -8.1%");
  });

  it("says there is no movement rather than inferring one, when nothing is comparable", () => {
    const flat = [row({ change: null, changeSource: "unavailable" })];
    const text = build({ rows: flat, movers: buildMovers([...flat]) });
    expect(text).toContain("has no comparison figures for this window");
    expect(text).toContain("Do not infer a direction");
  });

  it("caps the rows and warns against reading a lowest off a cut list", () => {
    const many = Array.from({ length: MAX_SALON_PERFORMANCE_BRIEFING_ROWS + 4 }, (_, index) =>
      row({ salonNumber: String(index).padStart(4, "0"), storeName: `Store ${index}` }),
    );
    const text = build({ rows: many, movers: buildMovers([...many]) });
    expect(text).toContain(
      `Only the first ${MAX_SALON_PERFORMANCE_BRIEFING_ROWS} of ${many.length} rows are listed here`,
    );
  });
});
