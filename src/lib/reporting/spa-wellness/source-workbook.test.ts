import { existsSync, readFileSync } from "node:fs";

import { beforeAll, describe, expect, it } from "vitest";

import { PRODUCTION_SALONS } from "@/data/salons";

import { AUTHORIZED_COMPANY } from "../store-identity";
import { columnIndex, readWorkbook, type WorkbookView } from "../workbook";
import { parseSpaWellness, type ParsedSpaWellnessReport } from "./parser";

/**
 * ============================================================================
 * THE SHIPPED PARSER, AGAINST THE REAL SPA WELLNESS TRACKING WORKBOOK
 * ============================================================================
 *
 * Same arrangement as `spa-engagement/source-workbook.test.ts`, and for the
 * same reason: the committed fixture is synthetic because the real delivery
 * carries 248 salons of another company's figures, so it proves the parser is
 * self-consistent rather than that it matches what the business sends. Point
 * this at a real delivery with:
 *
 *     ASK_SUNNY_SPA_WELLNESS_WORKBOOK=/path/to/workbook.xlsx npm test
 *
 * and it skips when no file is configured.
 *
 * WHAT IT PINS. Mostly one rule, from three directions, because the rule is the
 * one the business documentation states outright and the one an earlier reading
 * of this report got wrong:
 *
 *     ZERO USAGE MEANS THE EQUIPMENT IS NOT INSTALLED.
 *
 * The source does not merely make a zero ambiguous — IT NEVER WRITES ONE. Every
 * equipment cell is either a positive session count or blank, so an installed-
 * but-idle unit cannot be expressed in this file at all, and a reading that
 * described four such units was describing something the source cannot say.
 * The `Filtered Average` the sheet publishes is taken over the salons that have
 * the equipment, which is the same rule applied to the denominator, and the
 * parser's `chainAverageSessions` is checked against that published row.
 */

const WORKBOOK_PATH = process.env.ASK_SUNNY_SPA_WELLNESS_WORKBOOK ?? "";
const HAVE_WORKBOOK = WORKBOOK_PATH.length > 0 && existsSync(WORKBOOK_PATH);

const suite = HAVE_WORKBOOK ? describe : describe.skip;

/** The `Filtered Average` row of a window sheet, read straight off the file. */
const FILTERED_AVERAGE_ROW = 5;

