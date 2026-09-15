import { describe, expect, it } from "vitest";

import { interpretSalesTotals } from "./sales-totals-interpretation";
import { interpretSalonPerformance } from "./salon-performance-interpretation";
import type { DashboardKpi, Movers, SalonRankingRow } from "./dashboard";
import type { AggregatedFigure } from "./sales-totals-aggregate";
import type { SalesTotalsSubject } from "./sales-totals-read";

/**
 * The two readings that were missing when the other three were written. Same
 * four rules: every sentence carries its figure, a null produces no sentence,
 * a flagged figure is never read as performance, and nothing recommends.
 */

/* ------------------------------------------------------------ sales totals */

function aggregate(
  metricCode: string,
  value: number | null,
  overrides: Partial<AggregatedFigure> = {},
): AggregatedFigure {
  return {
    metricCode,
    metricLabel: metricCode,
    unit: metricCode === "tans" || metricCode === "efts" ? "count" : "currency",
    value,
    basis: "summed",
    reportingSalons: 2,
    selectedSalons: 2,
    meanPerSalon: null,
    reason: null,
    ...overrides,
  };
}

function subject(
  label: string,
  ppta: number | null,
  /*
   * The denominator, which the coachability rule needs to recover the product
   * sales behind a rate. Defaulted high enough to be unremarkable so the cases
   * that are not about thin numerators stay about what they were about.
   */
  tans: number | null = 500,
): SalesTotalsSubject {
  return {
    label,
    figures: [
      { metricCode: "ppta", value: ppta },
      { metricCode: "tans", value: tans },
    ],
  } as unknown as SalesTotalsSubject;
}

describe("the Sales Totals reading", () => {
  const FIGURES = [
    aggregate("grand_total", 4_200.5, { meanPerSalon: 2_100.25 }),
    aggregate("tans", 1_900),
    aggregate("ppta", 2.25, { basis: "weighted" }),
    aggregate("efts", 12),
    aggregate("new_customers", 30),
  ];

  it("leads with revenue over traffic and names the window", () => {
    const reading = interpretSalesTotals({
      salons: [subject("MO Kansas City Wornall", 2.38), subject("NE Kearney", 1.28)],
      figures: FIGURES,
      windowLabel: "Report day",
      deliverySalonCount: 15,
    });

    expect(reading.headline).toBe(
      "$4,200.50 across 2 salons on 1,900 tans, for the report day window.",
    );
  });

  it("says the selection is a subset rather than letting it read as the estate", () => {
    const reading = interpretSalesTotals({
      salons: [subject("MO Kansas City Wornall", 2.38), subject("NE Kearney", 1.28)],
      figures: FIGURES,
      windowLabel: "Report day",
      deliverySalonCount: 15,
    });

    expect(reading.points).toContain(
      "This is 2 of the 15 salons the delivery carries; the figures above cover the selection only.",
    );
  });

  it("names a flagged PPTA as a data question and keeps it out of the comparison", () => {
    /*
     * The exact mistake the review found: NE Omaha 132nd and Maple ranked last
     * on a $0.00 the source could not produce honestly. It must be named, and
     * it must not be the "lowest" in the spread sentence.
     */
    const reading = interpretSalesTotals({
      salons: [
        subject("MO Kansas City Wornall", 2.38),
        subject("NE Kearney", 1.28),
        subject("NE Omaha 132nd and Maple", 0),
      ],
      figures: FIGURES,
      windowLabel: "Report day",
      deliverySalonCount: 15,
    });

    /*
     * The wording now comes from `pptaCoachability`, so the page prints the
     * same sentence the assistant is grounded on. What is asserted is the
     * substance: the salon is named, the reader is told to check the delivery,
     * and the figure is excluded from the comparison.
     */
    const flaggedPoint = reading.points.find((point) =>
      point.includes("NE Omaha 132nd and Maple"),
    )!;
    expect(flaggedPoint).toBeDefined();
    expect(flaggedPoint).toMatch(/check|Check/);
    expect(flaggedPoint).toContain("left out of the comparisons below");

    const spread = reading.points.find((point) => point.includes("the spread runs"))!;
    expect(spread).toContain("$2.38 at MO Kansas City Wornall");
    expect(spread).toContain("$1.28 at NE Kearney");
    // The flagged salon is NOT the bottom of the range.
    expect(spread).not.toContain("NE Omaha 132nd and Maple");
    expect(spread).not.toContain("$0.00");
  });

  it("names an unusually low but source-supported PPTA as the lowest, not as corrupt", () => {
    /*
     * Omaha 144th reported PPTA $0.05 on 33 tans on 13 September. Traced source
     * to screen, that is the delivery's own figure — this report carries no
     * product-sales column to contradict it, and the salon's month-to-date PPTA
     * is $2.82 over 605 tans. A thin trading day at a working salon.
     *
     * An earlier version of this narrative suppressed it behind an invented
     * $10 "implied product sales" floor. Hiding a real low day removes the
     * finding a Salon Director most needs to see.
     */
    const reading = interpretSalesTotals({
      salons: [
        subject("NE Lincoln 27th Street", 1.39, 71),
        subject("MO Kansas City Wornall", 0.5, 112),
        subject("NE Omaha 144th and Center", 0.05, 33),
      ],
      figures: FIGURES,
      windowLabel: "Report day",
      deliverySalonCount: 15,
    });

    const spread = reading.points.find((point) => point.includes("the spread runs"))!;
    expect(spread).toContain("$0.05 at NE Omaha 144th and Center");

    // And nothing anywhere calls that salon a data question.
    expect(
      reading.points.some((point) => point.includes("left out of the comparisons")),
    ).toBe(false);
  });

  it("leaves a genuinely low attachment day coachable", () => {
    /*
     * THE OTHER HALF, and the one an over-eager rule breaks. St Joseph's $0.11
     * over 160 tans is $17.60 — thin, but a real day above the floor. Telling a
     * manager to verify it would bury a true finding under a data question.
     */
    const reading = interpretSalesTotals({
      salons: [
        subject("NE Lincoln 27th Street", 1.39, 71),
        subject("MO St Joseph", 0.11, 160),
      ],
      figures: FIGURES,
      windowLabel: "Report day",
      deliverySalonCount: 15,
    });

    const spread = reading.points.find((point) => point.includes("the spread runs"))!;
    expect(spread).toContain("$0.11 at MO St Joseph");
    expect(
      reading.points.some((point) => point.includes("left out of the comparisons")),
    ).toBe(false);
  });

  it("says PPTA is weighted by tans when it is", () => {
    const reading = interpretSalesTotals({
      salons: [subject("A", 2.4), subject("B", 2.1)],
      figures: FIGURES,
      windowLabel: "Month to date",
      deliverySalonCount: 15,
    });

    expect(reading.points.some((point) => point.includes("weighted by each salon's own tans"))).toBe(
      true,
    );
  });

  it("attempts no period comparison, because the delivery carries none", () => {
    const reading = interpretSalesTotals({
      salons: [subject("A", 2.4), subject("B", 2.1)],
      figures: FIGURES,
      windowLabel: "Report day",
      deliverySalonCount: 15,
    });

    for (const point of [reading.headline, ...reading.points]) {
      expect(point).not.toMatch(/\b(yesterday|last month|last year|up on|down on|versus prior)\b/i);
    }
  });

  it("returns a reason when nothing is selected", () => {
    const reading = interpretSalesTotals({
      salons: [],
      figures: FIGURES,
      windowLabel: "Report day",
      deliverySalonCount: 15,
    });

    expect(reading.unavailableReason).toBe("This period has no figures to read.");
  });
});

