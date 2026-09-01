import { describe, expect, it } from "vitest";

import {
  buildKpiCards,
  buildMovers,
  buildSalonRows,
  changeMetricCodeFor,
  hasBaseline,
  plottableRows,
  sortSalonRows,
  type FactRow,
} from "./dashboard";
import type { MetricDescriptor, SalonPeriodDescriptors } from "./types";

/** All figures invented. Shapes mirror the live rows. */

function metric(overrides: Partial<MetricDescriptor> = {}): MetricDescriptor {
  return {
    code: "total_revenue",
    label: "Total Revenue",
    family: "revenue",
    unit: "currency",
    higherIsBetter: true,
    basisYearRequired: true,
    comparisonOfCode: null,
    description: "",
    availableBasisYears: [2019, 2024, 2026],
    factCount: 45,
    salonCount: 15,
    ...overrides,
  };
}

function salon(salonNumber: string, overrides: Partial<SalonPeriodDescriptors> = {}): SalonPeriodDescriptors {
  return {
    salonNumber,
    storeName: `Invented Store ${salonNumber}`,
    districtLabel: "Invented District",
    regionLabel: "Invented Region",
    company: null,
    ownershipGroup: null,
    dma: null,
    pricingPlan: null,
    isCompSalon: true,
    quintileGroup: "Top 20%",
    revenueRank: 12,
    salonAgeYears: null,
    avgClientAge: null,
    spaPieces: null,
    ...overrides,
  };
}

function fact(
  salonNumber: string,
  metricCode: string,
  basisYear: number,
  value: number,
): FactRow {
  return {
    salonNumber,
    storeName: `Invented Store ${salonNumber}`,
    metricCode,
    basisYear,
    value,
    sourceSheet: "CompReport(MTD) vs 2024",
    sourceColumn: "AA",
  };
}

describe("changeMetricCodeFor", () => {
  it("follows the catalogue's naming convention", () => {
    expect(changeMetricCodeFor("total_revenue")).toBe("total_revenue_pct_change");
  });
});

describe("buildKpiCards", () => {
  const facts = [
    fact("0468", "total_revenue", 2026, 1000),
    fact("1207", "total_revenue", 2026, 500),
    fact("0468", "total_revenue", 2024, 800),
    fact("1207", "total_revenue", 2024, 450),
  ];

  it("sums a currency measure over the salons in view", () => {
    const [card] = buildKpiCards({
      metricCodes: ["total_revenue"],
      catalogue: [metric()],
      facts,
      currentYear: 2026,
      baselineYear: 2024,
    });
    expect(card.current.kind).toBe("sum");
    expect(card.current.value).toBe(1500);
    expect(card.baseline?.value).toBe(1250);
    expect(card.salonCount).toBe(2);
    // Structurally cannot be a chain figure.
    expect(card.current.companyWide).toBe(false);
  });

  it("derives the change from the two totals, and reconciles", () => {
    const [card] = buildKpiCards({
      metricCodes: ["total_revenue"],
      catalogue: [metric()],
      facts,
      currentYear: 2026,
      baselineYear: 2024,
    });
    // (1500 - 1250) / 1250 = 0.2
    expect(card.change.value).toBeCloseTo(0.2, 10);
    expect(card.change.source).toBe("derived");
    expect(card.change.note).toMatch(/totals of the salons in view/i);
  });

  it("reports an unavailable baseline rather than zero", () => {
    const [card] = buildKpiCards({
      metricCodes: ["spa_sessions"],
      catalogue: [metric({ code: "spa_sessions", label: "Spa Sessions", unit: "count", availableBasisYears: [2024, 2026] })],
      facts: [fact("0468", "spa_sessions", 2026, 40)],
      currentYear: 2026,
      // 2019 has no spa figures at all — the real workbook's gap.
      baselineYear: 2019,
    });
    expect(card.baseline).toBeNull();
    expect(card.change.value).toBeNull();
    expect(card.change.source).toBe("unavailable");
    expect(card.change.note).toMatch(/no 2019 figures/i);
  });

  it("never averages percentages: a percent measure uses the median", () => {
    const [card] = buildKpiCards({
      metricCodes: ["total_revenue_pct_change"],
      catalogue: [
        metric({
          code: "total_revenue_pct_change",
          label: "Total Revenue % Change",
          unit: "percent",
          comparisonOfCode: "total_revenue",
          availableBasisYears: [2024],
        }),
      ],
      facts: [
        fact("0468", "total_revenue_pct_change", 2024, 0.1),
        fact("1207", "total_revenue_pct_change", 2024, 0.3),
        fact("0031", "total_revenue_pct_change", 2024, 1.1),
      ],
      currentYear: 2024,
      baselineYear: 2024,
    });
    // Median 0.3, not the mean of 0.5 that an outlier would drag it to.
    expect(card.current.kind).toBe("median");
    expect(card.current.value).toBeCloseTo(0.3, 10);
  });

  it("prefers the source's own reported change for a non-summable measure", () => {
    const [card] = buildKpiCards({
      metricCodes: ["some_ratio"],
      catalogue: [metric({ code: "some_ratio", label: "A Ratio", unit: "ratio", availableBasisYears: [2024, 2026] })],
      facts: [
        fact("0468", "some_ratio", 2026, 4),
        fact("1207", "some_ratio", 2026, 6),
        fact("0468", "some_ratio_pct_change", 2024, 0.05),
        fact("1207", "some_ratio_pct_change", 2024, 0.15),
      ],
      currentYear: 2026,
      baselineYear: 2024,
    });
    expect(card.change.source).toBe("reported");
    expect(card.change.value).toBeCloseTo(0.1, 10);
    expect(card.change.note).toMatch(/not averaged across salons/i);
  });

  it("carries the unit and direction so formatting can follow the metric", () => {
    const [card] = buildKpiCards({
      metricCodes: ["unique_tanners"],
      catalogue: [metric({ code: "unique_tanners", label: "Unique Tanners", unit: "count", higherIsBetter: null })],
      facts: [fact("0468", "unique_tanners", 2026, 12)],
      currentYear: 2026,
      baselineYear: 2024,
    });
    expect(card.unit).toBe("count");
    // A null direction must survive to the renderer, which stays neutral.
    expect(card.higherIsBetter).toBeNull();
  });

  it("skips a metric that is not in the catalogue", () => {
    const cards = buildKpiCards({
      metricCodes: ["not_a_metric"],
      catalogue: [metric()],
      facts,
      currentYear: 2026,
      baselineYear: 2024,
    });
    expect(cards).toEqual([]);
  });
});

