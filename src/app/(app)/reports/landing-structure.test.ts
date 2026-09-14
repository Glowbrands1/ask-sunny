import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  SALES_TOTALS_HEADLINE_CODES,
  SALES_TOTALS_METRIC_CODES,
  isHeadlineSalesMeasure,
} from "@/lib/reporting/sales-totals/metric-map";
import { HEADLINE_METRIC_CODES } from "@/lib/reporting/read/filters";

/**
 * ============================================================================
 * EVERY REPORT LANDS THE SAME WAY
 * ============================================================================
 *
 * THE REVIEW: "Every report currently opens at maximum detail... The detailed
 * work is valuable; it just should not be the landing view." The shape agreed
 * was four headline metrics, one chart, one plain-language interpretation, and
 * the detail behind a disclosure.
 *
 * THE GAP THIS FILE WAS WRITTEN FOR. Four reports were brought to that shape
 * and Sales Totals was not — it rendered all SIX of the delivery's measures as
 * equal cards, which is the same complaint in a milder form: nothing on the
 * page says which number a manager came for. It went unnoticed because it was
 * the one report whose KPI row is driven by the metric map rather than written
 * out in the page, so a count of cards in the JSX found nothing.
 *
 * So the rule is asserted structurally, for all five, rather than by reading
 * any one page. A sixth report added later has to satisfy it too.
 */

const REPORTS = [
  "salon-performance",
  "sales-totals",
  "bed-usage",
  "spa-wellness",
  "spa-engagement",
] as const;

function page(report: string): string {
  return readFileSync(
    join(process.cwd(), "src", "app", "(app)", "reports", report, "page.tsx"),
    "utf8",
  );
}

describe("the landing view of every report", () => {
  it("carries a plain-language interpretation", () => {
    /*
     * Derived, never a fixed sentence: each panel is fed by an `interpret*`
     * function whose output is asserted line by line in its own suite. A
     * generic filler string would not satisfy the review and would not need a
     * function to produce it.
     */
    for (const report of REPORTS) {
      expect(page(report), `${report} has no interpretation panel`).toMatch(
        /<ReportInterpretationPanel\s/,
      );
      expect(page(report), `${report}'s reading is not derived`).toMatch(
        /reading=\{interpret[A-Za-z]+\(/,
      );
    }
  });

  it("puts its detail behind a disclosure", () => {
    for (const report of REPORTS) {
      expect(page(report), `${report} has no detail disclosure`).toMatch(
        /<ReportDetailSection\s/,
      );
    }
  });

  it("shows a chart", () => {
    for (const report of REPORTS) {
      expect(page(report), `${report} has no chart`).toMatch(
        /<ChartFrame|RankingChart|RankedBarChart|MoversChart/,
      );
    }
  });
});

describe("four headline metrics, not all of them", () => {
  it("Salon Performance leads with four", () => {
    expect(HEADLINE_METRIC_CODES).toHaveLength(4);
  });

  it("Sales Totals leads with four of its six, and hides none", () => {
    /*
     * THE REGRESSION. Six equal cards is not a landing view. The split is
     * presentation only — every measure the delivery carries is still
     * aggregated, still in the table, still in the briefing, still in the
     * analyser.
     */
    expect(SALES_TOTALS_HEADLINE_CODES).toHaveLength(4);
    expect(SALES_TOTALS_METRIC_CODES).toHaveLength(6);

    const secondary = SALES_TOTALS_METRIC_CODES.filter(
      (code) => !isHeadlineSalesMeasure(code),
    );
    expect(secondary).toEqual(["new_customers", "sunless_sessions"]);

    // Every headline code is a real measure, so a typo cannot silently empty
    // the landing row.
    for (const code of SALES_TOTALS_HEADLINE_CODES) {
      expect(SALES_TOTALS_METRIC_CODES, `${code} is not a measure`).toContain(code);
    }
  });

  it("leads Sales Totals with the takings, the traffic, the rate and the membership", () => {
    // Not an arbitrary four: the review spent most of its length on PPTA, and
    // the other three are what a daily sales report is for.
    expect(SALES_TOTALS_HEADLINE_CODES).toEqual(["grand_total", "ppta", "tans", "efts"]);
  });

  it("renders the secondary measures from the SAME aggregation", () => {
    /*
     * Aggregating twice would let the landing row and the disclosure disagree
     * about a figure. Both are filtered from one `aggregated` array, and the
     * plain-language reading still receives all six.
     */
    const source = page("sales-totals");

    expect(source).toMatch(/const headlineFigures = aggregated\.filter\(/);
    expect(source).toMatch(/const secondaryFigures = aggregated\.filter\(/);
    expect(source).toMatch(/figures: aggregated,/);
  });
});
