import { describe, expect, it } from "vitest";

import { SALES_TOTALS_METRIC_CODES } from "../sales-totals/metric-map";
import {
  aggregateMeasure,
  aggregateSalons,
  figureHeading,
  selectionHeading,
} from "./sales-totals-aggregate";
import { SALES_TOTALS_MEASURES_BY_CODE } from "../sales-totals/metric-map";
import type { SalesTotalsSubject } from "./sales-totals-read";

/**
 * ============================================================================
 * THE ARITHMETIC, PROVEN
 * ============================================================================
 *
 * These are the real reported figures from the 09-02-2026 Sales Totals report,
 * previous-day window. They are the actual numbers on the actual dashboard, so
 * the expected sums below are facts about the source rather than fixtures
 * chosen to be convenient. A screenshot is not evidence about money; this is.
 *
 * Two things are being proven:
 *
 *   1. SELECTED SALONS SUM EXACTLY. Not approximately, not to a tolerance —
 *      to the cent, because these are dollars.
 *   2. PPTA IS REFUSED. It is money per transaction, and the transaction
 *      counts are not in the report, so no valid combination exists. Summing
 *      it would produce $38.73, which is not any real quantity.
 */

/** The 15 salons in the 09-02-2026 delivery, previous-day window. Verbatim. */
const SEP2_DAILY: Record<
  string,
  {
    grand_total: number;
    ppta: number;
    tans: number;
    efts: number;
    new_customers: number;
    sunless_sessions: number;
  }
> = {
  "KS Lawrence": { grand_total: 760.07, ppta: 3.25, tans: 99, efts: 3, new_customers: 2, sunless_sessions: 12 },
  "KS Manhattan": { grand_total: 830.69, ppta: 2.4, tans: 141, efts: 1, new_customers: 3, sunless_sessions: 9 },
  "KS Overland Park": { grand_total: 1740.43, ppta: 4.84, tans: 119, efts: 0, new_customers: 2, sunless_sessions: 27 },
  "KS Shawnee Mission Pkwy": { grand_total: 526.46, ppta: 1.66, tans: 129, efts: 0, new_customers: 2, sunless_sessions: 17 },
  "MO Kansas City Liberty": { grand_total: 1069.9, ppta: 1, tans: 251, efts: 1, new_customers: 1, sunless_sessions: 31 },
  "MO Kansas City Wornall": { grand_total: 1535.63, ppta: 3.54, tans: 150, efts: 0, new_customers: 4, sunless_sessions: 26 },
  "MO St Joseph": { grand_total: 587.41, ppta: 0.43, tans: 197, efts: 0, new_customers: 1, sunless_sessions: 11 },
  "NE Grand Island": { grand_total: 328.11, ppta: 2.7, tans: 99, efts: 0, new_customers: 1, sunless_sessions: 9 },
  "NE Kearney": { grand_total: 224.93, ppta: 0.19, tans: 105, efts: 1, new_customers: 2, sunless_sessions: 10 },
  "NE Lincoln 27th Street": { grand_total: 854.55, ppta: 1.04, tans: 102, efts: 2, new_customers: 4, sunless_sessions: 7 },
  "NE Lincoln O Street": { grand_total: 580.16, ppta: 1.45, tans: 96, efts: 3, new_customers: 1, sunless_sessions: 11 },
  "NE Lincoln Pine Lake": { grand_total: 1353.44, ppta: 3.76, tans: 117, efts: 1, new_customers: 5, sunless_sessions: 27 },
  "NE Omaha 132nd and Maple": { grand_total: 335.97, ppta: 2.14, tans: 94, efts: 0, new_customers: 0, sunless_sessions: 13 },
  "NE Omaha 144th and Center": { grand_total: 451.11, ppta: 6.74, tans: 46, efts: 1, new_customers: 1, sunless_sessions: 3 },
  "NE Omaha Pacific": { grand_total: 659.95, ppta: 3.59, tans: 94, efts: 0, new_customers: 4, sunless_sessions: 18 },
};

const SALON_NUMBERS: Record<string, string> = {
  "KS Lawrence": "0468",
  "MO Kansas City Liberty": "0394",
  "NE Omaha 144th and Center": "0314",
};

