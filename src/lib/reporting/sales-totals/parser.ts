import { ReportParseError } from "../errors";
import type { DetectionResult } from "../parser";
import type { SheetView, WorkbookView } from "../workbook";
import {
  SALES_TOTALS_MEASURES,
  type SalesTotalsWindow,
} from "./metric-map";

/**
 * ============================================================================
 * THE SALES TOTALS PARSER
 * ============================================================================
 *
 * A DAILY report. Curt receives one each morning, and each one carries two
 * windows: the previous day, and month to date through that day. Every delivery
 * is therefore a HISTORICAL SNAPSHOT, not a correction of the last one —
 * the Sep 3 report's MTD covers Sep 1-2, the Sep 4 report's covers Sep 1-3, and
 * both remain true of the day they were run.
 *
 * The consequence that governs everything downstream: MTD SNAPSHOTS ARE NEVER
 * SUMMED ACROSS REPORT DATES. Adding Sep 2 MTD to Sep 3 MTD double-counts Sep 1
 * and Sep 2 and means nothing. Verified against the two real samples — All
 * Salons, Tans: Sep 1 daily 115, Sep 2 daily 124, Sep 2 MTD 239 = 115 + 124. So
 * MTD is already cumulative and the correct operation across dates is to PICK
 * one, never to add.
 *
 * THE SHAPE, as read from the real report:
 *
 *     Sales Totals                                    <- <title>
 *     Sales Totals for 09-02-2026                     <- <h3>, the report date
 *     Note: For Sunless sessions, ...                 <- footnote
 *     |       |            | Grand | Total | PPTA | ...   <- measure headers
 *     | Averages | Salon Counts | 09-02-2026 | MTD | ...  <- SUMMARY header
 *     | All Salons       | 249 | $818.45 | $1,601.20 | ...
 *     | STC Consolidated |  98 | ...
 *     | STC Franchisees  | 151 | ...
 *     |       |            | Grand | Total | PPTA | ...   <- repeated headers
 *     | Company | Salon    | 09-02-2026 | MTD | ...       <- SALON header
 *     | STC Franchisees | KS Lawrence | $760.07 | ...
 *     ...
 *
 * Each measure occupies a PAIR of columns — the report date, then `MTD` — and
 * its name is split across the same pair in the header above ("Grand"+"Total",
 * "New"+"Customers"). That pairing is the parser's main structural anchor: for
 * every measure it checks that the left column of the pair is the report date
 * and the right is `MTD`, so a column inserted, removed or reordered upstream
 * fails rather than silently shifting every figure one measure to the left.
 *
 * THE TWO BLOCKS ARE DIFFERENT POPULATIONS. The summary covers all 249 salons;
 * the salon block is the recipient's 15. The summary is not derivable from the
 * rows and the rows do not add up to it, so they are returned separately and
 * neither is ever computed from the other. See `metric-map.ts`, which also
 * records that the summary figures are per-salon AVERAGES.
 *
 * FAILS CLOSED. Every marker below is required. A report whose template has
 * materially changed raises `template_drift` rather than producing figures
 * nobody can vouch for.
 */

export const SALES_TOTALS_PARSER_KEY = "sales_totals_daily";
/** Bump when a change alters the figures this parser produces. */
export const SALES_TOTALS_PARSER_VERSION = 1;
export const SALES_TOTALS_FAMILY = "sales_totals";

/** Where the label columns end and the measure pairs begin. */
const FIRST_VALUE_COLUMN = 3;
/** Each measure is (report date, MTD). */
const COLUMNS_PER_MEASURE = 2;

/** How far into the sheet to look for the report's identity. */
const HEADER_SCAN_ROWS = 12;

/** The two scope blocks, identified by their first-column header. */
const SUMMARY_HEADER = "averages";
const SALON_HEADER = "company";

export type SalesTotalsScopeKind = "summary" | "salon";

export interface SalesTotalsValue {
  readonly metricCode: string;
  readonly window: SalesTotalsWindow;
  /** Null where the source left the cell blank — never coerced to zero. */
  readonly value: number | null;
}

export interface SalesTotalsRow {
  readonly scopeKind: SalesTotalsScopeKind;
  /**
   * `All Salons`, `STC Consolidated`, `STC Franchisees` for a summary row; the
   * store name for a salon row. Verbatim from the report.
   */
  readonly scopeLabel: string;
  /** The owning company on a salon row; null on a summary row. */
  readonly company: string | null;
  /** How many salons the summary row averages over; null on a salon row. */
  readonly salonCount: number | null;
  readonly values: readonly SalesTotalsValue[];
}

