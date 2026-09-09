import { describe, expect, it } from "vitest";

import {
  SALES_TOTALS_MEASURES,
  SALES_TOTALS_METRIC_CODES,
} from "../sales-totals/metric-map";
import { aggregateSalons } from "./sales-totals-aggregate";
import {
  buildSalesTotalsBriefing,
  MAX_SALES_TOTALS_BRIEFING_ROWS,
  SALES_TOTALS_BRIEFING_RULES,
  type SalesTotalsWindowBriefing,
} from "./sales-totals-briefing";
import type { SalesTotalsSnapshot, SalesTotalsSubject } from "./sales-totals-read";
import { orderSalonsByMetric } from "./sales-totals-view";

/**
 * ============================================================================
 * WHAT THE SALES TOTALS SECTION MUST AND MUST NOT SAY
 * ============================================================================
 *
 * This renderer is pure, so its behaviour is fully testable — and the things
 * worth testing are the three claims this source will make if it is let.
 *
 *   THE ESTATE ROWS ARE AVERAGES, not the chain's totals. Rendered beside a
 *   salon's own takings with no note, "All Salons Grand Total $824.14" next to
 *   "$506.47" reads as the estate doing worse than one store.
 *
 *   MONTH TO DATE IS ALREADY CUMULATIVE, so two report dates must never be
 *   added.
 *
 *   PPTA HAS NO COMBINED FIGURE. `aggregateSalons` refuses it and carries the
 *   reason; the renderer must print the reason rather than a number.
 *
 * NO FIGURE IS COMPUTED HERE. Every value written comes from the aggregate the
 * dashboard also renders, which is what stops chat and the tab disagreeing.
 */

function figures(values: Partial<Record<string, number | null>>) {
  return SALES_TOTALS_MEASURES.map((measure) => ({
    metricCode: measure.code,
    metricLabel: measure.label,
    unit: measure.unit,
    aggregation: measure.aggregation,
    summaryIsAverage: measure.summaryIsAverage,
    note: measure.note,
    value: values[measure.code] ?? null,
  }));
}

function salon(
  label: string,
  salonNumber: string,
  values: Partial<Record<string, number | null>>,
): SalesTotalsSubject {
  return {
    kind: "salon",
    key: salonNumber,
    label,
    salonNumber,
    salonCount: null,
    figures: figures(values),
  };
}

function summary(
  label: string,
  key: string,
  salonCount: number,
  values: Partial<Record<string, number | null>>,
): SalesTotalsSubject {
  return {
    kind: "summary",
    key,
    label,
    salonNumber: null,
    salonCount,
    figures: figures(values),
  };
}

const SALONS = [
  salon("KS Lawrence", "0123", {
    grand_total: 506.47,
    ppta: 2.63,
    tans: 78,
    efts: 0,
    new_customers: 0,
    sunless_sessions: 6,
  }),
  salon("KS Manhattan", "0456", {
    grand_total: 802.45,
    ppta: 2.95,
    tans: 142,
    efts: 2,
    new_customers: 6,
    sunless_sessions: 11,
  }),
  salon("KS Topeka", "0789", {
    grand_total: null,
    ppta: null,
    tans: 60,
    efts: 1,
    new_customers: 1,
    sunless_sessions: null,
  }),
];

function snapshot(window: "daily" | "mtd"): SalesTotalsSnapshot {
  return {
    reportDate: "2026-09-03",
    reportDateRaw: "09-03-2026",
    monthStart: "2026-09-01",
    window,
    windowLabel: window === "daily" ? "Previous Day" : "Month to Date",
    windowDescription: "",
    summaries: [
      summary("All Salons", "all_salons", 249, { grand_total: 824.14, ppta: 2.38, tans: 135 }),
      summary("STC Franchisees", "stc_franchisees", 151, {
        grand_total: 861.16,
        ppta: 2.77,
        tans: 125,
      }),
    ],
    salons: SALONS,
    lineage: {
      parserKey: "sales_totals_daily",
      parserVersion: 1,
      ingestedAt: "2026-09-03T11:02:00Z",
    },
  };
}