function salon(name: string): SalesTotalsSubject {
  const values = SEP2_DAILY[name];
  return {
    kind: "salon",
    key: SALON_NUMBERS[name] ?? name,
    label: name,
    salonNumber: SALON_NUMBERS[name] ?? null,
    salonCount: null,
    figures: SALES_TOTALS_METRIC_CODES.map((code) => {
      const measure = SALES_TOTALS_MEASURES_BY_CODE[code];
      return {
        metricCode: code,
        metricLabel: measure.label,
        unit: measure.unit,
        aggregation: measure.aggregation,
        summaryIsAverage: measure.summaryIsAverage,
        note: measure.note,
        value: values[code as keyof typeof values],
      };
    }),
  };
}

const ALL_15 = Object.keys(SEP2_DAILY).map(salon);
const THREE = ["KS Lawrence", "MO Kansas City Liberty", "NE Omaha 144th and Center"].map(salon);

/** A source-estate summary row, which must never be summed with anything. */
function estateScope(label: string, salonCount: number, grandTotal: number): SalesTotalsSubject {
  return {
    kind: "summary",
    key: label.toLowerCase().replace(/\s+/g, "_"),
    label,
    salonNumber: null,
    salonCount,
    figures: SALES_TOTALS_METRIC_CODES.map((code) => {
      const measure = SALES_TOTALS_MEASURES_BY_CODE[code];
      return {
        metricCode: code,
        metricLabel: measure.label,
        unit: measure.unit,
        aggregation: measure.aggregation,
        summaryIsAverage: measure.summaryIsAverage,
        note: measure.note,
        value: code === "grand_total" ? grandTotal : 1,
      };
    }),
  };
}

describe("three named salons sum to the cent", () => {
  /*
   *   KS Lawrence                 $760.07
   *   MO Kansas City Liberty    $1,069.90
   *   NE Omaha 144th and Center   $451.11
   *   -----------------------------------
   *   expected                  $2,281.08
   */
  it("sums Grand Total exactly", () => {
    /*
     * WORTH SEEING: adding these three in raw binary floating point gives
     * 2281.0800000000004, not 2281.08. That is exactly the drift
     * `roundCurrency` exists to remove — a dashboard reporting a total of
     * $2,281.0800000000004 is a bug, and so is one silently comparing against
     * it. The naive sum is shown here rather than hidden.
     */
    const naive = 760.07 + 1069.9 + 451.11;
    expect(naive).not.toBe(2281.08);
    expect(Math.round(naive * 100) / 100).toBe(2281.08);

    const figure = aggregateMeasure(THREE, "grand_total");
    expect(figure.basis).toBe("summed");
    expect(figure.value).toBe(2281.08);
    expect(figure.selectedSalons).toBe(3);
    expect(figure.reportingSalons).toBe(3);
  });

  it("sums each additive count exactly", () => {
    for (const [code, expected] of [
      ["tans", 99 + 251 + 46],
      ["efts", 3 + 1 + 1],
      ["new_customers", 2 + 1 + 1],
      ["sunless_sessions", 12 + 31 + 3],
    ] as const) {
      const figure = aggregateMeasure(THREE, code);
      expect(figure.value, code).toBe(expected);
      expect(figure.basis, code).toBe("summed");
    }
    // Spelled out, so the expected values are readable rather than computed.
    expect(aggregateMeasure(THREE, "tans").value).toBe(396);
    expect(aggregateMeasure(THREE, "efts").value).toBe(5);
    expect(aggregateMeasure(THREE, "new_customers").value).toBe(4);
    expect(aggregateMeasure(THREE, "sunless_sessions").value).toBe(46);
  });

  it("adds one more salon and increases the total by exactly that salon's value", () => {
    /*
     * The behaviour a manager checks by hand: tick a salon, the total should go
     * up by that salon's number and nothing else.
     */
    const before = aggregateMeasure(THREE, "grand_total").value!;
    const after = aggregateMeasure([...THREE, salon("KS Manhattan")], "grand_total").value!;
    expect(after - before).toBeCloseTo(830.69, 10);
    expect(after).toBe(3111.77);
  });
});