describe("buildSalonRows", () => {
  const salons = [salon("0468"), salon("1207"), salon("0031")];

  it("prefers the change the source reported over one it could derive", () => {
    const rows = buildSalonRows({
      metricCode: "total_revenue",
      salons,
      facts: [
        fact("0468", "total_revenue", 2026, 1000),
        fact("0468", "total_revenue", 2024, 800),
        // The workbook's own figure disagrees with (1000-800)/800 = 0.25,
        // because it may be computed against figures this copy lacks.
        fact("0468", "total_revenue_pct_change", 2024, 0.4),
      ],
      currentYear: 2026,
      baselineYear: 2024,
    });
    const row = rows.find((entry) => entry.salonNumber === "0468");
    expect(row?.change).toBe(0.4);
    expect(row?.changeSource).toBe("reported");
  });

  it("derives a change only when the source states none", () => {
    const rows = buildSalonRows({
      metricCode: "total_revenue",
      salons,
      facts: [
        fact("1207", "total_revenue", 2026, 500),
        fact("1207", "total_revenue", 2024, 400),
      ],
      currentYear: 2026,
      baselineYear: 2024,
    });
    const row = rows.find((entry) => entry.salonNumber === "1207");
    expect(row?.change).toBeCloseTo(0.25, 10);
    expect(row?.changeSource).toBe("derived");
  });

  it("keeps a salon with no figures, rather than dropping it silently", () => {
    const rows = buildSalonRows({
      metricCode: "total_revenue",
      salons,
      facts: [fact("0468", "total_revenue", 2026, 1000)],
      currentYear: 2026,
      baselineYear: 2024,
    });
    // All three salons present; a missing salon is indistinguishable from one
    // that does not exist.
    expect(rows).toHaveLength(3);
    const empty = rows.find((entry) => entry.salonNumber === "0031");
    expect(empty?.current).toBeNull();
    expect(empty?.baseline).toBeNull();
    expect(empty?.changeSource).toBe("unavailable");
  });

  it("refuses to divide by a zero baseline", () => {
    const rows = buildSalonRows({
      metricCode: "spa_sessions",
      salons: [salon("0031")],
      facts: [
        fact("0031", "spa_sessions", 2026, 10),
        fact("0031", "spa_sessions", 2024, 0),
      ],
      currentYear: 2026,
      baselineYear: 2024,
    });
    expect(rows[0].change).toBeNull();
    expect(rows[0].changeSource).toBe("unavailable");
    // The zero baseline itself is a real reported figure and is kept.
    expect(rows[0].baseline).toBe(0);
  });

  it("passes the reported rank and quintile straight through", () => {
    const rows = buildSalonRows({
      metricCode: "total_revenue",
      salons: [salon("0468", { revenueRank: 7, quintileGroup: "Second 20%" })],
      facts: [],
      currentYear: 2026,
      baselineYear: 2024,
    });
    expect(rows[0].revenueRank).toBe(7);
    expect(rows[0].quintileGroup).toBe("Second 20%");
  });
});

