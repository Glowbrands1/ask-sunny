import { describe, expect, it } from "vitest";

import {
  computeSalesTotalsSignals,
  describeMetric,
  quartileForRank,
  MIN_SALONS_FOR_QUARTILES,
} from "./sales-totals-signals";
import { SALES_TOTALS_METRIC_CODES } from "../sales-totals/metric-map";
import type { SalesTotalsSubject } from "../read/sales-totals-read";

/**
 * ============================================================================
 * THE ARITHMETIC THE MODEL IS NO LONGER ASKED TO DO
 * ============================================================================
 *
 * Live QA showed the analysis narrating comparisons it had eyeballed: "the
 * widest row-to-row differences", "high tan volume alongside low takings". Those
 * are now computed here, which is what makes them checkable — and this file is
 * where they get checked.
 *
 * The fixture is chosen so every figure can be verified by hand:
 *
 *   Aurora    1000    Bayside    800    Cedar    600    Dover    400
 *   Elm        200    Fern    (blank)
 *
 *   five reporting, one missing, median 600, total 3000
 */

function figure(code: string, value: number | null, unit: "currency" | "count" = "currency") {
  return {
    metricCode: code,
    metricLabel: code,
    unit,
    aggregation: (code === "ppta" ? "average" : "sum") as "sum" | "average",
    summaryIsAverage: true,
    note: "",
    value,
  };
}

function salon(key: string, label: string, grandTotal: number | null, ppta: number | null = 2.5): SalesTotalsSubject {
  return {
    kind: "salon",
    key,
    label,
    salonNumber: key,
    salonCount: null,
    figures: [figure("grand_total", grandTotal), figure("ppta", ppta), figure("tans", 10, "count")],
  };
}

const SALONS: SalesTotalsSubject[] = [
  salon("1", "Aurora", 1000),
  salon("2", "Bayside", 800),
  salon("3", "Cedar", 600),
  salon("4", "Dover", 400),
  salon("5", "Elm", 200),
  salon("6", "Fern", null),
];

/* -------------------------------------------------------------- counting -- */

describe("who is in the population", () => {
  const distribution = describeMetric(SALONS, "grand_total");

  it("counts the selection and the reporting subset separately", () => {
    expect(distribution.selectedSalons).toBe(6);
    expect(distribution.reportingSalons).toBe(5);
    expect(distribution.missingSalons).toBe(1);
  });

  it("names the salons that did not report, so they can be stated", () => {
    expect(distribution.missingSalonNames).toEqual(["Fern (#6)"]);
  });

  it("keeps a missing salon out of the ranking entirely", () => {
    expect(distribution.rows.map((row) => row.storeName)).toEqual([
      "Aurora",
      "Bayside",
      "Cedar",
      "Dover",
      "Elm",
    ]);
  });
});

/* ------------------------------------------------ missing is not a zero -- */

describe("a blank cell never becomes a zero", () => {
  it("is excluded from the median rather than dragging it down", () => {
    // With Fern as a zero the median of six would be 500. Excluded, the median
    // of the five reporting salons is 600.
    expect(describeMetric(SALONS, "grand_total").median).toBe(600);
  });

  it("is excluded from the rank denominator", () => {
    const distribution = describeMetric(SALONS, "grand_total");
    for (const row of distribution.rows) expect(row.outOf).toBe(5);
  });

  it("is excluded from the total", () => {
    expect(describeMetric(SALONS, "grand_total").populationTotal).toBe(3000);
  });

  it("is never the lowest reported value", () => {
    const distribution = describeMetric(SALONS, "grand_total");
    expect(distribution.lowest?.storeName).toBe("Elm");
    expect(distribution.lowest?.value).toBe(200);
  });

  it("reports nothing rather than zero when no salon reported the measure", () => {
    const none = [salon("1", "Aurora", null), salon("2", "Bayside", null)];
    const distribution = describeMetric(none, "grand_total");

    expect(distribution.reportingSalons).toBe(0);
    expect(distribution.median).toBeNull();
    expect(distribution.highest).toBeNull();
    expect(distribution.lowest).toBeNull();
    expect(distribution.rows).toEqual([]);
  });
});

/* ------------------------------------------------------ rank and median -- */

