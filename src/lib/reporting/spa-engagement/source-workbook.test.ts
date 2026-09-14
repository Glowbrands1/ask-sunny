import { existsSync, readFileSync } from "node:fs";

import { beforeAll, describe, expect, it } from "vitest";

import { AUTHORIZED_COMPANY } from "../store-identity";
import { readWorkbook } from "../workbook";
import { SPA_ENGAGEMENT_RANK_METRICS, rankAscending, rankDescending } from "./metric-map";
import { parseSpaEngagement, type ParsedSpaEngagementReport } from "./parser";

/**
 * ============================================================================
 * THE SHIPPED PARSER, AGAINST THE REAL SOURCE WORKBOOK
 * ============================================================================
 *
 * `parser.test.ts` runs on a SYNTHETIC workbook, because the real one carries a
 * 252-row staff roster with addresses, phone numbers and e-mail addresses and
 * cannot be committed. That fixture reproduces the structure faithfully, but it
 * is built by the same understanding it is meant to check: it cannot tell us
 * that the understanding matches the file the business actually sends.
 *
 * This suite closes that gap when the real file is present. Point it at one
 * with:
 *
 *     ASK_SUNNY_SPA_ENGAGEMENT_WORKBOOK=/path/to/workbook.xlsx npm test
 *
 * and it SKIPS, loudly but harmlessly, when no file is configured — so CI,
 * which has no such file, stays green while a developer holding a delivery can
 * prove the parser reproduces it.
 *
 * WHAT IT PINS, all of it read from the file rather than asserted a priori:
 *
 *   * The WEIGHTS, which the parser reads off row 9 and never assumes.
 *   * The RANKING POPULATION, which is the whole chain and not this company.
 *   * Every published Rank and Overall Rank, salon rows and DM rows alike.
 *   * That `RANK.EQ` is what reproduces them and a sort position is not.
 *
 * NOTE ON LAZINESS. `describe.skip` still EXECUTES its callback, so nothing
 * here may touch the filesystem at module scope or a missing file would fail
 * the suite it is supposed to skip. The read happens in `beforeAll`.
 */

const WORKBOOK_PATH = process.env.ASK_SUNNY_SPA_ENGAGEMENT_WORKBOOK ?? "";
const HAVE_WORKBOOK = WORKBOOK_PATH.length > 0 && existsSync(WORKBOOK_PATH);

const suite = HAVE_WORKBOOK ? describe : describe.skip;

