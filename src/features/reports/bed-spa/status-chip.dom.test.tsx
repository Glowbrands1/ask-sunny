// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { BandStatusChip } from "./status-chip";
import { PERFORMANCE_BANDS } from "@/lib/reporting/performance/classification";

/**
 * ============================================================================
 * ONE VOCABULARY, ON EVERY SURFACE
 * ============================================================================
 *
 * THE 15 SEPTEMBER PRODUCTION QA: the live Bed Usage table badged its worst
 * rows "SIGNIFICANTLY UNDER" while the filters, menus and briefings beside them
 * said "Significantly Underperforming". The chip kept a private abbreviation
 * for column width, so the page taught one vocabulary and its own controls
 * taught another.
 *
 * The rule this pins is not "that one string": it is that the chip renders the
 * BAND'S OWN approved label, whichever band it is. A future abbreviation in any
 * rung fails here.
 */
describe("the band chip speaks the approved vocabulary", () => {
  it.each(PERFORMANCE_BANDS.map((band) => [band.id, band.label] as const))(
    "renders %s as its approved label",
    (id, label) => {
      const { unmount } = render(<BandStatusChip band={id} reportable />);
      expect(screen.getByText(label)).toBeTruthy();
      unmount();
    },
  );

  it("does not abbreviate the lowest rung", () => {
    render(<BandStatusChip band="significantly_underperforming" reportable />);

    expect(screen.getByText("Significantly Underperforming")).toBeTruthy();
    expect(screen.queryByText("Significantly under")).toBeNull();
  });

  it("still keeps the two non-verdict states out of the ladder", () => {
    const capacity = render(<BandStatusChip band={null} reportable={false} advisoryOnly />);
    expect(screen.getByText("Tracked for capacity")).toBeTruthy();
    capacity.unmount();

    render(<BandStatusChip band={null} reportable />);
    expect(screen.getByText("No comparison")).toBeTruthy();
  });
});
