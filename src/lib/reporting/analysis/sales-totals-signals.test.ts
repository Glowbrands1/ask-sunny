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
    expect(distribution.lowest.map((row) => row.storeName)).toEqual(["Elm"]);
    expect(distribution.lowest[0].value).toBe(200);
  });

  it("reports nothing rather than zero when no salon reported the measure", () => {
    const none = [salon("1", "Aurora", null), salon("2", "Bayside", null)];
    const distribution = describeMetric(none, "grand_total");

    expect(distribution.reportingSalons).toBe(0);
    expect(distribution.median).toBeNull();
    expect(distribution.highest).toEqual([]);
    expect(distribution.lowest).toEqual([]);
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
    expect(distribution.rows[0].percentDifferenceFromMedian).toBe(67);
    expect(distribution.rows[4].percentDifferenceFromMedian).toBe(-67);
  });

  it("refuses a percentage when the median is zero rather than reporting Infinity", () => {
    const zeros = [
      salon("1", "Aurora", 100),
      salon("2", "Bayside", 0),
      salon("3", "Cedar", 0),
    ];
    const zeroMedian = describeMetric(zeros, "grand_total");

    expect(zeroMedian.median).toBe(0);
    for (const row of zeroMedian.rows) expect(row.percentDifferenceFromMedian).toBeNull();
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
    expect(distribution.highest[0].value).toBe(3);
    expect(distribution.lowest[0].value).toBe(2);
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

/* ------------------------------------------------------------------ ties -- */

describe("equal values are ranked equally", () => {
  /**
   * ==========================================================================
   * WHAT WAS WRONG
   * ==========================================================================
   *
   * Rank was `index + 1` off a sorted array, so two salons reporting the same
   * figure got different ranks — whichever one the sort happened to place
   * first was "rank 3" and the other "rank 4". Not theoretical: EFTs and New
   * Customers are small counts across fifteen salons, so ties are ordinary.
   *
   * The competition convention gives 10, 8, 8, 5 the ranks 1, 2, 2, 4.
   */
  const TIED: SalesTotalsSubject[] = [
    salon("1", "Alpha", 10),
    salon("2", "Bravo", 8),
    salon("3", "Charlie", 8),
    salon("4", "Delta", 5),
  ];

  it("gives tied values the same rank", () => {
    const rows = describeMetric(TIED, "grand_total").rows;
    const byName = Object.fromEntries(rows.map((row) => [row.storeName, row.rank]));

    expect(byName.Bravo).toBe(2);
    expect(byName.Charlie).toBe(2);
    expect(byName.Bravo).toBe(byName.Charlie);
  });

  it("skips the ranks a tie consumed, so rank and denominator stay comparable", () => {
    expect(describeMetric(TIED, "grand_total").rows.map((row) => row.rank)).toEqual([
      1, 2, 2, 4,
    ]);
  });

  it("keeps the denominator as the number of reporting salons", () => {
    for (const row of describeMetric(TIED, "grand_total").rows) {
      expect(row.outOf).toBe(4);
    }
  });

  it("ranks identically however the source ordered the tied rows", () => {
    const reversed = [TIED[3], TIED[2], TIED[1], TIED[0]];
    const shuffled = [TIED[2], TIED[0], TIED[3], TIED[1]];

    const rankFor = (salons: SalesTotalsSubject[]) =>
      Object.fromEntries(
        describeMetric(salons, "grand_total").rows.map((row) => [row.storeName, row.rank]),
      );

    expect(rankFor(reversed)).toEqual(rankFor(TIED));
    expect(rankFor(shuffled)).toEqual(rankFor(TIED));
  });

  it("prints tied rows in a stable order whatever the source order", () => {
    const order = (salons: SalesTotalsSubject[]) =>
      describeMetric(salons, "grand_total").rows.map((row) => row.storeName);

    expect(order([TIED[2], TIED[1], TIED[0], TIED[3]])).toEqual(order(TIED));
  });

  it("ties on equal currency values that differ below a cent", () => {
    // Upstream fractions of a cent must not split two salons a reader sees as
    // reporting the same amount.
    const cents = [
      salon("1", "Alpha", 500.5),
      salon("2", "Bravo", 500.500004),
      salon("3", "Charlie", 200),
    ];
    const rows = describeMetric(cents, "grand_total").rows;

    expect(rows[0].rank).toBe(1);
    expect(rows[1].rank).toBe(1);
    expect(rows[2].rank).toBe(3);
  });

  it("gives every salon rank 1 when they all report the same value", () => {
    const same = ["1", "2", "3", "4", "5"].map((key) => salon(key, `Store ${key}`, 100));
    const distribution = describeMetric(same, "grand_total");

    expect(distribution.rows.map((row) => row.rank)).toEqual([1, 1, 1, 1, 1]);
    expect(distribution.allValuesEqual).toBe(true);
  });
});

describe("ties never land in different quartiles", () => {
  it("puts a tie that straddles a quartile boundary in one band", () => {
    /*
     * Eight salons, with ranks 3 and 4 tied. The nominal top quartile is ranks
     * 1 to 2 and the upper-middle is 3 to 4 — but the point is the boundary
     * case: under the old positional ranking the two tied salons took ranks 3
     * and 4 separately, and a tie straddling any boundary would have been
     * split into two analytical classes. With a shared rank there is nothing
     * left to split.
     */
    const boundary: SalesTotalsSubject[] = [
      salon("1", "A", 100),
      salon("2", "B", 90),
      salon("3", "C", 80),
      salon("4", "D", 80),
      salon("5", "E", 70),
      salon("6", "F", 60),
      salon("7", "G", 50),
      salon("8", "H", 40),
    ];

    const rows = describeMetric(boundary, "grand_total").rows;
    const c = rows.find((row) => row.storeName === "C")!;
    const d = rows.find((row) => row.storeName === "D")!;

    expect(c.rank).toBe(d.rank);
    expect(c.quartile).toBe(d.quartile);
  });

  it("gives every pair of equal values the same band, across the whole population", () => {
    // Twelve salons in six tied pairs: every pair must agree with itself.
    const pairs: SalesTotalsSubject[] = [];
    for (let index = 0; index < 6; index += 1) {
      pairs.push(salon(`${index}a`, `Store ${index}a`, 100 - index * 10));
      pairs.push(salon(`${index}b`, `Store ${index}b`, 100 - index * 10));
    }

    const rows = describeMetric(pairs, "grand_total").rows;
    const byValue = new Map<number, Set<string | null>>();
    for (const row of rows) {
      if (!byValue.has(row.value)) byValue.set(row.value, new Set());
      byValue.get(row.value)!.add(row.quartile);
    }

    for (const [value, bands] of byValue) {
      expect(bands.size, `value ${value} landed in ${bands.size} bands`).toBe(1);
    }
  });

  it("puts everyone in the top band when every value is equal", () => {
    const same = ["1", "2", "3", "4", "5", "6", "7", "8"].map((key) =>
      salon(key, `Store ${key}`, 100),
    );
    for (const row of describeMetric(same, "grand_total").rows) {
      expect(row.quartile).toBe("top");
    }
  });
});

describe("both ends name every salon that holds them", () => {
  it("returns all salons tied for highest", () => {
    const tiedTop = [
      salon("1", "Alpha", 100),
      salon("2", "Bravo", 100),
      salon("3", "Charlie", 50),
    ];
    const distribution = describeMetric(tiedTop, "grand_total");

    expect(distribution.highest.map((row) => row.storeName)).toEqual(["Alpha", "Bravo"]);
    expect(distribution.lowest.map((row) => row.storeName)).toEqual(["Charlie"]);
  });

  it("returns all salons tied for lowest", () => {
    const tiedBottom = [
      salon("1", "Alpha", 100),
      salon("2", "Bravo", 50),
      salon("3", "Charlie", 50),
    ];
    const distribution = describeMetric(tiedBottom, "grand_total");

    expect(distribution.lowest.map((row) => row.storeName)).toEqual(["Bravo", "Charlie"]);
    expect(distribution.lowest.every((row) => row.rank === 2)).toBe(true);
  });

  it("does not treat a tied end as uniquely held by whichever row sorted there", () => {
    const tiedBottom = [
      salon("1", "Alpha", 100),
      salon("2", "Bravo", 50),
      salon("3", "Charlie", 50),
    ];
    // The old implementation returned rows[rows.length - 1] — exactly one
    // salon, chosen by sort order.
    expect(describeMetric(tiedBottom, "grand_total").lowest).toHaveLength(2);
  });

  it("marks a population with one distinct value as having no two ends", () => {
    const same = ["1", "2", "3"].map((key) => salon(key, `Store ${key}`, 100));
    const distribution = describeMetric(same, "grand_total");

    expect(distribution.allValuesEqual).toBe(true);
    expect(distribution.highest).toHaveLength(3);
    expect(distribution.lowest).toHaveLength(3);
  });

  it("keeps a salon that did not report out of both ends", () => {
    const distribution = describeMetric(SALONS, "grand_total");
    const named = [...distribution.highest, ...distribution.lowest].map((row) => row.storeName);
    expect(named).not.toContain("Fern");
  });
});
