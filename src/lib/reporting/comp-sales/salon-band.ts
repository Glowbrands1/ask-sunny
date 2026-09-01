import { asBoolean, asDateIso, asNumber, asText } from "../cells";
import { ReportParseError } from "../errors";
import { SALON_NUMBER_PATTERN } from "../salon-number";
import type { ParserWarning } from "../types";
import { columnLetter, type SheetView } from "../workbook";
import { resolveDimensionColumns, type DimensionField } from "./dimensions";

/**
 * A header as the resolvers receive it.
 *
 * Declared here rather than imported from the metric map: the salon band is
 * shared by every sheet parser, and it must not depend on any one sheet's
 * measure vocabulary.
 */
export interface HeaderCell {
  column: number;
  letter: string;
  header: string;
}

/**
 * THE SALON BAND, SHARED BY EVERY COMP SALES SHEET PARSER.
 *
 * Extracted when the second parser arrived. The workbook's three sheets differ
 * entirely in their MEASURE columns — one labels them by year, one by trailing
 * window, one by year-to-date — but they share the salon band exactly: the same
 * descriptor headers, the same 116-slot template, the same totals rows, the same
 * text salon key.
 *
 * These helpers live here rather than being copied because two of them encode
 * rules that MUST behave identically wherever they are applied:
 *
 *   `assertNoDuplicateSalons` fails the whole ingestion. A second parser with
 *   its own slightly different copy of that check is how one sheet ends up
 *   accepting a file the other rejects.
 *
 *   `readDimension` mirrors the schema's own bounds, so a value the database
 *   would refuse is dropped with a warning rather than failing an insert. Two
 *   copies would drift the moment one schema constraint changed.
 */

/** Row labels that mark an aggregate rather than a salon. */
export const TOTALS_ROW_PATTERN =
  /^(total|totals|sub[\s-]?total|grand[\s-]?total|company|companies|all[\s-]salons|average|avg|mean|summary)\b/i;

/**
 * How far down a sheet to look for the descriptor header row.
 *
 * Every sheet in the audited workbook puts its measure headers on row 1, then a
 * block of filtered totals, averages, age cohorts and quintile summaries, and
 * only reaches the descriptor header row at row 34. A tight scan window would
 * miss it; the row is still identified by structure, not by position.
 */
export const MAX_HEADER_SCAN_ROWS = 60;

/** Reads a row of headers over a column range. */
export function headerCells(
  sheet: SheetView,
  row: number,
  from: number,
  to: number,
): HeaderCell[] {
  const cells: HeaderCell[] = [];
  for (let column = from; column <= to; column += 1) {
    cells.push({
      column,
      letter: columnLetter(column),
      header: asText(sheet.cell(row, column)) ?? "",
    });
  }
  return cells;
}

/**
 * Locates the descriptor header row.
 *
 * The first row whose descriptor band yields BOTH a salon-number and a
 * store-name column. Searching for the required pair rather than for a single
 * keyword is what stops a title row that happens to contain the words "Salon
 * Number" from being mistaken for the header.
 */
export function findDescriptorHeaderRow(sheet: SheetView, bandEnd: number): number | null {
  const limit = Math.min(sheet.rowCount, MAX_HEADER_SCAN_ROWS);
  for (let row = 1; row <= limit; row += 1) {
    const resolution = resolveDimensionColumns(headerCells(sheet, row, 1, bandEnd));
    if (resolution.byProperty.has("salonNumber") && resolution.byProperty.has("storeName")) {
      return row;
    }
  }
  return null;
}

/** Reads one descriptor cell according to its declared kind. */
export function readDimension(
  sheet: SheetView,
  row: number,
  column: number,
  field: DimensionField,
  letter: string,
  warnings: ParserWarning[],
): string | number | boolean | null {
  const cell = sheet.cell(row, column);
  switch (field.kind) {
    case "text":
      return asText(cell);
    case "boolean":
      return asBoolean(cell);
    case "date":
      return asDateIso(cell);
    case "number":
    case "integer": {
      const value = asNumber(cell);
      if (value === null) return null;
      if (field.kind === "integer" && !Number.isInteger(value)) {
        warnings.push({
          code: "malformed_dimension_value",
          message: `${field.property} in column ${letter} is not a whole number; stored as empty.`,
          column: letter,
          row,
        });
        return null;
      }
      // Mirror the schema's own bounds so a value the database would refuse is
      // dropped here, with a warning, rather than failing the whole insert.
      const floor = field.property === "revenueRank" ? 1 : 0;
      if (
        (field.property === "revenueRank" ||
          field.property === "spaPieces" ||
          field.property === "salonAgeYears" ||
          field.property === "avgClientAge") &&
        value < floor
      ) {
        warnings.push({
          code: "malformed_dimension_value",
          message:
            `${field.property} in column ${letter} is below the minimum the schema allows; ` +
            `stored as empty.`,
          column: letter,
          row,
        });
        return null;
      }
      return value;
    }
    default: {
      const exhaustive: never = field.kind;
      throw new Error(`Unhandled dimension kind: ${String(exhaustive)}`);
    }
  }
}

/**
 * Rows that look like a salon: a readable text key that is not a totals label.
 *
 * A cheap pre-pass, so duplicates can be caught before any fact is built.
 */
export function candidateSalonRows(
  sheet: SheetView,
  salonColumn: number,
  firstDataRow: number,
): number[] {
  const rows: number[] = [];
  for (let row = firstDataRow; row <= sheet.rowCount; row += 1) {
    const text = asText(sheet.cell(row, salonColumn));
    if (text === null || TOTALS_ROW_PATTERN.test(text)) continue;
    if (!SALON_NUMBER_PATTERN.test(text)) continue;
    rows.push(row);
  }
  return rows;
}

/**
 * DUPLICATE SALON NUMBERS FAIL THE WHOLE INGESTION.
 *
 * Checked before any fact is built, and reporting EVERY duplicate rather than
 * stopping at the first — an operator fixing the source file needs the whole
 * list, not one entry at a time.
 *
 * The error names the salon numbers, because that is what makes it actionable,
 * and nothing else: no figures, no store names, no row contents.
 */
export function assertNoDuplicateSalons(
  sheet: SheetView,
  salonColumn: number,
  rows: number[],
): void {
  const rowsBySalon = new Map<string, number[]>();
  for (const row of rows) {
    const key = asText(sheet.cell(row, salonColumn)) as string;
    rowsBySalon.set(key, [...(rowsBySalon.get(key) ?? []), row]);
  }

  const duplicated = [...rowsBySalon.entries()]
    .filter(([, occurrences]) => occurrences.length > 1)
    .map(([salonNumber, occurrences]) => ({ salonNumber, rows: occurrences }));

  if (duplicated.length === 0) return;

  throw new ReportParseError(
    "duplicate_salon_number",
    `The report lists ${duplicated.length === 1 ? "a salon" : "salons"} more than once, ` +
      `so it is not one row per salon and its figures cannot be trusted. ` +
      `Fix the source file and re-ingest. Affected salon ` +
      `${duplicated.length === 1 ? "number" : "numbers"}: ` +
      `${duplicated.map((entry) => entry.salonNumber).join(", ")}.`,
    {
      details: duplicated.map(
        (entry) => `salon ${entry.salonNumber}: ${entry.rows.length} rows (${entry.rows.join(", ")})`,
      ),
    },
  );
}