function windowFor(window: "daily" | "mtd"): SalesTotalsWindowBriefing {
  const snap = snapshot(window);
  return {
    window,
    snapshot: snap,
    aggregated: aggregateSalons(SALONS, SALES_TOTALS_METRIC_CODES),
    salons: orderSalonsByMetric(SALONS, "grand_total"),
  };
}

function build(
  overrides: Partial<Parameters<typeof buildSalesTotalsBriefing>[0]> = {},
): string {
  return (
    buildSalesTotalsBriefing({
      windows: [windowFor("daily"), windowFor("mtd")],
      deliverySalonCount: SALONS.length,
      selectionLabel: null,
      fellBackToNewest: false,
      ...overrides,
    }) ?? ""
  );
}

describe("nothing loaded means no section at all", () => {
  it("returns null rather than an empty heading", () => {
    /*
     * A block that announces report data and then lists none invites the model
     * to fill the gap. The composer turns a requested-but-absent family into an
     * explicit "no current delivery" line instead.
     */
    expect(
      buildSalesTotalsBriefing({
        windows: [],
        deliverySalonCount: 0,
        selectionLabel: null,
        fellBackToNewest: false,
      }),
    ).toBeNull();
  });
});

describe("the report identifies itself", () => {
  it("names the date, both the ISO and the source's own spelling", () => {
    const text = build();
    expect(text).toContain("report date 2026-09-03");
    expect(text).toContain("source wrote it 09-03-2026");
  });

  it("carries its lineage, so a figure can be traced to a delivery", () => {
    expect(build()).toContain("parser sales_totals_daily v1");
    expect(build()).toContain("loaded 2026-09-03T11:02:00Z");
  });

  it("says out loud when it read a different date from the one asked for", () => {
    // A stale bookmark quietly answering about a different day is the failure.
    // Chat has no date picker to reveal it, so the text has to.
    const text = build({ fellBackToNewest: true });
    expect(text).toContain("NEWEST delivery was read instead");
    expect(text).toContain("Say so before quoting these figures");
  });
});

describe("both windows are briefed, and each says what it covers", () => {
  it("describes the day and the cumulative month separately", () => {
    const text = build();
    expect(text).toContain("PREVIOUS DAY — the single day of 2026-09-03");
    expect(text).toContain(
      "MONTH TO DATE — 2026-09-01 through 2026-09-03, already cumulative",
    );
  });

  it("leads with the window the reader was on", () => {
    const text =
      buildSalesTotalsBriefing({
        windows: [windowFor("mtd"), windowFor("daily")],
        deliverySalonCount: SALONS.length,
        selectionLabel: null,
        fellBackToNewest: false,
      }) ?? "";
    expect(text.indexOf("MONTH TO DATE")).toBeLessThan(text.indexOf("PREVIOUS DAY"));
  });
});

describe("the two populations are kept apart", () => {
  it("labels the estate rows as per-salon averages, with their denominator", () => {
    const text = build();
    expect(text).toContain("PER-SALON AVERAGES over the whole chain");
    expect(text).toContain("NOT totals and NOT comparable with the delivery figures above");
    expect(text).toContain("All Salons (average per salon over 249 salons)");
  });

  it("labels the delivery rows as the delivery's own", () => {
    expect(build()).toContain("This delivery — all 3 salons in the delivery");
  });

  it("names the selection when one narrowed the rows", () => {
    const text = build({ selectionLabel: "2 salons selected" });
    expect(text).toContain("selected salon(s) of 3 in the delivery (2 salons selected)");
  });

  it("forbids the comparison in words as well as in layout", () => {
    expect(SALES_TOTALS_BRIEFING_RULES).toContain("DIFFERENT POPULATIONS");
    expect(SALES_TOTALS_BRIEFING_RULES).toContain("Never compare one directly with the other");
    expect(SALES_TOTALS_BRIEFING_RULES).toContain("never call an estate average a total");
  });
});

