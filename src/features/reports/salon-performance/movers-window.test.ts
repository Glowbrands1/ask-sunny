import { describe, expect, it } from "vitest";

import { buildMovers, buildSalonRows, type FactRow } from "@/lib/reporting/read/dashboard";
import { basisYearWindow, rollingWindow } from "@/lib/reporting/read/windows";

import { moversDomain } from "./chart-axis";

/**
 * ============================================================================
 * THE MOVERS AXIS FOLLOWS THE WINDOW THE MANAGER SELECTED
 * ============================================================================
 *
 * `chart-axis.test.ts` proves `moversDomain` behaves for a given set of
 * changes. That is necessary and not sufficient for what the 14 September
 * review actually asked: "'Strongest and Weakest Movers' runs its axis down to
 * -71%, even though nothing is negative."
 *
 * Nothing is negative UNDER THE SELECTED COMPARISON. The same fifteen salons
 * are mostly up against 2024 and mixed against 2025, so a chart whose domain
 * came from anywhere but the selected window's own facts would be wrong on one
 * of them however well the domain function behaved. This suite runs the whole
 * chain — window -> metric codes -> facts -> rows -> movers -> domain — and
 * asserts the axis differs between comparisons because the data does.
 *
 * Figures are invented. The SHAPE is taken from the 8 September 2026 delivery,
 * where every JB salon is up against 2024 and five are down against 2025.
 */

const CURRENT_YEAR = 2026;
const SHEET = "CompReport(MTD)";

interface Sample {
  readonly salonNumber: string;
  readonly storeName: string;
  /** `TY vs. 2025 % Change`, as the source reports it. */
  readonly vs2025: number;
  /** `TY vs 2024 % Change`, from the other sheet. */
  readonly vs2024: number;
  /** `Last 3 Months % Change`. */
  readonly last3m: number;
}

/** Up against 2024 across the board; mixed against 2025. */
const SAMPLES: readonly Sample[] = [
  { salonNumber: "0101", storeName: "Invented Alpha", vs2025: 0.062, vs2024: 0.1339, last3m: 0.041 },
  { salonNumber: "0102", storeName: "Invented Beta", vs2025: -0.1021, vs2024: 0.0471, last3m: -0.015 },
  { salonNumber: "0103", storeName: "Invented Gamma", vs2025: 0.0805, vs2024: 0.6233, last3m: 0.112 },
  { salonNumber: "0104", storeName: "Invented Delta", vs2025: -0.0717, vs2024: 0.2047, last3m: 0.008 },
  { salonNumber: "0105", storeName: "Invented Epsilon", vs2025: 0.1081, vs2024: 0.4078, last3m: 0.076 },
];

const salons: Parameters<typeof buildSalonRows>[0]["salons"] = SAMPLES.map((sample) => ({
  salonNumber: sample.salonNumber,
  storeName: sample.storeName,
  districtLabel: null,
  regionLabel: null,
  company: null,
  ownershipGroup: null,
  dma: null,
  pricingPlan: null,
  isCompSalon: null,
  quintileGroup: null,
  revenueRank: null,
  salonAgeYears: null,
  avgClientAge: null,
  spaPieces: null,
}));

function fact(
  salonNumber: string,
  metricCode: string,
  basisYear: number | null,
  value: number,
): FactRow {
  return {
    salonNumber,
    storeName: "",
    metricCode,
    basisYear,
    value,
    sourceSheet: SHEET,
    sourceColumn: "AH",
  };
}

/** Every fact the three windows read, filed exactly as the parsers file them. */
const FACTS: FactRow[] = SAMPLES.flatMap((sample) => [
  fact(sample.salonNumber, "total_revenue", 2026, 40_000),
  fact(sample.salonNumber, "total_revenue", 2025, 38_000),
  fact(sample.salonNumber, "total_revenue", 2024, 33_000),
  fact(sample.salonNumber, "total_revenue_pct_change", 2025, sample.vs2025),
  fact(sample.salonNumber, "total_revenue_pct_change", 2024, sample.vs2024),
  fact(sample.salonNumber, "total_revenue_last_3m_current", null, 120_000),
  fact(sample.salonNumber, "total_revenue_last_3m_prior", null, 115_000),
  fact(sample.salonNumber, "total_revenue_last_3m_pct_change", null, sample.last3m),
]);

