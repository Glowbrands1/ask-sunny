import { describe, expect, it } from "vitest";

import { formatMetricValue } from "./aggregation";
import { signed, signedRate } from "./interpretation-kit";
import { interpretSalonPerformance } from "./salon-performance-interpretation";
import type { DashboardKpi, Movers, SalonRankingRow } from "./dashboard";

/**
 * ============================================================================
 * ONE NUMBER, ONE SCALE, EVERY SURFACE
 * ============================================================================
 *
 * Production showed headline cards reading +4.64%, +17.07%, -2.88% and -10.19%
 * while the reading directly beneath them said +0.0%, +0.2%, -0.0% and -0.1%.
 * The cards were right: a `*_pct_change` fact is the source's own FRACTION, and
 * the cards render it through `Intl` percent formatting, which multiplies by
 * 100. The reading used `signed`, which does not — because `signed` exists for
 * the OTHER representation, the percentage POINTS that bed/spa comparisons and
 * the classification ladders are expressed in.
 *
 * Both representations are legitimate and neither can be removed. What can be
 * removed is the guessing, so the fixtures below are the real production
 * figures for the 13 September period and every surface is asserted against
 * them together.
 */

/** The four aggregate changes, as production stores them for 2026-09-13. */
const LIVE = {
  total_revenue: 0.046406,
  eft_revenue: 0.17073,
  total_tans: -0.028772,
  unique_tanners: -0.101857,
} as const;

/** Salon-level Total Revenue movers, as production stores them. */
const MOVERS = {
  "NE Lincoln Pine Lake": 0.2011,
  "NE Omaha Pacific": -0.1169,
  "KS Overland Park": -0.0387,
  "KS Manhattan": 0.001,
} as const;

describe("a stored fraction renders at the same scale everywhere", () => {
  it("renders the four production figures as the cards do", () => {
    expect(signedRate(LIVE.total_revenue)).toBe("+4.64%");
    expect(signedRate(LIVE.eft_revenue)).toBe("+17.07%");
    expect(signedRate(LIVE.total_tans)).toBe("-2.88%");
    expect(signedRate(LIVE.unique_tanners)).toBe("-10.19%");
  });

  it("agrees digit for digit with the headline card formatter", () => {
    for (const fraction of Object.values(LIVE)) {
      // The card prints "+4.64%"; Intl uses a non-breaking minus in some
      // locales, so compare the digits rather than the glyph.
      const card = formatMetricValue(fraction, "percent").replace(/[^\d.]/g, "");
      const reading = signedRate(fraction)!.replace(/[^\d.]/g, "");
      expect(reading).toBe(card);
    }
  });

  it("renders every salon-level mover at source scale", () => {
    expect(signedRate(MOVERS["NE Lincoln Pine Lake"])).toBe("+20.11%");
    expect(signedRate(MOVERS["NE Omaha Pacific"])).toBe("-11.69%");
    expect(signedRate(MOVERS["KS Overland Park"])).toBe("-3.87%");
    // Small but real: this is the value that used to vanish into "+0.0%".
    expect(signedRate(MOVERS["KS Manhattan"])).toBe("+0.10%");
  });

  it("never prints a negative zero", () => {
    expect(signedRate(-0.00004)).toBe("0.00%");
    expect(signedRate(0)).toBe("0.00%");
    expect(signed(-0.004, 1)).toBe("0.0%");
    for (const value of [-0.00004, 0, -0, 0.00001]) {
      expect(signedRate(value)).not.toContain("-0.00");
    }
  });

  /**
   * `signed` must keep taking POINTS. Bed Usage and Spa Wellness comparisons
   * are computed by `percentDifference`, which already multiplies by 100, and
   * the four-tier ladders read the same scale. Re-pointing `signed` at
   * fractions would move this bug rather than fix it.
   */
  it("leaves percentage-point comparisons unscaled", () => {
    expect(signed(127.4)).toBe("+127.4%");
    expect(signed(-75.8)).toBe("-75.8%");
    expect(signed(-8.2)).toBe("-8.2%");
  });

  it("keeps the two helpers distinguishable at a glance", () => {
    // The same input through both is a factor of 100 apart, which is exactly
    // the mistake that shipped.
    expect(signedRate(0.0464)).toBe("+4.64%");
    expect(signed(0.0464, 2)).toBe("+0.05%");
  });
});

