// @vitest-environment jsdom
import * as React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { ReportBand } from "@/components/ui/marquee";
import { ReportProvenance } from "./salon-performance/scope-banner";
import type { ReportScope } from "@/lib/reporting/read";

/**
 * THE BAND, AND THE FOUR FACTS RANGED ALONG IT.
 *
 * The reporting band is the artifact's page header, and its provenance chips
 * only appear once a report has actually been read — which needs Supabase, so
 * they cannot be seen in a browser during local work. That is the same reason
 * the KPI row and the tables are covered here.
 *
 * WHAT THESE ASSERTIONS PROTECT is the copy, not the colour. The artifact is
 * explicit that these lines are the best writing in the product and that none
 * of them get shortened — "recipient slice — not company-wide" is the clause
 * that stops a district total being read as the chain's, and it would be the
 * first casualty of anyone trimming chips to fit a narrow band.
 *
 * The title split is asserted because it is load-bearing in a way that looks
 * decorative: the trailing word carries the brand yellow, and that one detail
 * is what stops a large near-black rectangle reading as chrome.
 */

const scope = {
  salonCount: 15,
  periodLabel: "YTD 08 2026",
  periodEnd: "2026-08-30",
  grain: "ytd",
} as unknown as ReportScope;

afterEach(cleanup);

describe("the report band", () => {
  it("colours the trailing word of the title and leaves the rest alone", () => {
    const { container } = render(<ReportBand title="Salon Performance" />);
    const heading = container.querySelector("h1") as HTMLElement;

    expect(heading.textContent).toBe("Salon Performance");
    const accent = heading.querySelector("span") as HTMLElement;
    expect(accent.textContent?.trim()).toBe("Performance");
    expect(accent.className).toContain("text-brand-yellow");
  });

  it("leaves a single-word title plain rather than turning it all yellow", () => {
    const { container } = render(<ReportBand title="Videos" />);
    const heading = container.querySelector("h1") as HTMLElement;
    expect(heading.textContent).toBe("Videos");
    expect(heading.querySelector("span")).toBeNull();
  });

  it("honours an explicit accent over the trailing word", () => {
    const { container } = render(
      <ReportBand title="Google Reviews" accent="Google Reviews" />,
    );
    const accent = container.querySelector("h1 span") as HTMLElement;
    expect(accent.textContent?.trim()).toBe("Google Reviews");
  });

  it("carries the four provenance facts, none of them shortened", () => {
    render(
      <ReportBand
        title="Salon Performance"
        chips={<ReportProvenance scope={scope} ingestedLabel="Sep 3, 1:58 PM UTC" />}
      />,
    );

    // The period governs the other three, so it reads first and in brand.
    expect(screen.getByText("YTD 08 2026")).toBeTruthy();
    expect(screen.getByText(/15 salons in this report/)).toBeTruthy();
    // THE CLAUSE THAT MUST NEVER BE TRIMMED.
    expect(screen.getByText("Recipient slice — not company-wide")).toBeTruthy();
    expect(screen.getByText(/Loaded Sep 3, 1:58 PM UTC/)).toBeTruthy();
  });

  it("says one salon, not 1 salons", () => {
    render(
      <ReportBand
        title="Salon Performance"
        chips={
          <ReportProvenance
            scope={{ ...scope, salonCount: 1 } as ReportScope}
            ingestedLabel="Sep 3"
          />
        }
      />,
    );
    expect(screen.getByText(/1 salon in this report/)).toBeTruthy();
  });

  it("closes the band with the brand-yellow edge", () => {
    /*
     * The 4px edge is what joins the band to the tab strip beneath it. Without
     * it the two read as a dark block and an unrelated row of links.
     */
    const { container } = render(<ReportBand title="Salon Performance" />);
    const band = container.firstElementChild as HTMLElement;
    expect(band.className).toContain("border-b-4");
    expect(band.className).toContain("border-brand-yellow");
    expect(band.className).toContain("bg-band");
  });
});
