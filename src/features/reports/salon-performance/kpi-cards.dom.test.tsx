// @vitest-environment jsdom
import * as React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

import { KpiCards } from "./kpi-cards";
import type { DashboardKpi } from "@/lib/reporting/read/dashboard";
import type { MetricAggregate } from "@/lib/reporting/read/types";

/**
 * THE KPI ROW SURVIVED A RESTRUCTURE, AND THIS IS WHAT THAT HAD TO MEAN.
 *
 * The row moved from four bordered cards to one panel divided by hairlines, to
 * match the Marquee direction's stat treatment. The visual change is not what
 * these tests are for — the risk was that the breakdown UNDER each figure got
 * flattened away while it looked like a tidy-up.
 *
 * That breakdown is load-bearing. A revenue figure without its salon count
 * invites being read as company-wide, and an absent measurement shown as `0`
 * reads as a collapse rather than a gap. So the assertions here are about the
 * information, not the layout: the figure, the named comparison, the salon
 * count, and the refusal to print a zero for something unavailable.
 *
 * This page needs Supabase to render, so it cannot be checked in a browser
 * during local work — which is exactly why it is checked here.
 */

function aggregate(value: number | null, overrides: Partial<MetricAggregate> = {}): MetricAggregate {
  return {
    metricCode: "total_revenue",
    basisYear: 2026,
    kind: "sum",
    value,
    salonCount: 15,
    companyWide: false,
    ...overrides,
  } as MetricAggregate;
}

function kpi(overrides: Partial<DashboardKpi> = {}): DashboardKpi {
  return {
    metricCode: "total_revenue",
    label: "Total revenue",
    unit: "currency",
    higherIsBetter: true,
    current: aggregate(7_487_004.01),
    baseline: aggregate(7_123_000, { basisYear: 2025 }),
    change: { value: 5.11, source: "reported", note: "" },
    salonCount: 15,
    currentLabel: "2026",
    baselineLabel: "2025",
    supported: true,
    ...overrides,
  } as DashboardKpi;
}

afterEach(cleanup);

describe("the KPI row keeps what makes a figure quotable", () => {
  it("shows the figure, the comparison it is against, and the salon count", () => {
    render(<KpiCards kpis={[kpi()]} windowShortLabel="vs 2025" />);

    expect(screen.getByText("Total revenue")).toBeTruthy();
    // The denominator is the thing that stops this reading as company-wide.
    const count = screen.getByText("Salons reporting");
    expect(count.nextElementSibling?.textContent).toBe("15");
    // Both sides of the comparison are named, not just the current one.
    expect(screen.getByText("2026")).toBeTruthy();
    expect(screen.getByText("2025")).toBeTruthy();
    expect(screen.getByText("vs 2025")).toBeTruthy();
  });

  it("says Unavailable rather than printing a zero", () => {
    render(
      <KpiCards
        kpis={[
          kpi({
            current: aggregate(null, { unavailableReason: "Not in this report" }),
            change: { value: null, source: "unavailable", note: "" },
          }),
        ]}
        windowShortLabel="vs 2025"
      />,
    );
    expect(screen.getAllByText("Unavailable").length).toBeGreaterThan(0);
    expect(screen.queryByText("$0.00")).toBeNull();
  });

  it("colours the change green when it is good and red when it is behind", () => {
    /*
     * THIS RULE WAS REVERSED BY REQUEST, so both halves are pinned together.
     *
     * The direction removed green and made a rise read neutral. For THIS
     * control — a change that already names both sides of its comparison — a
     * green arrow up and a red arrow down were asked for and are what this now
     * does. Everywhere else in the app a measure is still neutral until it is
     * behind; see `docs/marquee-design-freeze.md`.
     */
    const { container: rising } = render(
      <KpiCards kpis={[kpi({ change: { value: 4.1, source: "reported", note: "" } })]} windowShortLabel="vs 2025" />,
    );
    expect(rising.innerHTML).toContain("text-delta-up");
    expect(rising.innerHTML).not.toContain("measure-flagged-foreground");
    cleanup();

    const { container: falling } = render(
      <KpiCards kpis={[kpi({ change: { value: -4.1, source: "reported", note: "" } })]} windowShortLabel="vs 2025" />,
    );
    expect(falling.innerHTML).toContain("measure-flagged-foreground");
    expect(falling.innerHTML).not.toContain("text-delta-up");
  });

  it("stays neutral where the business has not said which way is better", () => {
    /*
     * THE HALF THAT MATTERS MOST NOW THAT GREEN IS BACK. `higher_is_better` is
     * null for some measures, and a green arrow on one of those would be the
     * app inventing a judgement — a rise in a cost measure painted as good.
     * Neither colour, and the screen reader is told why.
     */
    const { container } = render(
      <KpiCards
        kpis={[kpi({ higherIsBetter: null, change: { value: 4.1, source: "reported", note: "" } })]}
        windowShortLabel="vs 2025"
      />,
    );
    expect(container.innerHTML).not.toContain("text-delta-up");
    expect(container.innerHTML).not.toContain("measure-flagged-foreground");
    expect(screen.getByText(/direction not defined for this measure/)).toBeTruthy();
  });

  it("never rests the meaning on the colour", () => {
    // Green and red are the worst pair for the commonest colour blindness, so
    // the arrow glyph and the word both have to survive.
    render(
      <KpiCards kpis={[kpi({ change: { value: 4.1, source: "reported", note: "" } })]} windowShortLabel="vs 2025" />,
    );
    expect(screen.getByText("increase")).toBeTruthy();
  });

  it("renders one panel, not a card each", () => {
    /*
     * The direction's argument: four bordered boxes make four objects that run
     * together, and a figure only reads as the largest thing on the page when
     * nothing is drawn around it. Asserted through the shared cell class, so
     * the hairline rules stay in one place rather than being re-derived per
     * caller.
     */
    const { container } = render(
      <KpiCards kpis={[kpi(), kpi({ metricCode: "eft_revenue", label: "EFT revenue" })]} windowShortLabel="vs 2025" />,
    );
    const panel = container.firstElementChild as HTMLElement;
    expect(panel.className).toContain("rounded-2xl");
    expect(within(panel).getByText("EFT revenue")).toBeTruthy();
    expect(panel.querySelectorAll(".stat-cell").length).toBe(2);
  });
});

