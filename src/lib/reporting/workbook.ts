import ExcelJS from "exceljs";

import { ReportParseError } from "./errors";

/**
 * A NARROW, LIBRARY-INDEPENDENT VIEW OF A WORKBOOK.
 *
 * Parsers are written against `SheetView`, never against ExcelJS. Two reasons,
 * both practical rather than architectural taste:
 *
 *   1. Tests can build a `SheetView` from a literal grid, so the parsing rules
 *      can be exercised without generating a real `.xlsx` for every case.
 *   2. CACHED FORMULA VALUES are normalised here, once. The audited sheet is
 *      reported to have no formulas in its data band, but other sheets in the
 *      same workbook do, and a formula cell read naively yields
 *      `{ formula, result }` rather than a number. Every parser would otherwise
 *      have to remember that.
 *
 * Cells are addressed 1-indexed by (row, column) to match how spreadsheets are
 * discussed, and `columnLetter` converts to the letters the schema stores as
 * `comp_sales_facts.source_column`.
 */

export type CellKind = "empty" | "text" | "number" | "boolean" | "date" | "error";

export interface CellValue {
  kind: CellKind;
  /** Display-ish text, whitespace-normalised. Empty string when the cell is empty. */
  text: string;
  /** Set only when the cell genuinely holds a number. Never coerced from text. */
  number: number | null;
  /** Set only when the cell holds a real date. */
  date: Date | null;
}

export const EMPTY_CELL: CellValue = { kind: "empty", text: "", number: null, date: null };

export interface SheetView {
  readonly name: string;
  /** Highest row index that holds anything. */
  readonly rowCount: number;
  /** Highest column index that holds anything. */
  readonly columnCount: number;
  cell(row: number, column: number): CellValue;
}

export interface WorkbookView {
  readonly sheetNames: string[];
  sheet(name: string): SheetView | null;
}

/** 1 -> "A", 27 -> "AA". Uppercase only, so it satisfies `^[A-Z]{1,3}$`. */
export function columnLetter(column: number): string {
  if (!Number.isInteger(column) || column < 1) {
    throw new RangeError(`Column index must be a positive integer, got ${column}`);
  }
  let remaining = column;
  let letters = "";
  while (remaining > 0) {
    const rest = (remaining - 1) % 26;
    letters = String.fromCharCode(65 + rest) + letters;
    remaining = Math.floor((remaining - 1) / 26);
  }
  return letters;
}

/** "A" -> 1, "AA" -> 27. Case-insensitive. */
export function columnIndex(letters: string): number {
  const upper = letters.trim().toUpperCase();
  if (!/^[A-Z]{1,3}$/.test(upper)) {
    throw new RangeError(`Not a column reference: "${letters}"`);
  }
  let index = 0;
  for (const character of upper) {
    index = index * 26 + (character.charCodeAt(0) - 64);
  }
  return index;
}

/**
 * Collapses every run of whitespace — including the non-breaking spaces Excel
 * exports are full of — to a single space, and trims. Applied to every cell's
 * text on the way in so that no downstream comparison has to think about it.
 */
export function normalizeCellText(value: string): string {
  return value.replace(/[\s   ]+/g, " ").trim();
}

/**
 * Turns one ExcelJS cell into a `CellValue`.
 *
 * The ordering of these branches is the whole point: a formula cell is
 * unwrapped to its cached result FIRST, so a cached number reads as a number
 * rather than as an object.
 */