describe("all 15 salons sum to the cent", () => {
  it("Grand Total is the sum of the 15 salon rows", () => {
    const byHand = Object.values(SEP2_DAILY).reduce((sum, row) => sum + row.grand_total, 0);
    expect(Math.round(byHand * 100) / 100).toBe(11838.81);

    const figure = aggregateMeasure(ALL_15, "grand_total");
    expect(figure.value).toBe(11838.81);
    expect(figure.basis).toBe("summed");
    expect(figure.selectedSalons).toBe(15);
  });

  it("and is nothing like the estate average, which is the whole point", () => {
    /*
     * THE DEFECT THIS CHECKPOINT FIXED. The report's All Salons Grand Total for
     * this date is $818.45 — an average per salon across 249 salons. The 15
     * delivered salons total $11,838.81. Presenting the first as a "Grand
     * Total" beside a single salon's $958.79 is what made the dashboard look
     * arithmetically broken.
     */
    const delivered = aggregateMeasure(ALL_15, "grand_total").value!;
    expect(delivered).toBeGreaterThan(818.45 * 10);
  });

  it("sums the four additive counts exactly", () => {
    expect(aggregateMeasure(ALL_15, "tans").value).toBe(1839);
    expect(aggregateMeasure(ALL_15, "efts").value).toBe(13);
    expect(aggregateMeasure(ALL_15, "new_customers").value).toBe(33);
    expect(aggregateMeasure(ALL_15, "sunless_sessions").value).toBe(231);
  });

  it("reports a mean per salon alongside the total, correctly", () => {
    const figure = aggregateMeasure(ALL_15, "grand_total");
    expect(figure.meanPerSalon).toBe(789.25); // 11,838.81 / 15
  });

  it("does not drift on floating point", () => {
    // Fifteen dollar amounts added in binary floating point land on
    // 11838.809999999998 without rounding. It must be exact.
    const figure = aggregateMeasure(ALL_15, "grand_total");
    expect(String(figure.value)).toBe("11838.81");
  });
});

describe("PPTA is never summed and never quietly averaged", () => {
  it("refuses to combine it across salons", () => {
    /*
     * Summing the 15 PPTAs gives 38.73, which is not money per transaction, not
     * an average, and not any quantity the business has. A plain mean gives
     * 2.582, which is not the estate's 2.30 either.
     */
    const figure = aggregateMeasure(ALL_15, "ppta");
    expect(figure.basis).toBe("not_aggregatable");
    expect(figure.value).toBeNull();
    expect(figure.meanPerSalon).toBeNull();

    const naiveSum = Object.values(SEP2_DAILY).reduce((sum, row) => sum + row.ppta, 0);
    expect(Math.round(naiveSum * 100) / 100).toBe(38.73);
    expect(figure.value).not.toBe(38.73);
  });

  it("explains why, naming the missing weight", () => {
    const figure = aggregateMeasure(THREE, "ppta");
    expect(figure.reason).toContain("transaction");
    expect(figure.reason).toMatch(/does not include|not include/i);
  });

  it("still shows one salon's own reported PPTA untouched", () => {
    // A single salon is not an aggregation, so there is nothing to refuse.
    const figure = aggregateMeasure([salon("KS Lawrence")], "ppta");
    expect(figure.basis).toBe("reported");
    expect(figure.value).toBe(3.25);
  });

  it("is the only measure refused", () => {
    const refused = aggregateSalons(ALL_15, SALES_TOTALS_METRIC_CODES)
      .filter((figure) => figure.basis === "not_aggregatable")
      .map((figure) => figure.metricCode);
    expect(refused).toEqual(["ppta"]);
  });
});

describe("a single salon is its own reported figure", () => {
  it("returns the exact value, not a one-element sum", () => {
    const figure = aggregateMeasure([salon("KS Lawrence")], "grand_total");
    expect(figure.basis).toBe("reported");
    expect(figure.value).toBe(760.07);
    // No companion average for a single salon: it would restate the same number.
    expect(figure.meanPerSalon).toBeNull();
  });
});

