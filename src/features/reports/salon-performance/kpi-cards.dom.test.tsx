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

  it("rounds the headline and prints the exact figure under it in mono", () => {
    /*
     * The artifact sets `$7.49M` at display size with `$7,487,004.01` beneath
     * it in monospace. Full precision as the headline is unreadable at a glance
     * and implies a precision nobody needs in order to act.
     *
     * BOTH NUMBERS HAVE TO BE ON SCREEN. The rounding is a reading aid, not a
     * substitution — the exact figure is the one that gets quoted, and the mono
     * face is how the design says "as the source reported it".
     */
    const { container } = render(
      <KpiCards kpis={[kpi({ current: aggregate(7_487_004.01) })]} windowShortLabel="vs 2025" />,
    );

    expect(container.querySelector(".display-figure")?.textContent).toBe("$7.5M");
    const exact = container.querySelector(".font-mono") as HTMLElement;
    expect(exact.textContent).toBe("$7,487,004.01");
  });

  it("does not print the same figure twice when rounding changes nothing", () => {
    /*
     * A small count rounds to itself, and the same string in two faces reads as
     * two different measurements. The mono line earns its place or it is absent.
     */
    const { container } = render(
      <KpiCards
        kpis={[kpi({ unit: "count", current: aggregate(15) })]}
        windowShortLabel="vs 2025"
      />,
    );
    expect(container.querySelector(".display-figure")?.textContent).toBe("15");
    expect(container.querySelector(".font-mono")).toBeNull();
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

  it("colours a rise green and a shortfall coral", () => {
    /*
     * THIS RULE CHANGED, and the test changed with it rather than being
     * relaxed around it.
     *
     * It used to pin "green is out of the system, so a rise is neutral" —
     * coral for the one measure needing attention, nothing otherwise. The
     * Marquee artifact is the visual source of truth and is explicit: its
     * movers legend reads Increase / Decrease in green and coral, and it sets
     * a rising change figure to #2f6b4f. So a rise is green now.
     *
     * What did NOT change is the honesty guard: `sentimentFor` reads the
     * measure's own `higher_is_better`, so green means "rose on a measure
     * where rising is good", never just "bigger number". A measure with no
     * defined direction stays neutral — see the third case.
     */
    const { container: rising } = render(
      <KpiCards kpis={[kpi({ change: { value: 4.1, source: "reported", note: "" } })]} windowShortLabel="vs 2025" />,
    );
    expect(rising.innerHTML).toContain("delta-up");
    expect(rising.innerHTML).not.toContain("measure-flagged-foreground");
    cleanup();

    const { container: falling } = render(
      <KpiCards kpis={[kpi({ change: { value: -4.1, source: "reported", note: "" } })]} windowShortLabel="vs 2025" />,
    );
    expect(falling.innerHTML).toContain("measure-flagged-foreground");
    expect(falling.innerHTML).not.toContain("delta-up");
    cleanup();

    /*
     * DIRECTION UNDEFINED MEANS NO JUDGEMENT. A rise on a measure the business
     * has not scored is neither good nor bad, so it takes neither colour.
     */
    const { container: unscored } = render(
      <KpiCards
        kpis={[kpi({ higherIsBetter: null, change: { value: 4.1, source: "reported", note: "" } })]}
        windowShortLabel="vs 2025"
      />,
    );
    expect(unscored.innerHTML).not.toContain("delta-up");
    expect(unscored.innerHTML).not.toContain("measure-flagged-foreground");
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
