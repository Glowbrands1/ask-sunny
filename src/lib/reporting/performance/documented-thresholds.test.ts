import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  BED_USAGE_LADDER,
  SPA_PEER_LADDER,
  classifyVersusChain,
  classifyVersusPeers,
  isAdvisoryOnlyLevel,
  isReportableFinding,
  type PerformanceBand,
} from "./classification";

/**
 * ============================================================================
 * THE LADDERS, CHECKED AGAINST THE BUSINESS DOCUMENT THEY CAME FROM
 * ============================================================================
 *
 * `classification.test.ts` checks that the ladders behave — that a boundary
 * lands on the right side and that a null stays a null. It cannot check that
 * the NUMBERS are the approved ones, because it restates them, so an edit to
 * the module and a matching edit to the test would agree with each other and
 * with nothing else.
 *
 * This file reads `docs/bed-usage-spa-metrics.md` — the business documentation
 * supplied on 2026-09-14, committed verbatim — parses its two threshold tables,
 * and classifies against what they say. Changing a threshold in the code now
 * fails here unless the approved document changed too, which is the only
 * version of "these match the business rules" that is worth anything.
 *
 * THE TABLES ARE WRITTEN AS OVERLAPPING RANGES and the module resolves that
 * into an ordered ladder. `boundaries` below reads each row's LOWER edge and
 * the assertions then probe either side of it, so the parser makes no judgement
 * the document does not support.
 *
 * AND THE RANGES ARE NOT WRITTEN IN A CONSISTENT DIRECTION, which is worth
 * saying because it broke the first version of this parser. `At Market` reads
 * "-5% to +10%", low to high; the very next row reads "-5% to -15%", high to
 * low. Taking the first number in the cell yields -5 as the floor of Below
 * Market, which is its CEILING. So the lower edge is the minimum of whatever
 * numbers the cell holds, and the `≤ -N%` row is skipped: it states an upper
 * edge, and the row above it already fixes that boundary.
 */

const DOC = readFileSync(
  path.join(process.cwd(), "docs", "bed-usage-spa-metrics.md"),
  "utf8",
);

/** The lower edge of each classification row, from one markdown table. */
function boundaries(headerCell: string): Record<string, number> {
  const start = DOC.indexOf(`| ${headerCell} |`);
  expect(start, `the "${headerCell}" table is missing from the document`).toBeGreaterThan(-1);

  const rows = DOC.slice(start)
    .split("\n")
    .slice(2) // past the header row and its `|---|---|` rule
    .filter((line) => line.trim().startsWith("|"));

  const out: Record<string, number> = {};
  for (const line of rows) {
    const cells = line.split("|").map((cell) => cell.trim());
    const [, range, classification] = cells;
    if (!range || !classification) break;

    // `≤ -8%` bounds its row from ABOVE and is fixed by the row before it.
    if (range.startsWith("≤")) continue;

    const numbers = [...range.matchAll(/([+-]?[\d.]+)%/g)].map((match) => Number(match[1]));
    if (numbers.length === 0) break;
    out[classification] = Math.min(...numbers);
  }
  return out;
}

/** Nudge below a floor by less than any figure these reports carry. */
const EPSILON = 0.000001;

function expectLadder(
  table: Record<string, number>,
  classify: (percent: number | null) => PerformanceBand | null,
) {
  const outperforming = table["Outperforming Peers"];
  const atMarket = table["At Market"];
  const belowMarket = table["Below Market"];

  expect(outperforming).toBeTypeOf("number");
  expect(atMarket).toBeTypeOf("number");
  expect(belowMarket).toBeTypeOf("number");

  // The document's own `≥` row: the floor itself is Outperforming.
  expect(classify(outperforming)).toBe("outperforming");
  expect(classify(outperforming - EPSILON)).toBe("at_market");

  expect(classify(atMarket)).toBe("at_market");
  expect(classify(atMarket - EPSILON)).toBe("below_market");

  // The final row is written `≤ -N%`, so the boundary is the worse band.
  expect(classify(belowMarket)).toBe("significantly_underperforming");
  expect(classify(belowMarket + EPSILON)).toBe("below_market");
}

describe("the approved thresholds in docs/bed-usage-spa-metrics.md", () => {
  it("classifies bed usage exactly as the `v Chain` table states", () => {
    const table = boundaries("Performance vs Chain");

    expect(table).toEqual({
      "Outperforming Peers": 2,
      "At Market": -2,
      "Below Market": -8,
    });
    expectLadder(table, classifyVersusChain);
  });

  it("classifies spa equipment exactly as the peer-average table states", () => {
    const table = boundaries("Performance vs Peer Average");

    expect(table).toEqual({
      "Outperforming Peers": 10,
      "At Market": -5,
      "Below Market": -15,
    });
    expectLadder(table, classifyVersusPeers);
  });

  it("keeps the two ladders distinct, as the document does", () => {
    /*
     * The single most likely regression is somebody "simplifying" the two
     * tables into one. -8% is Below Market for spa equipment and Significantly
     * Underperforming for a bed, and the document says so in two places.
     */
    expect(BED_USAGE_LADDER).not.toEqual(SPA_PEER_LADDER);
    expect(classifyVersusPeers(-8)).toBe("below_market");
    expect(classifyVersusChain(-8)).toBe("significantly_underperforming");
  });

  it("holds the FAST rule the document states", () => {
    /*
     * "FAST removals are intentional and are not treated as a negative KPI."
     * The figure is still computed — hiding it would be its own distortion —
     * but it may not be raised as a performance failure.
     */
    expect(DOC).toContain("FAST removals are intentional");
    expect(isAdvisoryOnlyLevel("FAST")).toBe(true);
    expect(isReportableFinding("FAST", "below_market")).toBe(false);
    expect(isReportableFinding("FAST", "significantly_underperforming")).toBe(false);
    // Good news is not suppressed; the rule exists to stop a deliberate
    // removal reading as failure, not to hide a FAST level that is winning.
    expect(isReportableFinding("FAST", "outperforming")).toBe(true);
    // And it is a bed usage rule only. Nothing in the spa report is advisory.
    expect(isAdvisoryOnlyLevel("SPA")).toBe(false);
  });

  it("holds the presence rule the document states", () => {
    expect(DOC).toContain("Zero usage means the equipment is NOT installed");
  });

  it("holds the Spa Conversion Rate definition the document states", () => {
    expect(DOC).toContain("Spa Conversion Rate = Monthly Spa Sessions ÷ Monthly Total Tans");
  });
});
