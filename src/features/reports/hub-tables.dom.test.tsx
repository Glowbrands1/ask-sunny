// @vitest-environment jsdom
import * as React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { SalonMetricTable } from "./salon-performance/salon-metric-table";
import { SalonComparisonTable } from "./salon-performance/salon-comparison-table";
import { SalesTotalsSalonTable } from "./sales-totals/salon-table";
import type {
  SalonMetricRow,
  SalonWindowComparison,
} from "@/lib/reporting/read/salon-detail";
import type { SalesTotalsSubject } from "@/lib/reporting/read/sales-totals-read";

/**
 * THE HUB'S TABLES ARE ONE TABLE NOW, AND THIS IS WHAT THAT HAD TO NOT COST.
 *
 * Three tables moved from their own hand-written head and row padding onto the
 * shared `.data-table` treatment. That is a class swap, which is exactly the
 * kind of change that looks free and is not: every one of these tables carries
 * information that a reader needs in order to quote a figure — the source sheet
 * and column, the window each row compares, "Unavailable" where the source left
 * a blank.
 *
 * None of these pages can be opened in a browser without Supabase, so the
 * conversion is checked here instead, the same way the KPI row and the ranking
 * table are.
 *
 * THE ALIGNMENT ASSERTION IS THE POINT OF THE THIRD TEST. The sales-totals
 * table centres its measure columns on purpose: six right-aligned columns on a
 * wide table put each figure hard against the NEXT column's heading, so a value
 * reads as belonging to the column on its right. The shared treatment carries
 * that as an option rather than the table overriding it, and this is what stops
 * a later tidy-up "correcting" it to right-aligned.
 */

function metricRow(overrides: Partial<SalonMetricRow> = {}): SalonMetricRow {
  return {
    metricCode: "total_revenue",
    label: "Total revenue",
    family: "Revenue",
    unit: "currency",
    basisYear: 2026,
    value: 1_163_402.18,
    sourceSheet: "YTD Comp",
    sourceColumn: "Total Revenue",
    comparisonOfCode: null,
    description: "Comparable-store revenue as reported.",
    ...overrides,
  } as SalonMetricRow;
}

function comparison(
  overrides: Partial<SalonWindowComparison> = {},
): SalonWindowComparison {
  return {
    windowId: "vs_2025",
    windowLabel: "vs 2025",
    windowShortLabel: "vs 2025",
    kind: "year",
    sourceSheet: "YTD Comp",
    current: { value: 1_163_402.18, basisYear: 2026 },
    baseline: { value: 1_072_118.4, basisYear: 2025 },
    change: 8.51,
    changeSource: "reported",
    currentLabel: "2026",
    baselineLabel: "2025",
    supported: true,
    ...overrides,
  } as unknown as SalonWindowComparison;
}

function subject(overrides: Partial<SalesTotalsSubject> = {}): SalesTotalsSubject {
  return {
    kind: "salon",
    key: "0468",
    label: "MO Kansas City Liberty",
    salonNumber: "0468",
    salonCount: null,
    figures: [
      {
        metricCode: "net_sales",
        metricLabel: "Net sales",
        unit: "currency",
        aggregation: "sum",
        summaryIsAverage: false,
        note: "",
        value: 12_480.55,
      },
    ],
    ...overrides,
  } as unknown as SalesTotalsSubject;
}

afterEach(cleanup);

describe("the hub's tables share one treatment without losing their content", () => {
  it("salon metric table: on the shared treatment, lineage intact", () => {
    const { container } = render(
      <SalonMetricTable
        rows={[metricRow()]}
        sourceReport="Comp Report"
        windowLabel="vs 2025"
      />,
    );

    expect(container.querySelector("table")?.className).toContain("data-table");
    expect(screen.getAllByText("Total revenue").length).toBeGreaterThan(0);
    // The source sheet and column are how a figure stops being a claim.
    expect(container.textContent).toContain("YTD Comp");
    expect(container.textContent).toContain("Total Revenue");
  });

  it("salon comparison table: on the shared treatment, each window still names its two figures", () => {
    const { container } = render(
      <SalonComparisonTable
        comparisons={[comparison()]}
        unit="currency"
        metricLabel="Total revenue"
        higherIsBetter
        sourceReport="Comp Report"
      />,
    );

    expect(container.querySelector("table")?.className).toContain("data-table");
    expect(screen.getAllByText("vs 2025").length).toBeGreaterThan(0);
    expect(container.textContent).toContain("2026");
    expect(container.textContent).toContain("2025");
  });

  it("salon comparison table: colours a change only when the measure is behind", () => {
    const { container: rising } = render(
      <SalonComparisonTable
        comparisons={[comparison({ change: 8.51 })]}
        unit="currency"
        metricLabel="Total revenue"
        higherIsBetter
        sourceReport={null}
      />,
    );
    expect(rising.innerHTML).not.toContain("measure-flagged-foreground");
    cleanup();

    const { container: falling } = render(
      <SalonComparisonTable
        comparisons={[comparison({ change: -8.51 })]}
        unit="currency"
        metricLabel="Total revenue"
        higherIsBetter
        sourceReport={null}
      />,
    );
    expect(falling.innerHTML).toContain("measure-flagged-foreground");
  });

  it("sales totals table: keeps its measure columns CENTRED, not right-aligned", () => {
    const { container } = render(
      <SalesTotalsSalonTable
        salons={[subject()]}
        metrics={[{ code: "net_sales", label: "Net sales", unit: "currency" }]}
        sortField="label"
        sortHref={() => "#"}
        activeSalon={null}
      />,
    );

    expect(container.querySelector("table")?.className).toContain("data-table");
    // Both the heading and its figures, or the column drifts off its heading.
    expect(container.querySelector('th[data-align="center"]')).toBeTruthy();
    expect(container.querySelector('td[data-align="center"]')).toBeTruthy();
    expect(container.querySelector('td[data-align="right"]')).toBeNull();
    expect(screen.getByText("MO Kansas City Liberty")).toBeTruthy();
  });

  it("sales totals table: says Unavailable rather than printing a zero", () => {
    render(
      <SalesTotalsSalonTable
        salons={[
          subject({
            figures: [
              {
                metricCode: "net_sales",
                metricLabel: "Net sales",
                unit: "currency",
                aggregation: "sum",
                summaryIsAverage: false,
                note: "",
                value: null,
              },
            ],
          } as Partial<SalesTotalsSubject>),
        ]}
        metrics={[{ code: "net_sales", label: "Net sales", unit: "currency" }]}
        sortField="label"
        sortHref={() => "#"}
        activeSalon={null}
      />,
    );
    expect(screen.getByText("Unavailable")).toBeTruthy();
    expect(screen.queryByText("$0.00")).toBeNull();
  });
});
