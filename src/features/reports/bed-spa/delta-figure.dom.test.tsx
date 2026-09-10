// @vitest-environment jsdom
import * as React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { DeltaFigure } from "./delta-figure";
import { isBehindBenchmark } from "@/lib/reporting/performance/classification";

/**
 * WHO GETS THE CORAL, AND — MORE IMPORTANTLY — WHO MUST NOT.
 *
 * The flag says "somebody has to look at this". That makes a false positive
 * expensive in a specific way: it does not merely look wrong, it sends a
 * district manager after a number that is behaving exactly as intended.
 *
 * The FAST case is the real one. FAST beds are being removed on purpose, so a
 * FAST level running 28% under the chain average is the intended consequence of
 * a decision already taken. It is shown as a figure and never raised as a
 * finding — the badge column has always honoured that, and the point of these
 * tests is that the coral now honours it too.
 *
 * These three reports cannot render without Supabase, so this is where the rule
 * is checkable at all.
 */

afterEach(cleanup);

describe("the flag is spent on measures that are actually behind", () => {
  it("colours a shortfall", () => {
    const { container } = render(
      <DeltaFigure delta={-10.6} band="below_market" />,
    );
    expect(screen.getByText("-10.6%")).toBeTruthy();
    expect(container.innerHTML).toContain("measure-flagged-foreground");
  });

  it("leaves at-market and outperforming rows neutral", () => {
    // Green is out of the system, so a rise is not coloured either.
    for (const band of ["at_market", "outperforming"] as const) {
      const { container } = render(<DeltaFigure delta={1.2} band={band} />);
      expect(container.innerHTML, band).not.toContain("measure-flagged-foreground");
      cleanup();
    }
  });

  it("leaves a row with no comparison alone", () => {
    /*
     * The absence of a benchmark is not a bad benchmark. An unclassified row
     * still shows `N/A` and its reason, and colouring it would invent a finding
     * out of a gap in the source.
     */
    const { container } = render(
      <DeltaFigure delta={null} band={null} reason="The chain published no benchmark" />,
    );
    expect(screen.getByText("N/A")).toBeTruthy();
    expect(container.innerHTML).not.toContain("measure-flagged-foreground");
    expect(screen.getByTitle("The chain published no benchmark")).toBeTruthy();
  });

  it("refuses the flag on a shortfall that must not be raised as a finding", () => {
    /*
     * THE FAST EXEMPTION. Same band, same magnitude, same colour rule — and
     * `reportable: false` is the whole difference, because the removal was
     * intentional. Both cases asserted together so a later edit cannot satisfy
     * one and quietly drop the other.
     */
    const { container: raised } = render(
      <DeltaFigure delta={-28.5} band="significantly_underperforming" />,
    );
    expect(raised.innerHTML).toContain("measure-flagged-foreground");
    cleanup();

    const { container: exempt } = render(
      <DeltaFigure delta={-28.5} band="significantly_underperforming" reportable={false} />,
    );
    expect(screen.getByText("-28.5%"), "the figure is still shown").toBeTruthy();
    expect(
      exempt.innerHTML,
      "an intentional reduction is not a finding",
    ).not.toContain("measure-flagged-foreground");
  });

  it("says it in words as well as in colour", () => {
    // The sign is in the text, so the meaning survives greyscale and print.
    render(<DeltaFigure delta={-4.4} band="below_market" />);
    expect(screen.getByText("-4.4%").textContent).toContain("-");
  });
});

describe("isBehindBenchmark reads the band's own tone", () => {
  it("agrees with the four approved bands", () => {
    expect(isBehindBenchmark("outperforming")).toBe(false);
    expect(isBehindBenchmark("at_market")).toBe(false);
    expect(isBehindBenchmark("below_market")).toBe(true);
    expect(isBehindBenchmark("significantly_underperforming")).toBe(true);
  });

  it("treats an absent classification as not behind", () => {
    expect(isBehindBenchmark(null)).toBe(false);
    expect(isBehindBenchmark(undefined)).toBe(false);
  });
});
