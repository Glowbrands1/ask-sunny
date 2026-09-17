import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { buildMovers, type SalonRankingRow } from "@/lib/reporting/read/dashboard";

/**
 * ============================================================================
 * ONE MOVERS SECTION, AND NO EMPTY BOX UNDER IT
 * ============================================================================
 *
 * THE REVIEW: "'Largest Decreases: None' is an empty box that repeats what the
 * chart already communicates. I would collapse the final two items into one
 * section."
 *
 * Both halves are pinned, because both can regress independently and neither
 * is visible from a unit test of the data layer alone:
 *
 *   THE DATA never produces a "None" to render — `buildMovers` returns an empty
 *   list, not a list containing a placeholder — which is what makes the page's
 *   conditional possible.
 *
 *   THE PAGE renders each list only when it holds rows, inside the SAME section
 *   as the chart. A future edit that restores an `: "None"` fallback, or splits
 *   the lists back into their own section, puts the review's complaint back on
 *   the screen; reading the source is the only way to catch that without a full
 *   server-component render.
 */

const PAGE = readFileSync(
  join(process.cwd(), "src", "app", "(app)", "reports", "salon-performance", "page.tsx"),
  "utf8",
);

/**
 * The page WITHOUT its comments.
 *
 * The block comment beside this code quotes the review verbatim — "'Largest
 * Decreases: None' is an empty box" — so a search of the raw source for that
 * phrase finds the explanation of the fix and reads it as the defect. Comments
 * are stripped before any assertion about what renders.
 */
const RENDERED = PAGE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

function row(salonNumber: string, change: number | null): SalonRankingRow {
  return {
    salonNumber,
    storeName: `Invented ${salonNumber}`,
    current: 100,
    baseline: 90,
    change,
    changeSource: change === null ? "unavailable" : "reported",
    revenueRank: null,
    quintileGroup: null,
    districtLabel: null,
    regionLabel: null,
  };
}

describe("the movers data never fabricates an empty finding", () => {
  it("returns no decliners at all when every salon is up", () => {
    const movers = buildMovers([row("0101", 0.13), row("0102", 0.62), row("0103", 0.04)]);

    expect(movers.comparable).toBe(true);
    expect(movers.gainers).toHaveLength(3);
    expect(movers.decliners).toEqual([]);
  });

  it("returns no gainers at all when every salon is down", () => {
    const movers = buildMovers([row("0101", -0.13), row("0102", -0.62)]);

    expect(movers.gainers).toEqual([]);
    expect(movers.decliners).toHaveLength(2);
  });

  it("returns both when the period really holds both", () => {
    const movers = buildMovers([row("0101", 0.13), row("0102", -0.62)]);

    expect(movers.gainers).toHaveLength(1);
    expect(movers.decliners).toHaveLength(1);
  });

  it("says the comparison is unavailable rather than calling it flat", () => {
    const movers = buildMovers([row("0101", null), row("0102", null)]);

    expect(movers.comparable).toBe(false);
    expect(movers.changeSource).toBe("unavailable");
    expect(movers.gainers).toEqual([]);
    expect(movers.decliners).toEqual([]);
  });
});

describe("the page renders one movers section, with no empty half", () => {
  it("guards each list on having rows", () => {
    expect(PAGE).toContain("movers.gainers.length > 0 ?");
    expect(PAGE).toContain("movers.decliners.length > 0 ?");
  });

  it("drops the whole block when neither side has rows", () => {
    expect(PAGE).toContain("(movers.gainers.length > 0 || movers.decliners.length > 0)");
  });

  it("collapses to one column when only one side has rows", () => {
    expect(PAGE).toContain("movers.gainers.length > 0 && movers.decliners.length > 0");
    expect(PAGE).toContain('"sm:grid-cols-1"');
  });

  it("never writes a None placeholder for a decreases list", () => {
    // The literal the review saw. It must not come back in any casing.
    expect(RENDERED).not.toMatch(/Largest\s+[Dd]ecreases[^\n]*:\s*["'`]?None/);
    expect(RENDERED).not.toMatch(/decliners[^\n]{0,80}["'`]None["'`]/);
    // And the comment that explains the fix is still there to explain it.
    expect(PAGE).toContain("AN EMPTY HALF IS NOT DRAWN");
  });

  it("keeps the lists inside the chart's own section rather than a second one", () => {
    const heading = PAGE.indexOf('title="Strongest and weakest movers"');
    const decreases = PAGE.indexOf("Largest decreases");
    const nextSection = PAGE.indexOf("E. The sortable detail table");

    expect(heading).toBeGreaterThan(-1);
    expect(decreases).toBeGreaterThan(heading);
    expect(decreases).toBeLessThan(nextSection);
    // Exactly one SectionHeader between them: the movers one.
    expect(PAGE.slice(heading, decreases).match(/<SectionHeader/g)).toBeNull();
  });
});