/* ------------------------------------------------- the reading, end to end -- */

function kpi(label: string, change: number | null): DashboardKpi {
  return {
    metricCode: label.toLowerCase().replace(/ /g, "_"),
    label,
    unit: "currency",
    higherIsBetter: true,
    current: { value: 100, kind: "sum", salonCount: 15 },
    baseline: { value: 90, kind: "sum", salonCount: 15 },
    change: { value: change, source: "reported", note: "" },
    salonCount: 15,
    currentLabel: "2026",
    baselineLabel: "2025",
    supported: true,
  } as unknown as DashboardKpi;
}

function row(storeName: string, change: number | null): SalonRankingRow {
  return {
    salonNumber: "0000",
    storeName,
    current: 1,
    baseline: 1,
    change,
    changeSource: "reported",
    revenueRank: null,
    quintileGroup: null,
    districtLabel: null,
    regionLabel: null,
  };
}

const movers = (gainers: SalonRankingRow[], decliners: SalonRankingRow[]): Movers => ({
  gainers,
  decliners,
  comparable: true,
  changeSource: "reported",
});

describe("the reading matches the cards on the live period", () => {
  const reading = () =>
    interpretSalonPerformance({
      kpis: [
        kpi("Total Revenue", LIVE.total_revenue),
        kpi("EFT Revenue", LIVE.eft_revenue),
        kpi("Total Tans", LIVE.total_tans),
        kpi("Unique Tanners", LIVE.unique_tanners),
      ],
      rows: Object.entries(MOVERS).map(([name, change]) => row(name, change)),
      movers: movers(
        [row("NE Lincoln Pine Lake", MOVERS["NE Lincoln Pine Lake"])],
        [
          row("NE Omaha Pacific", MOVERS["NE Omaha Pacific"]),
          row("KS Overland Park", MOVERS["KS Overland Park"]),
        ],
      ),
      metricLabel: "Total Revenue",
      windowLabel: "vs 2025",
    }).points.join(" ");

  it("states each headline change at source scale", () => {
    const text = reading();
    expect(text).toContain("Total Revenue is +4.64% against 2025");
    expect(text).toContain("EFT Revenue is +17.07% against 2025");
    expect(text).toContain("Total Tans is -2.88% against 2025");
    expect(text).toContain("Unique Tanners is -10.19% against 2025");
  });

  it("states the movers at source scale, both directions", () => {
    const text = reading();
    expect(text).toContain("NE Lincoln Pine Lake at +20.11%");
    expect(text).toContain("NE Omaha Pacific with -11.69%");
  });

  it("prints none of the collapsed values the defect produced", () => {
    const text = reading();
    for (const wrong of ["+0.0%", "-0.0%", "+0.2%", "-0.1%"]) {
      expect(text, wrong).not.toContain(wrong);
    }
  });
});

/**
 * The other windows read the same stored representation, so a fix that scaled
 * only `vs 2025` would leave them wrong in the other direction.
 */
describe("every window reads one scale", () => {
  for (const [window, change] of [
    ["vs 2024", 0.1828],
    ["vs 2019", 0.4077],
    ["Last 3 Months", 0.0546],
    ["Last 12 Months", 0.0721],
  ] as const) {
    it(`is not double-scaled under ${window}`, () => {
      const text = interpretSalonPerformance({
        kpis: [kpi("Total Revenue", change)],
        rows: [row("A", change)],
        movers: movers([row("A", change)], []),
        metricLabel: "Total Revenue",
        windowLabel: window,
      }).points.join(" ");

      const expected = signedRate(change)!;
      expect(text).toContain(expected);
      // A double scale would put the decimal point two places out.
      expect(text).not.toContain(signedRate(change * 100)!);
    });
  }
});