export interface ParsedSalesTotalsReport {
  readonly parserKey: string;
  readonly parserVersion: number;
  readonly reportFamily: string;
  /** ISO `yyyy-mm-dd`, taken from the report body. */
  readonly reportDate: string;
  /** Exactly as the report wrote it, e.g. `09-02-2026`. */
  readonly reportDateRaw: string;
  /** First of the report date's month — where the MTD window opens. */
  readonly monthStart: string;
  readonly summaryRows: readonly SalesTotalsRow[];
  readonly salonRows: readonly SalesTotalsRow[];
  readonly warnings: readonly string[];
  readonly diagnostics: {
    readonly sheetName: string;
    readonly summaryRowCount: number;
    readonly salonRowCount: number;
    readonly valueCount: number;
    readonly measureColumns: readonly { code: string; daily: number; mtd: number }[];
  };
}

/** Text of a cell, trimmed and whitespace-collapsed. Never null. */
function text(sheet: SheetView, row: number, column: number): string {
  return sheet.cell(row, column).text.replace(/\s+/g, " ").trim();
}

/**
 * A cell's number, preferring a genuine numeric cell over parsing its text.
 *
 * This report always arrives as HTML, so every cell is text and the fallback is
 * what actually runs. The numeric branch matters if the same measures ever
 * arrive as a real workbook: `$1,601.20` typed as a number should not be
 * re-derived from its formatted display string.
 */
function numberAt(sheet: SheetView, row: number, column: number): number | null {
  const cell = sheet.cell(row, column);
  if (cell.number !== null) return cell.number;
  return parseSalesTotalsNumber(cell.text);
}

/** Whole row as text, for marker scanning. */
function rowText(sheet: SheetView, row: number): string {
  const cells: string[] = [];
  for (let column = 1; column <= sheet.columnCount; column += 1) {
    cells.push(text(sheet, row, column));
  }
  return cells.join(" ").trim();
}

/**
 * `$1,601.20` / `239` / `` -> number | null.
 *
 * Blank stays null, because a missing figure is not zero — a salon that
 * reported nothing and a salon that took nothing are different facts. Anything
 * present but unreadable is also null rather than a guess, and the caller
 * records a warning.
 */
export function parseSalesTotalsNumber(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed === "-" || trimmed === "—") return null;

  // Parentheses are the accounting negative: (1,234.56) is -1234.56.
  const negative = /^\(.*\)$/.test(trimmed);
  const cleaned = trimmed.replace(/[()$,\s%]/g, "");
  if (cleaned === "" || !/^-?\d*\.?\d+$/.test(cleaned)) return null;

  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed)) return null;
  return negative ? -Math.abs(parsed) : parsed;
}

/**
 * `09-02-2026` -> `{ iso: "2026-09-02", raw: "09-02-2026" }`.
 *
 * MM-DD-YYYY, which is how this source writes dates. Validated by rebuilding
 * the date and checking the parts survive, so `13-45-2026` is refused rather
 * than rolling over into another month.
 */
export function parseSalesTotalsDate(raw: string): { iso: string; raw: string } | null {
  const match = /\b(\d{2})-(\d{2})-(\d{4})\b/.exec(raw);
  if (!match) return null;
  const [, mm, dd, yyyy] = match;
  const month = Number(mm);
  const day = Number(dd);
  const year = Number(yyyy);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null; // e.g. 02-30
  }
  return { iso: date.toISOString().slice(0, 10), raw: match[0] };
}

/** The row holding `Sales Totals for <date>`, and the date it names. */
function findReportDate(
  sheet: SheetView,
): { row: number; iso: string; raw: string } | null {
  const limit = Math.min(HEADER_SCAN_ROWS, sheet.rowCount);
  for (let row = 1; row <= limit; row += 1) {
    const line = rowText(sheet, row);
    if (!/sales totals for/i.test(line)) continue;
    const date = parseSalesTotalsDate(line);
    if (date) return { row, iso: date.iso, raw: date.raw };
  }
  return null;
}

/** Rows whose first cell opens a block, in the order they appear. */
function findBlockHeaderRows(sheet: SheetView): { summary: number; salon: number } | null {
  let summary = 0;
  let salon = 0;
  for (let row = 1; row <= sheet.rowCount; row += 1) {
    const first = text(sheet, row, 1).toLowerCase();
    if (summary === 0 && first === SUMMARY_HEADER) summary = row;
    else if (salon === 0 && first === SALON_HEADER) salon = row;
  }
  return summary > 0 && salon > 0 ? { summary, salon } : null;
}