describe("sortSalonRows", () => {
  const rows = buildSalonRows({
    metricCode: "total_revenue",
    salons: [salon("0468"), salon("1207"), salon("0031")],
    facts: [
      fact("0468", "total_revenue", 2026, 1000),
      fact("1207", "total_revenue", 2026, 500),
    ],
    currentYear: 2026,
    baselineYear: 2024,
  });

  it("orders by value descending by default", () => {
    expect(sortSalonRows(rows, "value", "desc").map((r) => r.salonNumber)).toEqual([
      "0468",
      "1207",
      "0031",
    ]);
  });

  it("sinks rows with no value in BOTH directions", () => {
    // An ascending sort must not open with a column of blanks.
    expect(sortSalonRows(rows, "value", "asc").map((r) => r.salonNumber)).toEqual([
      "1207",
      "0468",
      "0031",
    ]);
  });

  it("orders by salon number as text, preserving zero padding", () => {
    expect(sortSalonRows(rows, "salon", "asc").map((r) => r.salonNumber)).toEqual([
      "0031",
      "0468",
      "1207",
    ]);
  });

  it("does not mutate the input", () => {
    const before = rows.map((r) => r.salonNumber);
    sortSalonRows(rows, "value", "asc");
    expect(rows.map((r) => r.salonNumber)).toEqual(before);
  });
});

describe("buildMovers", () => {
  const rows = buildSalonRows({
    metricCode: "total_revenue",
    salons: [salon("A1"), salon("B2"), salon("C3"), salon("D4")],
    facts: [
      fact("A1", "total_revenue_pct_change", 2024, 0.4),
      fact("B2", "total_revenue_pct_change", 2024, 0.1),
      fact("C3", "total_revenue_pct_change", 2024, -0.05),
      fact("D4", "total_revenue_pct_change", 2024, -0.3),
    ],
    currentYear: 2026,
    baselineYear: 2024,
  });

  it("puts the strongest increase and steepest decrease first", () => {
    const movers = buildMovers(rows);
    expect(movers.gainers.map((r) => r.salonNumber)).toEqual(["A1", "B2"]);
    expect(movers.decliners.map((r) => r.salonNumber)).toEqual(["D4", "C3"]);
    expect(movers.comparable).toBe(true);
    expect(movers.changeSource).toBe("reported");
  });

  it("respects the limit", () => {
    expect(buildMovers(rows, 1).gainers).toHaveLength(1);
    expect(buildMovers(rows, 1).decliners).toHaveLength(1);
  });

  it("reports not comparable when no salon has a change", () => {
    const none = buildSalonRows({
      metricCode: "spa_sessions",
      salons: [salon("A1")],
      facts: [fact("A1", "spa_sessions", 2026, 10)],
      currentYear: 2026,
      baselineYear: 2019,
    });
    const movers = buildMovers(none);
    expect(movers.comparable).toBe(false);
    expect(movers.gainers).toEqual([]);
    expect(movers.decliners).toEqual([]);
  });

  it("excludes an exactly-zero change from both lists", () => {
    const flat = buildSalonRows({
      metricCode: "total_revenue",
      salons: [salon("A1")],
      facts: [fact("A1", "total_revenue_pct_change", 2024, 0)],
      currentYear: 2026,
      baselineYear: 2024,
    });
    const movers = buildMovers(flat);
    expect(movers.comparable).toBe(true);
    expect(movers.gainers).toEqual([]);
    expect(movers.decliners).toEqual([]);
  });
});

describe("chart input helpers", () => {
  const rows = buildSalonRows({
    metricCode: "total_revenue",
    salons: [salon("A1"), salon("B2")],
    facts: [fact("A1", "total_revenue", 2026, 100)],
    currentYear: 2026,
    baselineYear: 2024,
  });

  it("plots only rows that hold a value", () => {
    expect(plottableRows(rows).map((r) => r.salonNumber)).toEqual(["A1"]);
  });

  it("reports whether any baseline exists at all", () => {
    expect(hasBaseline(rows)).toBe(false);
    const withBaseline = buildSalonRows({
      metricCode: "total_revenue",
      salons: [salon("A1")],
      facts: [
        fact("A1", "total_revenue", 2026, 100),
        fact("A1", "total_revenue", 2024, 90),
      ],
      currentYear: 2026,
      baselineYear: 2024,
    });
    expect(hasBaseline(withBaseline)).toBe(true);
  });
});
