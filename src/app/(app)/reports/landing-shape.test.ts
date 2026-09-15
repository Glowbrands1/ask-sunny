import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * ============================================================================
 * FOUR MEASURES, ONE CHART, ONE READING, THEN EVERYTHING ELSE
 * ============================================================================
 *
 * THE REVIEW, and the 15 September recheck that found it still unmet on three
 * tabs: "Every report currently opens at maximum detail… The detailed work is
 * valuable; it just should not be the landing view." The asked-for shape is
 * literal — four headline metrics, then ONE primary chart, then ONE
 * plain-language reading, then the remaining charts and tables behind
 * disclosures.
 *
 * Bed Usage, Spa Wellness and Spa Engagement each opened with three or four
 * charts and one or two open sections before their first disclosure.
 *
 * NOTHING WAS DELETED to satisfy this: every chart, table and panel is still on
 * the page, inside a `<details>` a click away. What this suite pins is the
 * ORDER, which is the part a future edit loses by accident — a new chart added
 * "just above the table" puts the landing view back where it started.
 *
 * Source-read, like `movers-section.test.ts` next door, because these are
 * server components whose render pulls a Supabase client, a period and a
 * roster: there is no honest way to mount them in jsdom, and the property is
 * structural rather than behavioural.
 */

const PAGES = ["bed-usage", "spa-wellness", "spa-engagement"] as const;

const source = (report: string) =>
  readFileSync(
    join(process.cwd(), "src", "app", "(app)", "reports", report, "page.tsx"),
    "utf8",
  );

describe.each(PAGES)("%s opens on the shape the review asked for", (report) => {
  const page = source(report);
  const panel = page.indexOf("<ReportInterpretationPanel");
  const kpis = page.indexOf("<KpiCardRow");

  it("renders the headline measures first", () => {
    expect(kpis).toBeGreaterThan(-1);
    expect(panel).toBeGreaterThan(kpis);
  });

  it("shows exactly one chart before the reading", () => {
    const before = page.slice(kpis, panel);
    const charts = before.match(/<ChartFrame\b/g) ?? [];
    expect(
      charts.length,
      `${report} opens with ${charts.length} charts before its reading`,
    ).toBe(1);
  });

  it("puts every remaining chart behind a disclosure", () => {
    const after = page.slice(panel);
    const nextChart = after.indexOf("<ChartFrame");
    const nextDisclosure = after.indexOf("<ReportDetailSection");

    // There is more to show — otherwise this report has nothing to drill into.
    expect(nextChart).toBeGreaterThan(-1);
    expect(nextDisclosure).toBeGreaterThan(-1);
    expect(
      nextDisclosure,
      `${report} renders a chart after its reading that is not inside a disclosure`,
    ).toBeLessThan(nextChart);
  });

  it("still carries the whole analysis, not a trimmed version", () => {
    /*
     * The failure mode opposite to a crowded landing view: satisfying the shape
     * by deleting the charts. Each of these tabs had three or four, and still
     * does.
     */
    const charts = page.match(/<ChartFrame\b/g) ?? [];
    expect(charts.length).toBeGreaterThanOrEqual(3);
  });
});

describe("the reading sits between the chart and the disclosures", () => {
  it.each(PAGES)("%s", (report) => {
    const page = source(report);
    const firstChart = page.indexOf("<ChartFrame");
    const panel = page.indexOf("<ReportInterpretationPanel");
    const firstDisclosureAfterPanel = page.slice(panel).indexOf("<ReportDetailSection");

    expect(firstChart).toBeLessThan(panel);
    expect(firstDisclosureAfterPanel).toBeGreaterThan(-1);
  });
});