interface MeasureColumns {
  readonly code: string;
  readonly daily: number;
  readonly mtd: number;
}

/**
 * Locates each measure's column pair and proves it is the right pair.
 *
 * The measure name is split across the two header cells above the pair, and the
 * window row beneath names the report date then `MTD`. Both are checked. This
 * is the single most valuable validation in the parser: without it, a column
 * added upstream would shift every figure one measure sideways and every number
 * on the dashboard would be confidently wrong.
 */
function resolveMeasureColumns(
  sheet: SheetView,
  measureHeaderRow: number,
  windowRow: number,
  reportDateRaw: string,
): { columns: MeasureColumns[]; missing: string[] } {
  const columns: MeasureColumns[] = [];
  const missing: string[] = [];

  SALES_TOTALS_MEASURES.forEach((measure, index) => {
    const daily = FIRST_VALUE_COLUMN + index * COLUMNS_PER_MEASURE;
    const mtd = daily + 1;

    // The name, joined from the pair: "Grand" + "Total", "PPTA" + "".
    const name = `${text(sheet, measureHeaderRow, daily)} ${text(sheet, measureHeaderRow, mtd)}`
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
    if (name !== measure.header.toLowerCase()) {
      missing.push(`${measure.header} header (found "${name || "nothing"}")`);
      return;
    }

    // The windows: the left column is the report day, the right is MTD.
    const left = text(sheet, windowRow, daily);
    const right = text(sheet, windowRow, mtd).toLowerCase();
    if (left !== reportDateRaw) {
      missing.push(`${measure.header} day column (expected ${reportDateRaw}, found "${left}")`);
      return;
    }
    if (right !== "mtd") {
      missing.push(`${measure.header} MTD column (found "${right || "nothing"}")`);
      return;
    }

    columns.push({ code: measure.code, daily, mtd });
  });

  return { columns, missing };
}

/** Reads one data row's six measure pairs. */
function readValues(
  sheet: SheetView,
  row: number,
  columns: readonly MeasureColumns[],
  warnings: string[],
  label: string,
): SalesTotalsValue[] {
  const values: SalesTotalsValue[] = [];
  for (const column of columns) {
    for (const [window, index] of [
      ["daily", column.daily],
      ["mtd", column.mtd],
    ] as const) {
      const raw = text(sheet, row, index);
      const value = numberAt(sheet, row, index);
      if (value === null && raw !== "") {
        warnings.push(
          `${label}: ${column.code} (${window}) could not be read from "${raw}"; recorded as unavailable.`,
        );
      }
      values.push({ metricCode: column.code, window, value });
    }
  }
  return values;
}

/** Structural probe. Never throws. */
export function detectSalesTotals(workbook: WorkbookView): DetectionResult {
  const missing: string[] = [];

  for (const name of workbook.sheetNames) {
    const sheet = workbook.sheet(name);
    if (!sheet) continue;

    const sheetMissing: string[] = [];
    const head = Array.from({ length: Math.min(HEADER_SCAN_ROWS, sheet.rowCount) }, (_, index) =>
      rowText(sheet, index + 1),
    )
      .join(" \n ")
      .toLowerCase();

    if (!head.includes("sales totals")) sheetMissing.push("Sales Totals title");
    const date = findReportDate(sheet);
    if (!date) sheetMissing.push("Sales Totals for <MM-DD-YYYY>");
    const blocks = findBlockHeaderRows(sheet);
    if (!blocks) sheetMissing.push("Averages and Company block headers");

    // The six measure names must all be present somewhere in the header band.
    for (const measure of SALES_TOTALS_MEASURES) {
      const joined = measure.header.toLowerCase();
      const split = joined.split(" ").join(" ");
      if (!head.includes(joined) && !head.includes(split)) {
        sheetMissing.push(`${measure.header} column`);
      }
    }

    if (sheetMissing.length === 0) {
      return { supported: true, sheetName: name, markersMatched: ["Sales Totals", date!.raw] };
    }
    if (missing.length === 0 || sheetMissing.length < missing.length) {
      missing.length = 0;
      missing.push(...sheetMissing);
    }
  }

  const looksLikeOurs = missing.length > 0 && !missing.includes("Sales Totals title");
  return {
    supported: false,
    // "Our parser is out of date" is the more specific and more actionable
    // claim than "unrecognised file", so it is preferred where the report
    // clearly IS a Sales Totals report with something changed.
    kind: looksLikeOurs ? "template_drift" : "unsupported",
    sheetName: null,
    reason: looksLikeOurs
      ? `The report looks like Sales Totals but its structure has changed: ${missing.join("; ")}.`
      : "No sheet carries the Sales Totals markers.",
    markersMissing: missing,
  };
}

