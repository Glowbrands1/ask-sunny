import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import { emptyCombinedColumns, COMBINED_COLUMN_PRESENCE } from "./combined";
import type { CombinedSalonRow } from "./combined";
import { rankAxis, clampRank } from "./rank";

/**
 * ============================================================================
 * THE FIVE SPA ENGAGEMENT FINDINGS, RE-VERIFIED IN THE PATH THAT RENDERS THEM
 * ============================================================================
 *
 * Each of these was fixed once. Three of the five were fixed IN THE PAGE, where
 * nothing could assert them — a column rule written inline, two headings, and a
 * footer cell. A page-level fix with no test is a fix that survives until the
 * next person tidies the file.
 *
 * So the column rule moved into the read layer and is proven here, and the two
 * that are irreducibly presentational — the headings and the footer — are
 * pinned by reading the page source. A source scan is a weak test and it is
 * much stronger than nothing: it fails if somebody restores the wording the
 * review objected to.
 *
 *   1. All fifteen salons marked SIGNIFICANTLY UNDER
 *      -> `equipmentRowPerformance`, covered by spa-row-classification.test.ts
 *   2. Three columns entirely N/A                        -> here
 *   3. "Weakest Installed Unit" showing bed counts       -> here
 *   4. Totals row 0.0029 against salon values 0.02-0.11  -> here
 *   5. Rank axis running #249 ... #-11                   -> here and rank.test.ts
 */

const PAGE = readFileSync(
  path.join(process.cwd(), "src", "app", "(app)", "reports", "spa-engagement", "page.tsx"),
  "utf8",
);

function row(overrides: Partial<CombinedSalonRow> = {}): CombinedSalonRow {
  return {
    salonNumber: "0306",
    storeName: "MO Kansas City Wornall",
    districtLabel: null,
    regionLabel: null,
    totalTans: null,
    bedCount: null,
    perBedUsage: null,
    spaSessions: null,
    spaBeds: null,
    spaEquipmentPieces: null,
    conversion: { available: false, reason: "period_mismatch", reasonText: "" },
    spaPerUniquePercent: null,
    uniqueSpaTannerPercent: null,
    peerPerformance: null,
    status: "insufficient_data",
    sources: { bedUsage: false, spaWellness: false, spaEngagement: false },
    ...overrides,
  } as unknown as CombinedSalonRow;
}

describe("finding 2 — a column that is entirely N/A is dropped", () => {
  it("drops every column with nothing in it", () => {
    const empty = emptyCombinedColumns([row(), row()]);

    for (const column of COMBINED_COLUMN_PRESENCE) {
      expect(empty, `${column.key} should be dropped`).toContain(column.key);
    }
  });

  it("KEEPS a column that one salon has a figure in", () => {
    /*
     * The case that matters, and the reason this is measured rather than driven
     * by a flag. Fourteen N/As beside one real figure is a report; a dropped
     * column that had a figure in it is a lie.
     */
    const empty = emptyCombinedColumns([row(), row({ spaPerUniquePercent: 0.33 })]);

    expect(empty).not.toContain("perUnique");
    expect(empty).toContain("uniquePct");
  });

  it("drops nothing from an empty table, so the headers survive", () => {
    // With no rows every column is vacuously empty and the whole table would
    // vanish, taking its headings with it.
    expect(emptyCombinedColumns([])).toEqual(new Set());
  });

  it("names the dropped columns once instead of leaving the reader to count", () => {
    expect(PAGE).toMatch(/emptyColumns\.size > 0/);
    expect(PAGE).toMatch(/column is|columns are/);
  });
});

