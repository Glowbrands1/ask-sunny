import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * ============================================================================
 * TWO PAGE-LEVEL RULES THE LIVE QA CAUGHT, AND A UNIT TEST CANNOT SEE
 * ============================================================================
 *
 * Both live in server components whose render pulls a Supabase client, a
 * period, a roster and half the read layer, so there is no honest way to
 * exercise them in jsdom. Reading the source is what `movers-section.test.ts`
 * already does next door, and for the same reason: a regression here is a
 * sentence on a screen, and nothing below the page can observe it.
 *
 * These assert STRUCTURE AND CLAIMS, not prose. Rewording is free; reinstating
 * the inaccurate claim is not.
 */

const read = (...parts: string[]) =>
  readFileSync(join(process.cwd(), "src", "app", "(app)", "reports", ...parts), "utf8");

describe("Spa Wellness says what a detail row actually is", () => {
  const source = read("spa-wellness", "page.tsx");

  /*
   * THE LIVE QA: the KPI and narrative correctly separate 61 PHYSICAL UNITS
   * from 57 SALON-AND-EQUIPMENT ROWS, and then the expanded detail said "one
   * row per installed, used unit" — which asserts the two counts are the same
   * thing and contradicts the number directly above it. A salon running two of
   * the same machine is one row.
   */
  it("no longer calls a detail row one installed unit", () => {
    expect(source).not.toContain("One row per installed, used unit");
  });

  it("names the grain as salon and equipment type", () => {
    expect(source).toContain("One row per salon and equipment type");
  });

  it("keeps explaining why the row count is lower than the unit count", () => {
    expect(source).toMatch(/two of the same machine is one row/i);
  });

  it("keeps the zero/blank rule, which is a separate fact", () => {
    // Absence is "not installed", never an installed unit sitting idle.
    expect(source).toContain("Nothing here is a zero standing in for a machine a salon does not have.");
  });
});

describe("Spa Engagement publishes no combined bed-normalized total", () => {
  const source = read("spa-engagement", "page.tsx");

  /*
   * THE LIVE QA: the table footer had been given a hard-coded "n/a" while the
   * KPI tile beside it still printed the summed figure — 0.0029 on screen, one
   * measure with two answers on one page. Both now read the same null from
   * `engagementTotals`.
   */
  it("derives the footer cell instead of asserting a literal", () => {
    expect(source).not.toMatch(/perUniquePerBed:\s*"n\/a"\s*,/);
    expect(source).toMatch(/perUniquePerBed:\s*\n?\s*totals\.spaSessionsPerUniquePerBed === null/);
  });

  it("gates the KPI tile on the same null", () => {
    const tile = source.slice(source.indexOf('id: "per-unique-per-bed"'));
    expect(tile.slice(0, 900)).toMatch(/totals\.spaSessionsPerUniquePerBed === null/);
  });

  it("never formats the combined figure without checking for null first", () => {
    /*
     * Every `formatSmallRatio(totals.…)` must sit on the far side of a null
     * check. A new surface that formats it unguarded is the exact regression
     * the QA found, on a screen that does not exist yet.
     */
    const unguarded = source
      .split("\n")
      .filter((line) => /formatSmallRatio\(totals\.spaSessionsPerUniquePerBed\)/.test(line))
      .filter((line) => !/:\s*formatSmallRatio/.test(line) || false);
    for (const line of unguarded) {
      const at = source.indexOf(line);
      const preceding = source.slice(Math.max(0, at - 260), at);
      expect(
        preceding,
        `formatSmallRatio(totals.spaSessionsPerUniquePerBed) with no null check above it: ${line.trim()}`,
      ).toContain("spaSessionsPerUniquePerBed === null");
    }
  });
});

describe("the salon detail route refuses before it reads", () => {
  const source = readFileSync(
    join(
      process.cwd(),
      "src",
      "app",
      "(app)",
      "reports",
      "salon-performance",
      "[salon]",
      "page.tsx",
    ),
    "utf8",
  );

  /*
   * The live QA confirmed this route already refused `/0307` for the Wornall
   * account. What is pinned here is the ORDER: the refusal has to come before
   * `loadReportContext`, or the refused salon's figures are fetched and then
   * thrown away — which satisfies the screen and not the boundary.
   */
  it("checks the assignment before loading any report context", () => {
    const guard = source.indexOf("if (!admitsSalonNumber(access, salonNumber))");
    const load = source.indexOf("await loadReportContext(");
    expect(guard).toBeGreaterThan(-1);
    expect(load).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(load);
  });

  it("does not let the message distinguish a missing salon from a forbidden one", () => {
    /*
     * Two different sentences would let somebody enumerate the roster by
     * watching which one comes back.
     */
    expect(source).not.toMatch(/title="No such salon"/);
    expect(source).toContain("This salon is not on your assignment");
  });
});