/** Full parse. Throws `ReportParseError` when the report cannot be trusted. */
export function parseSalesTotals(workbook: WorkbookView): ParsedSalesTotalsReport {
  const detection = detectSalesTotals(workbook);
  if (!detection.supported) {
    throw new ReportParseError(
      detection.kind === "template_drift" ? "template_drift" : "unsupported_workbook",
      detection.reason,
      { details: detection.markersMissing },
    );
  }

  const sheetName = detection.sheetName!;
  const sheet = workbook.sheet(sheetName)!;
  const warnings: string[] = [];

  const date = findReportDate(sheet)!;
  const blocks = findBlockHeaderRows(sheet)!;

  /*
   * The measure names sit on the row directly above each block's window row.
   * Read from the SUMMARY block; the salon block repeats the same headers and
   * is checked against the same resolved columns, so a report whose two blocks
   * disagreed would fail on the second.
   */
  const summaryColumns = resolveMeasureColumns(
    sheet,
    blocks.summary - 1,
    blocks.summary,
    date.raw,
  );
  const salonColumns = resolveMeasureColumns(sheet, blocks.salon - 1, blocks.salon, date.raw);

  const problems = [...summaryColumns.missing, ...salonColumns.missing];
  if (problems.length > 0) {
    throw new ReportParseError(
      "template_drift",
      `Sales Totals columns could not be resolved: ${problems.join("; ")}.`,
      { details: problems },
    );
  }

  const summaryRows: SalesTotalsRow[] = [];
  const salonRows: SalesTotalsRow[] = [];

  // Summary block: from its header to the row before the salon block's headers.
  for (let row = blocks.summary + 1; row < blocks.salon - 1; row += 1) {
    const label = text(sheet, row, 1);
    // A blank first cell is the repeated measure-header row, not a scope.
    if (label === "" || label.toLowerCase() === SUMMARY_HEADER) continue;

    const countRaw = text(sheet, row, 2);
    const salonCount = numberAt(sheet, row, 2);
    if (salonCount === null && countRaw !== "") {
      warnings.push(`Summary scope "${label}": salon count could not be read from "${countRaw}".`);
    }
    summaryRows.push({
      scopeKind: "summary",
      scopeLabel: label,
      company: null,
      salonCount: salonCount === null ? null : Math.round(salonCount),
      values: readValues(sheet, row, summaryColumns.columns, warnings, `Summary "${label}"`),
    });
  }

  // Salon block: everything after its window row.
  for (let row = blocks.salon + 1; row <= sheet.rowCount; row += 1) {
    const company = text(sheet, row, 1);
    const salon = text(sheet, row, 2);
    if (company === "" && salon === "") continue;
    // A repeated header inside the block is a header, not a salon.
    if (company.toLowerCase() === SALON_HEADER) continue;
    if (salon === "") {
      warnings.push(`Row ${row} under "${company}" has no salon name; skipped.`);
      continue;
    }

    salonRows.push({
      scopeKind: "salon",
      scopeLabel: salon,
      company: company || null,
      salonCount: null,
      values: readValues(sheet, row, salonColumns.columns, warnings, `Salon "${salon}"`),
    });
  }

  if (summaryRows.length === 0) {
    throw new ReportParseError(
      "template_drift",
      "The Sales Totals summary block contained no scope rows.",
    );
  }
  if (salonRows.length === 0) {
    throw new ReportParseError(
      "template_drift",
      "The Sales Totals salon block contained no salon rows.",
    );
  }

  const valueCount =
    summaryRows.reduce((total, row) => total + row.values.length, 0) +
    salonRows.reduce((total, row) => total + row.values.length, 0);

  return {
    parserKey: SALES_TOTALS_PARSER_KEY,
    parserVersion: SALES_TOTALS_PARSER_VERSION,
    reportFamily: SALES_TOTALS_FAMILY,
    reportDate: date.iso,
    reportDateRaw: date.raw,
    monthStart: `${date.iso.slice(0, 7)}-01`,
    summaryRows,
    salonRows,
    warnings,
    diagnostics: {
      sheetName,
      summaryRowCount: summaryRows.length,
      salonRowCount: salonRows.length,
      valueCount,
      measureColumns: summaryColumns.columns,
    },
  };
}
