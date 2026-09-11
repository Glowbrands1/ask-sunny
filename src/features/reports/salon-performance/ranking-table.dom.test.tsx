// @vitest-environment jsdom
import * as React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { RankingTable } from "./ranking-table";
import type { SalonRankingRow } from "@/lib/reporting/read/dashboard";

/**
 * THE RANKING TABLE SURVIVED A RESTYLE, AND THIS IS WHAT THAT HAD TO MEAN.
 *
 * The table moved onto the shared `.data-table` treatment and its quintile
 * cell onto the shared chip. Same reasoning as the KPI row's tests: the visual
 * change is not what these assertions are for — the risk was that something
 * load-bearing got flattened away while it looked like a tidy-up.
 *
 * What is load-bearing here:
 *
 *   · The source-reported rank and quintile, which are chain-wide facts and
 *     must not start looking like facts about the rows on screen.
 *   · "Unavailable" rather than a printed zero, because a zero reads as a
 *     collapse rather than as a gap.
 *   · The colour rule: only a measure actually BEHIND takes coral. Green is
 *     out of this system, so a rise is neutral — and so is a fall on a measure
 *     whose direction the business has not defined.
 *   · The table's own horizontal scroll container. Without it the min-width
 *     escapes the page and a phone scrolls sideways.
 *
 * This page needs Supabase to render, so it cannot be checked in a browser
 * during local work — which is exactly why it is checked here.
 */

function row(overrides: Partial<SalonRankingRow> = {}): SalonRankingRow {
  return {
    salonNumber: "0468",
    storeName: "MO Kansas City Liberty",
    current: 1_163_402.18,
    baseline: 1_072_118.4,
    change: 8.51,
    changeSource: "reported",
    revenueRank: 2,
    quintileGroup: "Top 20%",
    districtLabel: "District 4 — Mid-South",
    regionLabel: "Central",
    ...overrides,
  } as SalonRankingRow;
}

function renderTable(
  rows: SalonRankingRow[],
  props: Partial<React.ComponentProps<typeof RankingTable>> = {},
) {
  return render(
    <RankingTable
      rows={rows}
      unit="currency"
      metricLabel="Total revenue"
      currentLabel="2026"
      baselineLabel="2025"
      sort="value"
      direction="desc"
      sortHref={() => "#"}
      {...props}
    />,
  );
}

afterEach(cleanup);

describe("the ranking table keeps what the source actually reported", () => {
  it("shows the salon, both sides of the comparison, the rank and the quintile", () => {
    renderTable([row()]);

    expect(screen.getByText("MO Kansas City Liberty")).toBeTruthy();
    expect(screen.getByText("0468")).toBeTruthy();
    expect(screen.getByText("#2")).toBeTruthy();
    expect(screen.getByText("Top 20%")).toBeTruthy();
  });

  it("says the rank and quintile are the source's, not this report's", () => {
    /*
     * The caption and the column note are the only places a reader is told
     * that these two are chain-wide. Restyling the head must not drop them.
     */
    const { container } = renderTable([row()]);
    expect(container.textContent).toContain("as reported by the source");
    expect(container.querySelector("caption")?.textContent).toContain(
      "as reported by the source against the whole chain",
    );
  });

  it("says Unavailable rather than printing a zero", () => {
    renderTable([row({ current: null, baseline: null, change: null })]);
    expect(screen.getAllByText("Unavailable").length).toBeGreaterThan(0);
    expect(screen.queryByText("$0.00")).toBeNull();
  });

  it("colours the change only when the measure is actually behind", () => {
    const { container: rising } = renderTable([row({ change: 4.1 })], {
      higherIsBetter: true,
    });
    expect(rising.innerHTML).not.toContain("measure-flagged-foreground");
    cleanup();

    const { container: falling } = renderTable([row({ change: -4.1 })], {
      higherIsBetter: true,
    });
    expect(falling.innerHTML).toContain("measure-flagged-foreground");
    cleanup();

    /*
     * DIRECTION UNKNOWN MEANS NO JUDGEMENT. A fall on a measure whose
     * `higher_is_better` the business has not defined is not "behind", so it
     * gets no colour at all.
     */
    const { container: undefinedDirection } = renderTable([row({ change: -4.1 })], {
      higherIsBetter: null,
    });
    expect(undefinedDirection.innerHTML).not.toContain("measure-flagged-foreground");
  });

  it("puts the wide table in its own scroll container", () => {
    /*
     * Both halves matter. `overflow-x-auto` is what confines the min-width to
     * the table, and `relative` is what stops the screen-reader-only spans
     * inside it — 1px absolute boxes positioned deep into the scrollable
     * width — resolving against an ancestor further up, escaping the clip and
     * growing the document's own scroll width. Measured at a 390px viewport:
     * 530px of page scroll without it, 390px with it.
     */
    const { container } = renderTable([row()]);
    const table = container.querySelector("table");
    const scroller = table?.parentElement as HTMLElement;

    expect(scroller.className).toContain("overflow-x-auto");
    expect(scroller.className).toContain("relative");
    expect(scroller.className).toContain("min-w-0");
  });

  it("reads an unrecognised quintile label as neutral rather than guessing", () => {
    /*
     * The source's vocabulary is not this app's to predict. A label it does
     * not know falls through to the quiet chip instead of being scored.
     */
    const { container } = renderTable([row({ quintileGroup: "Middle third" })]);
    expect(screen.getByText("Middle third")).toBeTruthy();
    expect(container.innerHTML).not.toContain("measure-flagged");
  });
});