describe("finding 3 — two adjacent columns that read as one", () => {
  it("names the count and the band separately, and says which is which", () => {
    /*
     * THE REVIEW: "'Spa Equipment Peer Performance / Weakest Installed Unit'
     * shows bed counts." Two columns, one a count of units and one a
     * performance band, under a heading that read as a single measure.
     */
    expect(PAGE).toMatch(/label: "Spa Units Installed",\s*\n\s*hint: "Count",/);
    expect(PAGE).toMatch(
      /label: "Weakest Unit vs Peers",\s*\n\s*hint: "Band, not a count",/,
    );

    /*
     * The heading the review objected to survives ONLY inside the comment that
     * quotes the review. A `not.toContain` would fail on that quotation, and
     * deleting the quotation to make a test pass would remove the record of why
     * the column is named the way it is — so the assertion is that it is not a
     * LABEL, which is what a reader sees.
     */
    expect(PAGE).not.toMatch(/label: ".*Weakest Installed Unit/);
  });
});

describe("finding 4 — the bed-normalized total", () => {
  /*
   * Recomputing this rate from the sums divides by ~60 beds rather than ~4,
   * producing the 0.0029 the review saw beside salon values of 0.02-0.11 —
   * which reads as a benchmark the salons are all failing.
   *
   * NO REPLACEMENT IS INVENTED. The source's own "All Summary" cell is blank
   * and no approved definition says what a combined bed-normalized rate should
   * be, so the page says it does not apply and points at the salon rows.
   *
   * THIS USED TO ASSERT THE LITERAL `perUniquePerBed: "n/a"`, and the live QA
   * of 15 September showed why that was not enough: the footer carried the
   * hard-coded string while the KPI tile beside it went on printing the summed
   * figure. One measure, one page, two answers — and a test that could not see
   * it because it was watching one cell. The decision now lives in
   * `engagementTotals`, and these assert that both surfaces read it.
   */
  it("shows no combined figure on the footer", () => {
    expect(PAGE).not.toMatch(/perUniquePerBed: "n\/a"/);
    expect(PAGE).toMatch(
      /perUniquePerBed:\s*\n?\s*totals\.spaSessionsPerUniquePerBed === null/,
    );
  });

  it("shows no combined figure on the KPI tile either", () => {
    const tile = PAGE.slice(PAGE.indexOf('id: "per-unique-per-bed"'));
    expect(tile.slice(0, 900)).toMatch(/totals\.spaSessionsPerUniquePerBed === null/);
  });

  it("decides it once, in the analytics rather than per screen", async () => {
    const { engagementTotals } = await import("./spa-engagement-analytics");
    const salon = (spaSessions: number, uniques: number, beds: number) => ({
      salonNumber: null,
      storeName: "Invented",
      districtLabel: null,
      regionLabel: null,
      ownership: null,
      spaSessions,
      totalUniqueTanners: uniques,
      uniqueSpaTanners: 0,
      spaBeds: beds,
      spaPerUniquePercent: null,
      uniqueSpaTannerPercent: null,
      spaSessionsPerBed: null,
      spaSessionsPerUniquePerBed: null,
      overallRank: null,
      ranks: {},
    });

    // Two salons: no approved combined total.
    expect(
      engagementTotals([salon(33, 74, 4), salon(21, 155, 6)] as never)
        .spaSessionsPerUniquePerBed,
    ).toBeNull();
    // One salon: its own figure, which the workbook does publish.
    expect(
      engagementTotals([salon(33, 74, 4)] as never).spaSessionsPerUniquePerBed,
    ).toBeCloseTo(33 / 74 / 4, 12);
  });
});

describe("finding 5 — the rank axis", () => {
  it("cannot produce a tick below rank 1 or above the population", () => {
    /*
     * The reported sequence was #249, #184, #119, #54, #-11 for a population of
     * 248: no domain was set, the library chose 0..260, and the formatter
     * turned those ticks back into ranks.
     */
    const axis = rankAxis(248);

    expect(axis.domain[0]).toBe(1);
    expect(axis.domain[1]).toBe(248);
    for (const tick of axis.ticks) {
      expect(tick).toBeGreaterThanOrEqual(1);
      expect(tick).toBeLessThanOrEqual(248);
      expect(Number.isInteger(tick)).toBe(true);
    }
  });

  it("clamps anything that still reaches the formatter", () => {
    // The last guard. Even handed the out-of-range values the defect produced,
    // no label can read as a rank that cannot exist.
    expect(clampRank(-11, 248)).toBeGreaterThanOrEqual(1);
    expect(clampRank(249, 248)).toBeLessThanOrEqual(248);
  });

  it("binds the chart's axis to it rather than letting the library choose", () => {
    const chart = readFileSync(
      path.join(process.cwd(), "src", "features", "reports", "bed-spa", "ranked-bar-chart.tsx"),
      "utf8",
    );

    expect(chart).toMatch(/rankAxis\(/);
    expect(chart).toMatch(/domain=\{\[\.\.\.rankBounds\.domain\]\}/);
    expect(chart).toMatch(/ticks=\{\[\.\.\.rankBounds\.ticks\]\}/);
  });
});