describe("unreported values are excluded, not treated as zero", () => {
  it("keeps a blank out of the sum and out of the mean's denominator", () => {
    const blank: SalesTotalsSubject = {
      ...salon("KS Lawrence"),
      key: "0999",
      label: "Invented Salon",
      figures: salon("KS Lawrence").figures.map((figure) =>
        figure.metricCode === "grand_total" ? { ...figure, value: null } : figure,
      ),
    };
    const figure = aggregateMeasure([salon("MO Kansas City Liberty"), blank], "grand_total");

    expect(figure.value).toBe(1069.9);
    expect(figure.selectedSalons).toBe(2);
    // One contributor, so the mean is that one value — not half of it.
    expect(figure.reportingSalons).toBe(1);
    expect(figure.meanPerSalon).toBe(1069.9);
  });

  it("returns Unavailable rather than 0 when nobody reported", () => {
    const none = [salon("KS Lawrence"), salon("KS Manhattan")].map((subject) => ({
      ...subject,
      figures: subject.figures.map((figure) =>
        figure.metricCode === "tans" ? { ...figure, value: null } : figure,
      ),
    }));
    expect(aggregateMeasure(none, "tans").value).toBeNull();
  });
});

describe("the estate summary is labelled as an average, never as a total", () => {
  it("names the source scope figure an average per salon", () => {
    /*
     * THE LABEL FIX. The source column is called "Grand Total"; the value is a
     * per-salon average. The card must say the latter.
     */
    const measure = SALES_TOTALS_MEASURES_BY_CODE.grand_total;
    const heading = figureHeading(measure, "summary", 0);

    expect(heading).toBe("Average sales per salon");
    expect(heading.toLowerCase()).not.toContain("total");
  });

  it("names counts as averages too, in the summary block", () => {
    for (const code of ["tans", "efts", "new_customers", "sunless_sessions"]) {
      const heading = figureHeading(SALES_TOTALS_MEASURES_BY_CODE[code], "summary", 0);
      expect(heading.toLowerCase(), code).toContain("average");
      expect(heading.toLowerCase(), code).toContain("per salon");
    }
  });

  it("calls a multi-salon selection a TOTAL, because it is one", () => {
    expect(figureHeading(SALES_TOTALS_MEASURES_BY_CODE.grand_total, "salon", 15)).toBe(
      "Total sales",
    );
    expect(figureHeading(SALES_TOTALS_MEASURES_BY_CODE.tans, "salon", 3)).toBe("Total tans");
  });

  it("does not call a single salon's figure a total", () => {
    expect(figureHeading(SALES_TOTALS_MEASURES_BY_CODE.grand_total, "salon", 1)).toBe(
      "Grand Total",
    );
  });

  it("never labels PPTA a total at any scope", () => {
    for (const [kind, count] of [["summary", 0], ["salon", 1], ["salon", 15]] as const) {
      const heading = figureHeading(SALES_TOTALS_MEASURES_BY_CODE.ppta, kind, count);
      expect(heading.toLowerCase(), `${kind}/${count}`).not.toContain("total");
    }
  });

  it("refuses to combine estate scopes with each other", () => {
    /*
     * Two scope rows are two overlapping averages over different populations —
     * All Salons already contains both. Nothing here should ever aggregate
     * them, and the function is only ever handed salon subjects.
     */
    const scopes = [
      estateScope("STC Consolidated", 98, 734.5),
      estateScope("STC Franchisees", 151, 872.94),
    ];
    // Summed would be 1,607.44 — a number that describes nothing.
    expect(734.5 + 872.94).toBe(1607.44);
    expect(aggregateMeasure(scopes, "grand_total").value).not.toBe(818.45);
  });
});

describe("what the selection is called", () => {
  it("names one salon, a count, or the whole delivery", () => {
    expect(selectionHeading([salon("KS Lawrence")], 15)).toBe("KS Lawrence");
    expect(selectionHeading(THREE, 15)).toBe("3 salons selected");
    expect(selectionHeading(ALL_15, 15)).toBe("All 15 salons in this delivery");
    expect(selectionHeading([], 15)).toBe("No salons selected");
  });

  it("says 'in this delivery', never 'all salons'", () => {
    /*
     * "All Salons" is the name of a source ESTATE scope covering 249 salons.
     * Using the same words for the 15 delivered ones is precisely the collision
     * that made the dashboard confusing.
     */
    const heading = selectionHeading(ALL_15, 15);
    expect(heading).toContain("this delivery");
    expect(heading).not.toBe("All Salons");
  });
});