describe("the combined figures are the dashboard's, not this file's", () => {
  it("writes the sum for a summable measure", () => {
    // 78 + 142 + 60 = 280, computed by `aggregateSalons` and printed here.
    expect(build()).toContain("Tans 280");
  });

  it("says how many salons reported a measure when some did not", () => {
    /*
     * A blank is NOT REPORTED, which is not zero. Two of the three salons
     * reported Grand Total, and a total that silently covered two while
     * describing three would understate the delivery.
     */
    expect(build()).toContain("(2 of 3 salons reported it)");
  });

  it("prints the REFUSAL and its reason for PPTA rather than a number", () => {
    const text = build();
    expect(text).toContain("PPTA: no combined figure.");
    // The reason comes from the aggregator, so the tab and chat give the same
    // explanation.
    const refused = aggregateSalons(SALONS, ["ppta"])[0];
    expect(refused.basis).toBe("not_aggregatable");
    expect(text).toContain(refused.reason!);
  });

  it("states the rule as well, because a model will try to average them", () => {
    expect(SALES_TOTALS_BRIEFING_RULES).toContain("PPTA IS AN AVERAGE AT EVERY SCOPE");
    expect(SALES_TOTALS_BRIEFING_RULES).toContain("Never sum it");
  });
});

describe("every salon row carries every measure, in the report's own order", () => {
  it("writes all six measures per salon", () => {
    const text = build();
    expect(text).toContain(
      "KS Manhattan (0456): Grand Total $802.45, PPTA $2.95, Tans 142, EFTs 2, New Customers 6, Sunless Sessions 11",
    );
  });

  it("writes not reported, never zero, for a blank cell", () => {
    expect(build()).toContain("KS Topeka (0789): Grand Total not reported");
  });

  it("keeps a salon whose selected measure is blank, sunk to the bottom", () => {
    const text = build();
    expect(text.indexOf("KS Manhattan")).toBeLessThan(text.indexOf("KS Lawrence"));
    expect(text.indexOf("KS Lawrence")).toBeLessThan(text.indexOf("KS Topeka"));
  });
});

describe("truncation says so", () => {
  it("caps the rows and warns against reading a lowest or highest off a cut list", () => {
    const many = Array.from({ length: MAX_SALES_TOTALS_BRIEFING_ROWS + 5 }, (_, index) =>
      salon(`Store ${index}`, String(index).padStart(4, "0"), { grand_total: 1000 - index }),
    );
    const text =
      buildSalesTotalsBriefing({
        windows: [
          {
            window: "daily",
            snapshot: { ...snapshot("daily"), salons: many },
            aggregated: aggregateSalons(many, SALES_TOTALS_METRIC_CODES),
            salons: many,
          },
        ],
        deliverySalonCount: many.length,
        selectionLabel: null,
        fellBackToNewest: false,
      }) ?? "";

    expect(text).toContain(
      `Only the first ${MAX_SALES_TOTALS_BRIEFING_ROWS} of ${many.length} rows are listed here`,
    );
    expect(text).toContain("Do not describe the lowest or highest unless the list is complete");
    expect(text).not.toContain(`Store ${many.length - 1}`);
  });
});

describe("the rules name what this report does NOT carry", () => {
  it("lists the measures the Daily Stats framework describes and this source lacks", () => {
    /*
     * THE FRAMEWORK IS WIDER THAN THE DATA, and that gap is where a confident
     * wrong answer comes from: it discusses employee productivity, coupons,
     * drawer reconciliation, breaks, inventory and labour hours at length, and
     * Sales Totals carries none of them. Verified against the real delivery —
     * six measures, two windows, three estate rows, fifteen salon rows.
     */
    for (const absent of [
      "employee-level",
      "coupon",
      "drawer reconciliation",
      "break records",
      "inventory",
      "labour hours",
    ]) {
      expect(SALES_TOTALS_BRIEFING_RULES.toLowerCase()).toContain(absent.toLowerCase());
    }
    expect(SALES_TOTALS_BRIEFING_RULES).toContain(
      "say the report does not carry it rather than inferring it",
    );
  });

  it("bars summing month-to-date across dates", () => {
    expect(SALES_TOTALS_BRIEFING_RULES).toContain("MONTH TO DATE IS ALREADY CUMULATIVE");
    expect(SALES_TOTALS_BRIEFING_RULES).toContain("pick one; never sum");
  });

  it("bars computing a new figure from the ones given", () => {
    expect(SALES_TOTALS_BRIEFING_RULES).toContain("Quote only figures written below");
    expect(SALES_TOTALS_BRIEFING_RULES).toContain("Do not compute a new ratio");
  });
});