/* ------------------------------------------------------- salon performance */

function kpi(overrides: Partial<DashboardKpi> & { label: string }): DashboardKpi {
  return {
    metricCode: overrides.label.toLowerCase(),
    unit: "currency",
    higherIsBetter: true,
    current: { value: 100, kind: "sum", salonCount: 15 },
    baseline: { value: 90, kind: "sum", salonCount: 15 },
    /*
     * A FRACTION, because that is what a `*_pct_change` fact holds: 0.111 is
     * +11.10%. This fixture used to say 11.1 and the reading printed "+11.1%"
     * from it, which looked right and was the production defect in miniature —
     * the number was being rendered without the scaling the cards apply.
     */
    change: { value: 0.111, source: "derived", note: "" },
    salonCount: 15,
    currentLabel: "2026",
    baselineLabel: "2025",
    supported: true,
    ...overrides,
  } as unknown as DashboardKpi;
}

function row(storeName: string, change: number | null): SalonRankingRow {
  return {
    salonNumber: "0000",
    storeName,
    current: 100,
    baseline: 90,
    change,
    changeSource: "derived",
    revenueRank: null,
    quintileGroup: null,
    districtLabel: null,
    regionLabel: null,
  };
}

function movers(gainers: SalonRankingRow[], decliners: SalonRankingRow[]): Movers {
  return {
    gainers,
    decliners,
    comparable: gainers.length + decliners.length > 0,
    changeSource: "derived",
  } as unknown as Movers;
}