function toCellValue(raw: ExcelJS.CellValue): CellValue {
  if (raw === null || raw === undefined || raw === "") return EMPTY_CELL;

  // Formula: use the cached result Excel wrote at save time. A formula with no
  // cached result is treated as empty rather than as a zero — an uncalculated
  // cell is an absent figure, and inventing 0 would be a fabricated fact.
  if (typeof raw === "object" && "formula" in raw) {
    const result = (raw as ExcelJS.CellFormulaValue).result;
    if (result === null || result === undefined) return EMPTY_CELL;
    return toCellValue(result as ExcelJS.CellValue);
  }

  // Shared formula cells carry the same shape via `sharedFormula`.
  if (typeof raw === "object" && "sharedFormula" in raw) {
    const result = (raw as { result?: unknown }).result;
    if (result === null || result === undefined) return EMPTY_CELL;
    return toCellValue(result as ExcelJS.CellValue);
  }

  if (typeof raw === "number") {
    // NaN/Infinity cannot come from a well-formed sheet; refuse rather than
    // let a non-finite value reach a numeric column.
    if (!Number.isFinite(raw)) return { kind: "error", text: String(raw), number: null, date: null };
    return { kind: "number", text: String(raw), number: raw, date: null };
  }

  if (typeof raw === "boolean") {
    return { kind: "boolean", text: raw ? "TRUE" : "FALSE", number: null, date: null };
  }

  if (raw instanceof Date) {
    return { kind: "date", text: isoDate(raw), number: null, date: raw };
  }

  if (typeof raw === "object" && "richText" in raw) {
    const text = normalizeCellText(
      (raw as ExcelJS.CellRichTextValue).richText.map((run: { text: string }) => run.text).join(""),
    );
    return text ? { kind: "text", text, number: null, date: null } : EMPTY_CELL;
  }

  if (typeof raw === "object" && "error" in raw) {
    // #REF!, #N/A and friends. Explicitly an error, never a value.
    return {
      kind: "error",
      text: String((raw as ExcelJS.CellErrorValue).error),
      number: null,
      date: null,
    };
  }

  if (typeof raw === "object" && "text" in raw) {
    // Hyperlink cell: the visible text is what a reader sees.
    const text = normalizeCellText(String((raw as ExcelJS.CellHyperlinkValue).text ?? ""));
    return text ? { kind: "text", text, number: null, date: null } : EMPTY_CELL;
  }

  const text = normalizeCellText(String(raw));
  return text ? { kind: "text", text, number: null, date: null } : EMPTY_CELL;
}

/** UTC `yyyy-mm-dd`. Always UTC, so no local zone can shift the day. */
export function isoDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

class ExcelSheetView implements SheetView {
  readonly name: string;
  readonly rowCount: number;
  readonly columnCount: number;
  private readonly sheet: ExcelJS.Worksheet;
  private readonly cache = new Map<string, CellValue>();

  constructor(sheet: ExcelJS.Worksheet) {
    this.sheet = sheet;
    this.name = sheet.name;
    // `rowCount`/`columnCount` include trailing formatted-but-empty cells,
    // which is what we want for scanning: the parser decides what is padding.
    this.rowCount = Math.max(sheet.rowCount, sheet.actualRowCount);
    this.columnCount = Math.max(sheet.columnCount, sheet.actualColumnCount);
  }

  cell(row: number, column: number): CellValue {
    if (row < 1 || column < 1) return EMPTY_CELL;
    const key = `${row}:${column}`;
    const cached = this.cache.get(key);
    if (cached) return cached;
    const value = toCellValue(this.sheet.getRow(row).getCell(column).value);
    this.cache.set(key, value);
    return value;
  }
}

class ExcelWorkbookView implements WorkbookView {
  readonly sheetNames: string[];
  private readonly views = new Map<string, SheetView>();

  constructor(workbook: ExcelJS.Workbook) {
    this.sheetNames = workbook.worksheets.map((sheet) => sheet.name);
    for (const sheet of workbook.worksheets) {
      this.views.set(sheet.name, new ExcelSheetView(sheet));
    }
  }

  sheet(name: string): SheetView | null {
    return this.views.get(name) ?? null;
  }
}

/** Reads `.xlsx`/`.xlsm` bytes. Never touches the network or the filesystem. */
export async function readWorkbook(buffer: Uint8Array): Promise<WorkbookView> {
  if (buffer.byteLength === 0) {
    throw new ReportParseError("workbook_unreadable", "The file is empty.");
  }
  const workbook = new ExcelJS.Workbook();
  try {
    // ExcelJS wants a Node Buffer-ish ArrayBuffer; a copy keeps the caller's
    // view intact and avoids a detached-buffer surprise.
    await workbook.xlsx.load(
      buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer,
    );
  } catch (cause) {
    throw new ReportParseError(
      "workbook_unreadable",
      "The file could not be read as an Excel workbook.",
      { cause },
    );
  }
  if (workbook.worksheets.length === 0) {
    throw new ReportParseError("workbook_unreadable", "The workbook contains no sheets.");
  }
  return new ExcelWorkbookView(workbook);
}

/**
 * Builds a `SheetView` from a literal grid, for tests and for any future
 * non-Excel source. `grid[0]` is row 1.
 */
export function sheetViewFromGrid(name: string, grid: (string | number | boolean | Date | null)[][]): SheetView {
  const rowCount = grid.length;
  const columnCount = grid.reduce((widest, row) => Math.max(widest, row.length), 0);
  return {
    name,
    rowCount,
    columnCount,
    cell(row: number, column: number): CellValue {
      const value = grid[row - 1]?.[column - 1];
      if (value === undefined) return EMPTY_CELL;
      return toCellValue(value as ExcelJS.CellValue);
    },
  };
}