/**
 * ============================================================================
 * "NO FIGURE" AND "NO COMPARISON" ARE DIFFERENT FACTS
 * ============================================================================
 *
 * Production showed Total Revenue at $684,226.16 beside a Total Tans card
 * reading "Unavailable", under a window where the source carried both. The
 * card had one word for two states, so a reader could not tell a broken
 * measure from a missing prior year — and the second is not a fault at all.
 *
 * The distinction is asserted here rather than in the page, because the page
 * needs Supabase to render and this component is where the wording lives.
 */
describe("a present figure with an absent baseline", () => {
  const presentNoBaseline = () =>
    kpi({
      metricCode: "total_tans",
      label: "Total Tans",
      unit: "count",
      current: aggregate(19_680, { metricCode: "total_tans" }),
      baseline: null,
      change: { value: null, source: "unavailable", note: "" },
      supported: true,
    });

  it("shows the current figure rather than calling the measure unavailable", () => {
    render(<KpiCards kpis={[presentNoBaseline()]} windowShortLabel="vs 2025" />);

    expect(screen.getByText("19,680")).toBeTruthy();
    // The headline must not be the word used for a missing measure.
    expect(screen.queryByText("Unavailable")).toBeNull();
  });

  it("names the absence as the baseline's, not the measure's", () => {
    render(<KpiCards kpis={[presentNoBaseline()]} windowShortLabel="vs 2025" />);

    expect(screen.getByText("Not reported")).toBeTruthy();
    expect(screen.getByText("2025 comparison not reported.")).toBeTruthy();
  });

  it("keeps the card in the row instead of dropping it", () => {
    render(
      <KpiCards
        kpis={[kpi(), presentNoBaseline()]}
        windowShortLabel="vs 2025"
      />,
    );

    expect(screen.getByText("Total revenue")).toBeTruthy();
    expect(screen.getByText("Total Tans")).toBeTruthy();
  });

  it("still says Unavailable when the figure itself is missing", () => {
    render(
      <KpiCards
        kpis={[
          kpi({
            label: "Unique Tanners",
            current: aggregate(null),
            baseline: null,
            change: { value: null, source: "unavailable", note: "The source report does not carry Unique Tanners for vs 2025." },
            supported: false,
          }),
        ]}
        windowShortLabel="vs 2025"
      />,
    );

    expect(screen.getAllByText("Unavailable").length).toBeGreaterThan(0);
    expect(
      screen.getByText("The source report does not carry Unique Tanners for vs 2025."),
    ).toBeTruthy();
    // And NOT the baseline-only wording, which would be the wrong claim.
    expect(screen.queryByText("2025 comparison not reported.")).toBeNull();
  });

  it("shows a full comparison untouched when both sides exist", () => {
    render(<KpiCards kpis={[kpi()]} windowShortLabel="vs 2024" />);

    expect(screen.getByText("2026")).toBeTruthy();
    expect(screen.getByText("2025")).toBeTruthy();
    expect(screen.queryByText("Not reported")).toBeNull();
    expect(screen.queryByText("2025 comparison not reported.")).toBeNull();
  });
});