suite("the spa engagement source workbook", () => {
  let report: ParsedSpaEngagementReport;

  beforeAll(async () => {
    report = parseSpaEngagement(await readWorkbook(new Uint8Array(readFileSync(WORKBOOK_PATH))));
  });

  it("reads the weights off the sheet rather than assuming thirds", () => {
    expect(report.rankWeights).toEqual({
      rank_spa_sessions_per_bed: 0.25,
      rank_spa_sessions_per_unique_per_bed: 0.25,
      rank_unique_spa_tanner_pct: 0.5,
    });
  });

  it("ranks over the whole chain, not over this company", () => {
    expect(report.rankPopulation).toBe(report.diagnostics.sourceSalonCount);
    expect(report.rankPopulation).toBeGreaterThan(report.salons.length);
    expect(report.company).toBe(AUTHORIZED_COMPANY);
  });

  it("keeps only this company's salons, each carrying its chain-wide rank", () => {
    for (const salon of report.salons) {
      expect(salon.company).toBe(AUTHORIZED_COMPANY);
      expect(salon.reportedOverallRank).not.toBeNull();
      expect(salon.reportedOverallRank!).toBeGreaterThanOrEqual(1);
      expect(salon.reportedOverallRank!).toBeLessThanOrEqual(report.rankPopulation);
    }
    expect(report.diagnostics.unrosteredSalons).toEqual([]);
  });

  it("reproduces every published component Rank", () => {
    const mismatches = report.salons.flatMap((salon) =>
      SPA_ENGAGEMENT_RANK_METRICS.filter(
        (metric) => salon.computedRanks[metric.code] !== salon.reportedRanks[metric.code],
      ).map((metric) => `${salon.storeName} ${metric.code}`),
    );
    expect(mismatches).toEqual([]);
  });

  it("reproduces every published Overall Rank", () => {
    const mismatches = report.salons
      .filter((salon) => salon.computedOverallRank !== salon.reportedOverallRank)
      .map((salon) => `${salon.storeName}: ${salon.reportedOverallRank} vs ${salon.computedOverallRank}`);
    expect(mismatches).toEqual([]);
  });

  it("reproduces the district managers' Overall Rank on their own sheet", () => {
    expect(report.managers.length).toBeGreaterThan(0);
    const mismatches = report.managers
      .filter((manager) => manager.computedOverallRank !== manager.reportedOverallRank)
      .map((m) => `${m.districtLabel}: ${m.reportedOverallRank} vs ${m.computedOverallRank}`);
    expect(mismatches).toEqual([]);
  });

  it("computes the weighted score as weight x rank, lower being better", () => {
    for (const salon of report.salons) {
      const expected = SPA_ENGAGEMENT_RANK_METRICS.reduce((total, metric) => {
        const rank = salon.computedRanks[metric.code];
        return rank === null ? total : total + report.rankWeights[metric.code] * rank;
      }, 0);
      expect(salon.computedWeightedScore).toBeCloseTo(expected, 10);
    }
    // Lower score, better rank — the relationship the "lower is better" note claims.
    const ordered = [...report.salons]
      .filter((salon) => salon.computedWeightedScore !== null)
      .sort((a, b) => a.computedWeightedScore! - b.computedWeightedScore!);
    for (let i = 1; i < ordered.length; i += 1) {
      expect(ordered[i].computedOverallRank!).toBeGreaterThanOrEqual(ordered[i - 1].computedOverallRank!);
    }
  });

  /**
   * The claim `metric-map.ts` makes about ties — that `RANK.EQ` reproduces the
   * sheet and a sort position does not — tested on the file itself rather than
   * on a fixture engineered to contain a tie.
   */
  it("needs RANK.EQ rather than a sort position to reproduce the sheet", async () => {
    const workbook = await readWorkbook(new Uint8Array(readFileSync(WORKBOOK_PATH)));
    const sheet = workbook.sheet("All Summary");
    if (!sheet) throw new Error("All Summary is missing");

    // J/K, L/M, N/O: each measure with the Rank column immediately right of it.
    const pairs = [
      { value: 10, rank: 11 },
      { value: 12, rank: 13 },
      { value: 14, rank: 15 },
    ];
    let sawTie = false;

    for (const pair of pairs) {
      const rows: { value: number; published: number }[] = [];
      for (let row = 11; row <= sheet.rowCount; row += 1) {
        const value = sheet.cell(row, pair.value).number;
        const published = sheet.cell(row, pair.rank).number;
        if (value === null || published === null) continue;
        rows.push({ value, published });
      }
      expect(rows.length).toBeGreaterThan(0);

      const values = rows.map((entry) => entry.value);
      for (const entry of rows) {
        expect(rankDescending(values, entry.value)).toBe(entry.published);
      }

      // A SORT POSITION, which is the plausible wrong implementation: each row
      // takes its own place in the descending order, so tied rows get 1 and 2
      // where the sheet gives 1 and 1.
      const positions = new Map<{ value: number; published: number }, number>();
      [...rows]
        .sort((a, b) => b.value - a.value)
        .forEach((entry, index) => positions.set(entry, index + 1));

      const tied = new Set<number>();
      const seen = new Set<number>();
      for (const entry of rows) {
        if (seen.has(entry.value)) tied.add(entry.value);
        seen.add(entry.value);
      }

      if (tied.size > 0) {
        sawTie = true;
        expect(rows.some((entry) => positions.get(entry) !== entry.published)).toBe(true);
      }
    }

    expect(sawTie).toBe(true);
  });

  /**
   * The column right of Overall Rank carries numbers of a similar magnitude and
   * is unlabelled. It is NOT the ranking basis, and a reader who assumed it was
   * would publish a different order — so the file itself says so here.
   */
  it("does not rank on the unlabelled column beside Overall Rank", async () => {
    const workbook = await readWorkbook(new Uint8Array(readFileSync(WORKBOOK_PATH)));
    const sheet = workbook.sheet("All Summary");
    if (!sheet) throw new Error("All Summary is missing");

    expect(sheet.cell(10, 16).text).toBe("Overall Rank");
    expect(sheet.cell(10, 17).text).toBe("");

    const rows: { extra: number; overall: number }[] = [];
    for (let row = 11; row <= sheet.rowCount; row += 1) {
      const extra = sheet.cell(row, 17).number;
      const overall = sheet.cell(row, 16).number;
      if (extra === null || overall === null) continue;
      rows.push({ extra, overall });
    }
    expect(rows.length).toBeGreaterThan(0);

    const extras = rows.map((entry) => entry.extra);
    expect(rows.every((entry) => rankAscending(extras, entry.extra) === entry.overall)).toBe(false);
  });
});