describe("rank, median and deviation", () => {
  const distribution = describeMetric(SALONS, "grand_total");

  it("ranks highest first", () => {
    expect(distribution.rows[0]).toMatchObject({ storeName: "Aurora", rank: 1, outOf: 5 });
    expect(distribution.rows[4]).toMatchObject({ storeName: "Elm", rank: 5, outOf: 5 });
  });

  it("measures deviation against the median of the reporting salons", () => {
    expect(distribution.rows[0].deviationFromMedian).toBe(400);
    expect(distribution.rows[2].deviationFromMedian).toBe(0);
    expect(distribution.rows[4].deviationFromMedian).toBe(-400);
  });

  it("states deviation as a share of the median", () => {
    expect(distribution.rows[0].percentVsMedian).toBe(67);
    expect(distribution.rows[4].percentVsMedian).toBe(-67);
  });

  it("refuses a percentage when the median is zero rather than reporting Infinity", () => {
    const zeros = [
      salon("1", "Aurora", 100),
      salon("2", "Bayside", 0),
      salon("3", "Cedar", 0),
    ];
    const zeroMedian = describeMetric(zeros, "grand_total");

    expect(zeroMedian.median).toBe(0);
    for (const row of zeroMedian.rows) expect(row.percentVsMedian).toBeNull();
  });

  it("averages the two middle values on an even reporting count", () => {
    const four = SALONS.filter((entry) => entry.label !== "Elm" && entry.label !== "Fern");
    // 1000, 800, 600, 400 -> (800 + 600) / 2
    expect(describeMetric(four, "grand_total").median).toBe(700);
  });
});

/* ------------------------------------------------------------ quartiles -- */

describe("quartiles are rank-derived, and refused when meaningless", () => {
  it("divides the ranks into quarters", () => {
    // Fourteen reporting salons: the top quartile is ranks 1 to 3.
    expect(quartileForRank(1, 14)).toBe("top");
    expect(quartileForRank(3, 14)).toBe("top");
    expect(quartileForRank(4, 14)).toBe("upper_middle");
    expect(quartileForRank(14, 14)).toBe("bottom");
  });

  it("puts the first and last rank at the two ends", () => {
    expect(quartileForRank(1, 100)).toBe("top");
    expect(quartileForRank(100, 100)).toBe("bottom");
  });

  it("returns null below the minimum population rather than inventing a band", () => {
    for (let count = 1; count < MIN_SALONS_FOR_QUARTILES; count += 1) {
      expect(quartileForRank(1, count)).toBeNull();
    }
    expect(quartileForRank(1, MIN_SALONS_FOR_QUARTILES)).toBe("top");
  });

  it("leaves quartiles off a small selection's rows", () => {
    const three = SALONS.slice(0, 3);
    for (const row of describeMetric(three, "grand_total").rows) {
      expect(row.quartile).toBeNull();
      // Rank is still there — it is the signal that always works.
      expect(row.outOf).toBe(3);
    }
  });
});

/* ----------------------------------------------------------------- PPTA -- */

describe("PPTA is described, never combined", () => {
  const spread: SalesTotalsSubject[] = [
    salon("1", "Aurora", 1000, 3.0),
    salon("2", "Bayside", 800, 2.5),
    salon("3", "Cedar", 600, 2.0),
  ];
  const distribution = describeMetric(spread, "ppta");

  it("is not summable", () => {
    expect(distribution.summable).toBe(false);
  });

  it("has no population total at all", () => {
    expect(distribution.populationTotal).toBeNull();
    // Specifically not the sum, which would be 7.50.
    expect(distribution.populationTotal).not.toBe(7.5);
  });

  it("carries the aggregate layer's own reason instead of a paraphrase", () => {
    expect(distribution.noTotalReason).toMatch(/transaction count as a weight/);
  });

  it("still ranks the individual salon values, which is legitimate", () => {
    expect(distribution.rows.map((row) => row.storeName)).toEqual([
      "Aurora",
      "Bayside",
      "Cedar",
    ]);
    expect(distribution.highest?.value).toBe(3);
    expect(distribution.lowest?.value).toBe(2);
  });

  it("reports a descriptive median of the per-salon values, not a business PPTA", () => {
    // The median EXISTS as a distribution statistic. What must never happen is
    // it being presented as the delivery's PPTA — which is why `summable` is
    // false and `noTotalReason` is populated alongside it.
    expect(distribution.median).toBe(2.5);
    expect(distribution.summable).toBe(false);
    expect(distribution.noTotalReason).not.toBeNull();
  });
});

/* --------------------------------------------------- no invented metrics -- */

describe("what the signals layer refuses to compute", () => {
  const signals = computeSalesTotalsSignals(SALONS, "grand_total", SALES_TOTALS_METRIC_CODES);

  it("puts the selected measure first and separates the rest", () => {
    expect(signals.selected.metricCode).toBe("grand_total");
    expect(signals.others.map((entry) => entry.metricCode)).not.toContain("grand_total");
    expect(signals.others).toHaveLength(SALES_TOTALS_METRIC_CODES.length - 1);
  });

  it("reports that no performance baseline exists", () => {
    expect(signals.baselineAvailable).toBe(false);
  });

  it("exposes no cross-metric spread, variability or range comparison", () => {
    const shape = JSON.stringify(signals);
    for (const forbidden of ["spread", "variability", "widest", "stdDev", "variance", "zScore", "iqr"]) {
      expect(shape.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });

  it("exposes no outlier threshold or evaluative label", () => {
    const shape = JSON.stringify(signals).toLowerCase();
    for (const forbidden of ["threshold", "underperform", "weak", "strong", "concerning", "healthy"]) {
      expect(shape).not.toContain(forbidden);
    }
  });
});
