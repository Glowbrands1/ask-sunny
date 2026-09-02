import ExcelJS from "exceljs";

import { buildCompSalesWorkbook, type FixtureOptions } from "./comp-sales-workbook";
import {
  buildRollingWorkbook,
  type RollingFixtureOptions,
} from "./comp-sales-rolling-workbook";
import { buildYtdWorkbook, type YtdFixtureOptions } from "./comp-sales-ytd-workbook";

/**
 * ONE WORKBOOK CONTAINING ALL THREE SHEETS, as the real delivery does.
 *
 * The three existing fixtures each build a single-sheet workbook, which is
 * right for testing one parser. Automated intake needs the shape the mailbox
 * actually delivers: `CompReport(MTD) vs 2024`, `CompReport(MTD)` and
 * `CompReport(YTD)` in one file, so that "one delivery runs every compatible
 * parser" can be tested rather than asserted.
 *
 * BUILT BY COMPOSING THE EXISTING FIXTURES rather than by reimplementing their
 * layouts. Each is generated, read back, and its cells copied into a merged
 * workbook. Re-deriving those grids here would mean three more copies of the
 * audited template — the row-1-versus-row-34 header split, the out-of-band
 * gaps, the `n/a` percentage cells — and the copies would drift from the
 * originals the first time a parser changed.
 *
 * Values only. The parsers read through `readWorkbook`, which flattens each
 * sheet to a value grid, so a value-level copy is exactly as faithful as the
 * source fixture for every assertion a parser can make.
 */

export interface CombinedFixtureOptions {
  /** Options for the `CompReport(MTD) vs 2024` sheet, or `null` to omit it. */
  vs2024?: FixtureOptions | null;
  /** Options for the rolling `CompReport(MTD)` sheet, or `null` to omit it. */
  rolling?: RollingFixtureOptions | null;
  /** Options for the `CompReport(YTD)` sheet, or `null` to omit it. */
  ytd?: YtdFixtureOptions | null;
}

/** Reads a generated single-sheet workbook back as a value grid. */
async function gridOf(bytes: Uint8Array): Promise<{ name: string; grid: unknown[][] }[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes.buffer as ArrayBuffer);

  return workbook.worksheets.map((sheet) => {
    const grid: unknown[][] = [];
    for (let row = 1; row <= sheet.rowCount; row += 1) {
      const cells: unknown[] = [];
      for (let column = 1; column <= sheet.columnCount; column += 1) {
        const cell = sheet.getCell(row, column);
        /*
         * `cell.value` on a formula cell is an object carrying the formula and
         * its cached result. The fixtures write literals, but taking `.result`
         * where one appears keeps this honest if that ever changes — a parser
         * reading through `readWorkbook` sees the result, not the formula.
         */
        const value = cell.value;
        cells.push(
          value !== null && typeof value === "object" && "result" in value
            ? (value as { result: unknown }).result
            : value,
        );
      }
      grid.push(cells);
    }
    return { name: sheet.name, grid };
  });
}

export async function buildCombinedCompReportWorkbook(
  options: CombinedFixtureOptions = {},
): Promise<Uint8Array> {
  const parts: { name: string; grid: unknown[][] }[] = [];

  /*
   * Order matters and mirrors the registry: the year-comparison sheet first,
   * then rolling, then year-to-date. A parser locates its own sheet by name and
   * markers, so order does not decide which parser reads what — but it does
   * decide which report's period ends up in the storage path, and pinning it
   * here keeps that deterministic.
   */
  if (options.vs2024 !== null) {
    parts.push(...(await gridOf(await buildCompSalesWorkbook(options.vs2024 ?? {}))));
  }
  if (options.rolling !== null) {
    parts.push(...(await gridOf(await buildRollingWorkbook(options.rolling ?? {}))));
  }
  if (options.ytd !== null) {
    parts.push(...(await gridOf(await buildYtdWorkbook(options.ytd ?? {}))));
  }

  const merged = new ExcelJS.Workbook();
  for (const part of parts) {
    const sheet = merged.addWorksheet(part.name);
    part.grid.forEach((cells, rowIndex) => {
      cells.forEach((value, columnIndex) => {
        if (value === null || value === undefined) return;
        sheet.getCell(rowIndex + 1, columnIndex + 1).value = value as ExcelJS.CellValue;
      });
    });
  }

  const buffer = await merged.xlsx.writeBuffer();
  return new Uint8Array(buffer as ArrayBuffer);
}