suite("the spa wellness tracking source workbook", () => {
  let workbook: WorkbookView;
  let report: ParsedSpaWellnessReport;

  beforeAll(async () => {
    workbook = await readWorkbook(new Uint8Array(readFileSync(WORKBOOK_PATH)));
    report = parseSpaWellness(workbook);
  });

  it("reads every window the delivery carries", () => {
    expect(report.company).toBe(AUTHORIZED_COMPANY);
    expect(report.windows.map((window) => window.window).sort()).toEqual(["ltm", "mtd", "ytd"]);
    for (const window of report.windows) {
      expect(window.diagnostics.sourceSalonCount).toBeGreaterThan(report.windows[0].salons.length);
      expect(window.salons.length).toBeGreaterThan(0);
    }
  });

  it("keeps only this company's salons, and they are the production roster", () => {
    const mtd = report.windows.find((window) => window.window === "mtd");
    if (!mtd) throw new Error("no MTD window");

    for (const salon of mtd.salons) expect(salon.company).toBe(AUTHORIZED_COMPANY);

    expect([...mtd.salons.map((salon) => salon.storeName)].sort()).toEqual(
      [...PRODUCTION_SALONS.map((salon) => salon.name)].sort(),
    );
    expect([...new Set(mtd.salons.map((salon) => salon.districtLabel))].sort()).toEqual(
      [...new Set(PRODUCTION_SALONS.map((salon) => salon.districtName))].sort(),
    );
  });

  /**
   * THE RULE, READ OFF THE FILE. Not "a zero is ignored" but "there is no zero
   * to ignore" — which is the stronger statement and the one that makes an
   * installed-but-idle unit unrepresentable here.
   */
  it("never writes a zero in an equipment column: absent equipment is blank", () => {
    for (const window of report.windows) {
      const sheet = workbook.sheet(window.sheetName);
      if (!sheet) throw new Error(`missing sheet ${window.sheetName}`);

      const columns = window.diagnostics.equipmentColumns.map(columnIndex);
      expect(columns.length).toBeGreaterThan(0);

      const zeroes: string[] = [];
      for (let row = window.diagnostics.firstDataRow; row <= window.diagnostics.lastDataRow; row += 1) {
        for (const column of columns) {
          if (sheet.cell(row, column).number === 0) zeroes.push(`${window.sheetName} r${row}c${column}`);
        }
      }
      expect(zeroes).toEqual([]);
      // Blanks, on the other hand, are everywhere: most salons lack most types.
      expect(window.diagnostics.notInstalledCells).toBeGreaterThan(0);
    }
  });

  /**
   * The sheet's own `Filtered Average` row is the same rule applied to the
   * denominator, so reproducing it proves the parser counts the same salons the
   * source does.
   */
  it("reproduces the sheet's published Filtered Average for every equipment type", () => {
    for (const window of report.windows) {
      const sheet = workbook.sheet(window.sheetName);
      if (!sheet) throw new Error(`missing sheet ${window.sheetName}`);

      const benchmarks = new Map(report.windows
        .find((entry) => entry.window === window.window)!
        .benchmarks.map((benchmark) => [benchmark.equipmentCode, benchmark]));

      let compared = 0;
      for (const type of window.equipmentTypes) {
        if (!type.isComparable) continue;
        const published = sheet.cell(FILTERED_AVERAGE_ROW, columnIndex(type.sourceColumn)).number;
        const benchmark = benchmarks.get(type.code);
        if (published === null) {
          // `n/a`: nothing in the chain has this type, so there is no benchmark.
          expect(benchmark?.chainAverageSessions ?? null).toBeNull();
          continue;
        }
        expect(benchmark, `${window.sheetName} ${type.label}`).toBeDefined();
        expect(benchmark!.chainAverageSessions, `${window.sheetName} ${type.label}`).toBeCloseTo(
          published,
          6,
        );
        compared += 1;
      }
      expect(compared).toBeGreaterThan(0);
    }
  });

  /**
   * The peer average deliberately DIFFERS from the sheet's Filtered Average: the
   * business documentation compares JB "with other locations that have the same
   * equipment installed", which is a comparison with other people rather than
   * with a pool JB is inside. Both are kept, and this is what says so.
   */
  it("computes a peer average that excludes this company, alongside the chain average", () => {
    const mtd = report.windows.find((window) => window.window === "mtd");
    if (!mtd) throw new Error("no MTD window");

    const ourUse = new Map<string, number>();
    for (const use of mtd.equipmentUse) {
      ourUse.set(use.equipmentCode, (ourUse.get(use.equipmentCode) ?? 0) + 1);
    }

    let differed = 0;
    for (const benchmark of mtd.benchmarks) {
      expect(benchmark.peerSalonCount).toBe(
        benchmark.chainSalonCount - (ourUse.get(benchmark.equipmentCode) ?? 0),
      );
      if (
        benchmark.peerAverageSessions !== null &&
        benchmark.chainAverageSessions !== null &&
        benchmark.peerAverageSessions !== benchmark.chainAverageSessions
      ) {
        differed += 1;
      }
    }
    // If the two never differed the distinction would be decorative.
    expect(differed).toBeGreaterThan(0);
  });

  /**
   * Installed UNITS and used TYPES are different counts, and the gap between
   * them is what an earlier reading mistook for idle equipment. It is
   * granularity: `Count of SPA Equipment` counts machines, one row of usage
   * covers a type, and a salon with two of a type shows one row for both.
   */
  it("keeps installed units and used types as separate counts", () => {
    const mtd = report.windows.find((window) => window.window === "mtd");
    if (!mtd) throw new Error("no MTD window");

    const installedUnits = mtd.salons.reduce((total, salon) => total + (salon.equipmentPieces ?? 0), 0);
    const typesUsed = mtd.salons.reduce((total, salon) => total + salon.equipmentTypesUsed, 0);

    expect(installedUnits).toBeGreaterThan(0);
    expect(typesUsed).toBeGreaterThan(0);
    // Every type a salon uses is installed there, so units can only exceed types.
    expect(installedUnits).toBeGreaterThanOrEqual(typesUsed);
    for (const salon of mtd.salons) {
      expect(salon.equipmentTypesUsed).toBeLessThanOrEqual(salon.equipmentPieces ?? 0);
    }
    expect(typesUsed).toBe(mtd.equipmentUse.length);
  });
});
