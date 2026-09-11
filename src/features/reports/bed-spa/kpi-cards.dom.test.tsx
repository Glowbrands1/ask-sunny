// @vitest-environment jsdom
import * as React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { KpiCardRow, trendFor, type KpiCard } from "./kpi-cards";

/**
 * THE KPI ROW SURVIVED A RESTYLE, AND THIS IS WHAT THAT HAD TO MEAN.
 *
 * The row moved from four bordered cards to one panel divided by hairlines. The
 * look is not what these tests are for — the risk in a restyle is that
 * something load-bearing gets flattened away while it looks like a tidy-up, and
 * this row carries two things that were put there on purpose:
 *
 *   `N/A`, NEVER `0`. A card is the most quoted object on the page, and a zero
 *   is how "the source did not report this" becomes "this salon did nothing" in
 *   somebody's summary.
 *
 *   THE HELPER IS REQUIRED. Several of these measures have near-identical names
 *   and different meanings — Spa Per Unique % against Sessions per Unique per
 *   Bed — and the helper is the shortest thing that says which one is on
 *   screen.
 *
 * Bed Usage, Spa Engagement and Spa Wellness all need Supabase to render, so
 * this is the only place these rules can be checked.
 */

function card(overrides: Partial<KpiCard> = {}): KpiCard {
  return {
    id: "total-tans",
    label: "Total Tans",
    value: "48,584",
    helper: "Across 15 salons, read once per salon.",
    ...overrides,
  };
}

afterEach(cleanup);

describe("the bed and spa KPI row keeps what makes a figure quotable", () => {
  it("shows the figure and the line that says what it is", () => {
    render(<KpiCardRow cards={[card()]} />);
    expect(screen.getByText("Total Tans")).toBeTruthy();
    expect(screen.getByText("48,584")).toBeTruthy();
    expect(screen.getByText("Across 15 salons, read once per salon.")).toBeTruthy();
  });

  it("prints N/A for a figure the source did not report, never a zero", () => {
    render(
      <KpiCardRow
        cards={[card({ value: null, helper: "This salon reported no tans column." })]}
      />,
    );
    expect(screen.getByText("N/A")).toBeTruthy();
    expect(screen.queryByText("0")).toBeNull();
  });

  it("renders one panel, not a card each", () => {
    const { container } = render(
      <KpiCardRow cards={[card(), card({ id: "beds", label: "Total Beds", value: "285" })]} />,
    );
    const panel = container.firstElementChild as HTMLElement;
    expect(panel.className).toContain("stat-grid");
    expect(panel.children.length).toBe(2);
  });

  it("flags a measure behind its benchmark and nothing else", () => {
    /*
     * The only trend these reports pass is a difference against a benchmark —
     * the chain, or the peers with the same equipment installed — so down is
     * behind. Up is NOT the mirror image of that: green is out of the system,
     * and a row where something is always coloured teaches managers to ignore
     * the colour.
     */
    const { container: behind } = render(
      <KpiCardRow
        cards={[card({ changeLabel: "-6.2% against installed peers", trend: "down" })]}
      />,
    );
    expect(behind.innerHTML).toContain("measure-flagged-foreground");
    // And it says so in words, for a reader who cannot see the coral.
    expect(screen.getByText("Behind benchmark:")).toBeTruthy();
    cleanup();

    for (const trend of ["up", "flat"] as const) {
      const { container } = render(
        <KpiCardRow cards={[card({ changeLabel: "+6.2% against peers", trend })]} />,
      );
      expect(container.innerHTML, trend).not.toContain("measure-flagged-foreground");
      cleanup();
    }
  });

  it("gives the headline figure size rather than a colour", () => {
    /*
     * The emphasised card used to be a soft navy panel. Colour in this
     * direction belongs to measures that are behind, so hierarchy is carried by
     * the size of the display figure instead — and the emphasised card must not
     * pick up the flag on its way past.
     */
    const { container } = render(
      <KpiCardRow cards={[card({ emphasis: true })]} />,
    );
    expect(container.innerHTML).toContain("text-[34px]");
    expect(container.innerHTML).not.toContain("measure-flagged");
  });
});

describe("trendFor refuses to assert a change nobody measured", () => {
  it("returns undefined for a missing comparison, not flat", () => {
    // `flat` claims "no change" about something that was never compared.
    expect(trendFor(null)).toBeUndefined();
    expect(trendFor(undefined)).toBeUndefined();
    expect(trendFor(Number.NaN)).toBeUndefined();
  });

  it("reads a signed percentage the way the reports write it", () => {
    expect(trendFor(6.2)).toBe("up");
    expect(trendFor(-6.2)).toBe("down");
    expect(trendFor(0)).toBe("flat");
  });
});