describe("the Salon Performance reading", () => {
  it("names the baseline on every change, rather than a bare percentage", () => {
    /*
     * The review's defect was a comparison against 2024 the reader took for
     * 2025. A sentence saying "+11.1%" without naming what it is against would
     * put that back in prose after the data was fixed.
     */
    const reading = interpretSalonPerformance({
      kpis: [kpi({ label: "Total revenue" }), kpi({ label: "Total tans", baselineLabel: "2025" })],
      rows: [row("A", 0.05)],
      movers: movers([row("A", 0.05)], []),
      metricLabel: "Total revenue",
      windowLabel: "Year to date",
    });

    expect(reading.points).toContain("Total revenue is +11.10% against 2025.");
    expect(reading.points).toContain("Total tans is +11.10% against 2025.");
  });

  it("explains an empty decreases list instead of leaving a blank panel", () => {
    // The review named this: "the Decreases panel is empty with no explanation".
    const reading = interpretSalonPerformance({
      kpis: [kpi({ label: "Total revenue" })],
      rows: [row("A", 0.05), row("B", 3)],
      movers: movers([row("A", 0.05), row("B", 3)], []),
      metricLabel: "Total revenue",
      windowLabel: "Year to date",
    });

    expect(reading.points).toContain(
      "No salon is down on Total revenue in this window — the decreases list is empty because there are none, not because the figures are missing.",
    );
  });

  it("names the steepest decline when there is one", () => {
    const reading = interpretSalonPerformance({
      kpis: [kpi({ label: "Total revenue" })],
      rows: [],
      movers: movers([row("A", 0.05)], [row("D", -0.124), row("E", -0.03)]),
      metricLabel: "Total revenue",
      windowLabel: "Year to date",
    });

    expect(reading.points.some((point) => point.includes("steepest at D with -12.40%"))).toBe(true);
  });

  it("says a window has no comparison rather than reading levels as changes", () => {
    const reading = interpretSalonPerformance({
      kpis: [kpi({ label: "Total revenue", change: { value: null, source: "unavailable", note: "" } })],
      rows: [row("A", null)],
      movers: movers([], []),
      metricLabel: "Total revenue",
      windowLabel: "Last 3 months",
    });

    expect(reading.points).toContain(
      "None of the headline measures has a comparison in this window, so nothing here is a change — the figures are levels only.",
    );
    expect(reading.points).toContain(
      "No salon has a comparable figure for Total revenue in this window, so there are no movements to read.",
    );
  });

  it("names a measure the window does not report, so its absence is not read as zero", () => {
    const reading = interpretSalonPerformance({
      kpis: [
        kpi({ label: "Total revenue" }),
        kpi({ label: "Unique tanners", supported: false } as Partial<DashboardKpi> & {
          label: string;
        }),
      ],
      rows: [row("A", 0.05)],
      movers: movers([row("A", 0.05)], []),
      metricLabel: "Total revenue",
      windowLabel: "Year to date",
    });

    expect(reading.points).toContain(
      "Unique tanners is not reported for this window, so it is absent above rather than zero.",
    );
    // And it produced no change sentence of its own.
    expect(reading.points.some((point) => point.startsWith("Unique tanners is +"))).toBe(false);
  });

  it("recommends nothing", () => {
    const reading = interpretSalonPerformance({
      kpis: [kpi({ label: "Total revenue" })],
      rows: [row("A", 0.05)],
      movers: movers([row("A", 0.05)], [row("D", -0.124)]),
      metricLabel: "Total revenue",
      windowLabel: "Year to date",
    });

    for (const point of reading.points) {
      expect(point).not.toMatch(/\b(should|must|recommend|need to)\b/i);
    }
  });
});

/**
 * ============================================================================
 * A MISSING FIGURE AND A MISSING COMPARISON ARE DIFFERENT SENTENCES
 * ============================================================================
 *
 * The reading told a manager that a figure printed above it did not exist:
 * "Total Tans is not reported for this window, so it is absent above rather
 * than zero" appeared for a measure whose value was on the page with only its
 * prior year missing. True of a measure the source omits; false — and
 * confusing — of one that is simply uncompared.
 */
describe("the reading separates a missing figure from a missing comparison", () => {
  const read = (kpis: DashboardKpi[]) =>
    interpretSalonPerformance({
      kpis,
      rows: [row("A", 0.05)],
      movers: movers([row("A", 0.05)], []),
      metricLabel: "Total revenue",
      windowLabel: "vs 2025",
    }).points.join(" ");

  it("says a measure is absent only when it really carries no figure", () => {
    const text = read([
      kpi({ label: "Total revenue" }),
      kpi({
        label: "Unique tanners",
        current: { value: null, kind: "sum", salonCount: 0 },
        baseline: null,
        supported: false,
      } as Partial<DashboardKpi> & { label: string }),
    ]);

    expect(text).toContain("Unique tanners is not reported for this window");
    expect(text).toContain("absent above rather than zero");
  });

  it("says only the comparison is missing when the figure is present", () => {
    const text = read([
      kpi({ label: "Total revenue" }),
      kpi({ label: "Total tans", baseline: null } as Partial<DashboardKpi> & { label: string }),
    ]);

    expect(text).toContain("Total tans is shown above for this period");
    expect(text).toContain("no 2025 figure to compare against");
    // The wrong sentence must not appear for a measure that HAS a figure.
    expect(text).not.toContain("Total tans is not reported for this window");
  });

  it("says neither when every measure has both sides", () => {
    const text = read([kpi({ label: "Total revenue" }), kpi({ label: "Total tans" })]);

    expect(text).not.toContain("not reported for this window");
    expect(text).not.toContain("to compare against");
  });
});