function domainFor(window: Parameters<typeof buildSalonRows>[0]["window"]) {
  const rows = buildSalonRows({
    metricCode: "total_revenue",
    window,
    currentYear: CURRENT_YEAR,
    salons,
    facts: FACTS,
  });
  const movers = buildMovers(rows);
  return {
    rows,
    movers,
    domain: moversDomain(rows.map((row) => row.change)),
  };
}

describe("the movers axis, per selected window", () => {
  it("reads the 2025 comparison under vs 2025", () => {
    const { rows } = domainFor(basisYearWindow(2025, SHEET));
    expect(rows.map((row) => row.change)).toEqual(SAMPLES.map((sample) => sample.vs2025));
    expect(rows.every((row) => row.changeSource === "reported")).toBe(true);
  });

  it("reads the 2024 comparison under vs 2024", () => {
    const { rows } = domainFor(basisYearWindow(2024, SHEET));
    expect(rows.map((row) => row.change)).toEqual(SAMPLES.map((sample) => sample.vs2024));
  });

  it("reads the trailing figure under Last 3 Months", () => {
    const { rows } = domainFor(rollingWindow(3, SHEET));
    expect(rows.map((row) => row.change)).toEqual(SAMPLES.map((sample) => sample.last3m));
  });

  /** The review's complaint, on the window that actually produced it. */
  it("draws no negative half under vs 2024, where every salon is up", () => {
    const { rows, domain } = domainFor(basisYearWindow(2024, SHEET));

    expect(rows.every((row) => (row.change ?? 0) > 0)).toBe(true);
    expect(domain.min).toBe(0);
    expect(domain.max).toBeGreaterThan(0.6233);
    // Nothing like the -71% the review saw.
    expect(domain.min).toBeGreaterThan(-0.0001);
  });

  it("draws both halves under vs 2025, where the data really is mixed", () => {
    const { rows, domain } = domainFor(basisYearWindow(2025, SHEET));

    expect(rows.some((row) => (row.change ?? 0) < 0)).toBe(true);
    expect(rows.some((row) => (row.change ?? 0) > 0)).toBe(true);
    expect(domain.min).toBeLessThan(0);
    expect(domain.max).toBeGreaterThan(0);
    // Symmetric, so a +5% bar and a -5% bar are the same length.
    expect(domain.min).toBeCloseTo(-domain.max, 12);
  });

  it("draws both halves under Last 3 Months, for the same reason", () => {
    const { domain } = domainFor(rollingWindow(3, SHEET));
    expect(domain.min).toBeLessThan(0);
    expect(domain.max).toBeGreaterThan(0);
  });

  /**
   * The point of the whole suite: the axis is a function of the selection. If
   * these two agreed, something upstream would be reading a fixed comparison.
   */
  it("gives the three windows three different axes", () => {
    const vs2025 = domainFor(basisYearWindow(2025, SHEET)).domain;
    const vs2024 = domainFor(basisYearWindow(2024, SHEET)).domain;
    const last3m = domainFor(rollingWindow(3, SHEET)).domain;

    expect(vs2025).not.toEqual(vs2024);
    expect(vs2025).not.toEqual(last3m);
    expect(vs2024).not.toEqual(last3m);
  });

  it("puts salons on both mover lists only when both directions exist", () => {
    const up = domainFor(basisYearWindow(2024, SHEET)).movers;
    expect(up.gainers.length).toBeGreaterThan(0);
    expect(up.decliners).toHaveLength(0);

    const mixed = domainFor(basisYearWindow(2025, SHEET)).movers;
    expect(mixed.gainers.length).toBeGreaterThan(0);
    expect(mixed.decliners.length).toBeGreaterThan(0);
  });
});
