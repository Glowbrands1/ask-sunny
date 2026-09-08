import { ReportParseError } from "../errors";
import type { DetectionResult } from "../parser";
import { percentFromRatio } from "../performance/classification";
import { isAuthorizedCompany } from "../store-identity";
import { columnLetter, type SheetView, type WorkbookView } from "../workbook";
import { BED_LEVELS } from "./metric-map";

/**
 * ============================================================================
 * THE BED USAGE PARSER
 * ============================================================================
 *
 * A MONTHLY report, delivered chain-wide. The August 2026 file carries 2,907
 * equipment rows across 252 salons and thirty companies; fifteen of those
 * salons belong to the authorized company, and the parser keeps only those. The
 * chain benchmarks are kept as benchmarks — one number per equipment level,
 * naming no salon and no company.
 *
 * THE SHAPE, from the real workbook:
 *
 *     sheet "Overview(ALL)"   one cell: "Bed Usage Report: Document Overview"
 *     sheet "Summary"
 *       R2..R10    "Filtered Data" block   <- SUBTOTAL over visible rows
 *       R12..R20   "All Salons" block      <- the CHAIN benchmark, per level
 *       R21/R22    "Bed Usage Report: 8/1/2026 to 8/31/2026"   <- the period
 *       R22/R23    a TWO-ROW header, the top word above the bottom word
 *       R24..      the equipment rows
 *     sheet "Usage Detail"    one row per salon per bed model, with Emp Tans
 *
 * THE HEADER IS TWO ROWS AND THE PARSER RESOLVES IT AS TWO ROWS. Column J reads
 * "Usage" on the upper row and "v Chain" on the lower; column O reads "Bed" then
 * "Count". Resolving on the lower row alone would match "Tans" three times over
 * and "Count" not at all. Every column is located by its JOINED header text, so
 * a column inserted, removed or reordered upstream is a refusal rather than
 * every figure quietly shifting one column sideways.
 *
 * THE PERIOD COMES FROM THE WORKBOOK BODY, never the filename. "Bed Usage
 * Report: 8/1/2026 to 8/31/2026" appears both in the Summary title band and on
 * the Usage Detail sheet, and both are checked to agree. A report whose period
 * cannot be read is refused; there is no `new Date()` in this file.
 *
 * WHAT IS DELIBERATELY NOT AGGREGATED HERE. The parser reports rows and the
 * benchmark; it computes no company total, no ranking and no classification.
 * Those live in the analytics layer, over whichever period the reader selected,
 * because a figure computed at parse time is frozen at the shape of one file.
 */

export const BED_USAGE_PARSER_KEY = "bed_usage_monthly";
/** Bump when a change alters the figures this parser produces. */
export const BED_USAGE_PARSER_VERSION = 1;
export const BED_USAGE_FAMILY = "bed_usage";

/** The sheet the equipment rows live on. */
export const BED_USAGE_PREFERRED_SHEET = "Summary";
/** The per-salon-per-model sheet, read only to confirm the period agrees. */
export const BED_USAGE_DETAIL_SHEET = "Usage Detail";

/** How far down to look for the title band and the two header rows. */
const HEADER_SCAN_ROWS = 40;

/**
 * The columns this parser needs, by their JOINED two-row header text.
 *
 * `required` columns are the ones without which a figure would be wrong rather
 * than merely missing. An optional column that disappears becomes a warning and
 * a null, because the source has added and moved supporting columns before.
 */
interface ColumnSpec {
  readonly field: keyof BedUsageColumns;
  /** Joined header text, lowercased, whitespace collapsed. */
  readonly header: string;
  readonly required: boolean;
}

interface BedUsageColumns {
  ref: number;
  salonName: number;
  bedTypeLevel: number;
  company: number;
  level: number;
  bedType: number;
  qty: number;
  clientTans: number;
  perBed: number;
  vChain: number;
  totalTans: number;
  vBedType: number;
  salonTans: number;
  shareOfTans: number;
  bedCount: number;
  shareOfBeds: number;
  countUseRatio: number;
  avgByModel: number;
  avgByLevel: number;
}

const COLUMN_SPECS: readonly ColumnSpec[] = [
  { field: "ref", header: "ref", required: true },
  { field: "salonName", header: "salon name", required: true },
  { field: "bedTypeLevel", header: "bed type/level", required: false },
  { field: "company", header: "company", required: true },
  { field: "level", header: "level", required: true },
  { field: "bedType", header: "bed type", required: true },
  { field: "qty", header: "qty", required: true },
  // "Client" sits above "Tans": tans excluding employee tans.
  { field: "clientTans", header: "client tans", required: true },
  { field: "perBed", header: "tans per bed", required: true },
  { field: "vChain", header: "usage v chain", required: true },
  // "Total" above "Tans": client PLUS employee tans, for this row.
  { field: "totalTans", header: "total tans", required: false },
  { field: "vBedType", header: "usage v bed type", required: false },
  // The salon's whole-salon tans, repeated on every one of its rows.
  { field: "salonTans", header: "salon tans", required: true },
  { field: "shareOfTans", header: "% of tans", required: false },
  { field: "bedCount", header: "bed count", required: true },
  { field: "shareOfBeds", header: "% of beds", required: false },
  { field: "countUseRatio", header: "cnt/use ratio", required: false },
  { field: "avgByModel", header: "avg # of tans by bed model", required: false },
  { field: "avgByLevel", header: "avg # of tans by bed level", required: false },
];

/** One equipment row, kept for the authorized company only. */
export interface ParsedBedUsageEquipmentRow {
  readonly storeName: string;
  readonly company: string;
  /** FAST / FASTER / FASTEST / INSTANT / SUNLESS / SPA, as written. */
  readonly level: string;
  /** The bed model, e.g. `Ergoline 800 Affinity Hybrid`. */
  readonly bedType: string;
  readonly qty: number | null;
  /** Excludes employee tans. The source's own per-bed numerator. */
  readonly clientTans: number | null;
  /** Includes employee tans. Reconciliation only. */
  readonly totalTansWithEmployee: number | null;
  readonly perBed: number | null;
  /** PERCENTAGE difference against the chain for this LEVEL. */
  readonly vChainPercent: number | null;
  /** The ratio exactly as the workbook stated it, for provenance. */
  readonly vChainRatio: number | null;
  /** PERCENTAGE difference against the chain for this exact MODEL. */
  readonly vBedTypePercent: number | null;
  /** This row's share of its salon's tans, as a fraction. */
  readonly shareOfSalonTans: number | null;
  readonly shareOfSalonBeds: number | null;
  readonly sourceRow: number;
}

/** One salon's whole-salon figures, read from its `Ref` = 1 row only. */
export interface ParsedBedUsageSalonRow {
  readonly storeName: string;
  readonly company: string;
  /** The source's `Salon Tans`. Never a sum of the repeated column. */
  readonly totalTans: number | null;
  readonly bedCount: number | null;
  readonly sourceRow: number;
}

/**
 * The chain-wide per-level benchmark, as the report computes it.
 *
 * A BENCHMARK AND NOTHING MORE: an equipment level, the chain's average tans
 * per bed at that level, and how many beds the chain has. No salon, no company,
 * no store name — so keeping it discloses nothing about another company while
 * still letting the dashboard say what a `v Chain` figure is measured against.
 */
export interface ParsedBedUsageChainBenchmark {
  readonly level: string;
  readonly tansPerBed: number | null;
  readonly totalBeds: number | null;
  /** The level's share of chain tans, as a fraction. */
  readonly shareOfChainTans: number | null;
}

export interface ParsedBedUsageReport {
  readonly parserKey: string;
  readonly parserVersion: number;
  readonly reportFamily: string;
  readonly sourceSheetNames: readonly string[];
  readonly period: {
    /** A full calendar month is month-to-date through its last day. */
    readonly grain: "mtd";
    readonly periodStart: string;
    readonly periodEnd: string;
    readonly fiscalYear: number;
    /** The period exactly as the workbook wrote it. */
    readonly labelRaw: string;
  };
  /** The company this report was narrowed to. */
  readonly company: string;
  readonly salons: readonly ParsedBedUsageSalonRow[];
  readonly equipment: readonly ParsedBedUsageEquipmentRow[];
  readonly chainBenchmarks: readonly ParsedBedUsageChainBenchmark[];
  readonly warnings: readonly string[];
  readonly diagnostics: {
    readonly sheetName: string;
    readonly headerRows: readonly [number, number];
    readonly firstDataRow: number;
    readonly lastDataRow: number;
    /** Rows in the whole workbook, before company scoping. */
    readonly sourceRowsScanned: number;
    /** Distinct salons in the whole workbook, before company scoping. */
    readonly sourceSalonCount: number;
    /** Companies present in the source. NAMES ONLY, no figures. */
    readonly sourceCompanyCount: number;
    readonly resolvedColumns: Readonly<Record<string, string>>;
    readonly optionalColumnsMissing: readonly string[];
  };
}

/** Text of a cell, whitespace collapsed. Never null. */
function text(sheet: SheetView, row: number, column: number): string {
  return sheet.cell(row, column).text.replace(/\s+/g, " ").trim();
}

/** A cell's number, or null. Never coerced from a formatted string. */
function numberAt(sheet: SheetView, row: number, column: number): number | null {
  if (column <= 0) return null;
  const cell = sheet.cell(row, column);
  if (cell.number !== null && Number.isFinite(cell.number)) return cell.number;
  return null;
}

/** Whole row as one string, for marker scanning. */
function rowText(sheet: SheetView, row: number): string {
  const parts: string[] = [];
  for (let column = 1; column <= sheet.columnCount; column += 1) {
    const value = text(sheet, row, column);
    // The title is written into every cell of a merged range; one copy is
    // enough for a marker scan and keeps the joined string readable.
    if (value && parts[parts.length - 1] !== value) parts.push(value);
  }
  return parts.join(" ").trim();
}

/**
 * `Bed Usage Report: 8/1/2026 to 8/31/2026` -> both dates, validated.
 *
 * M/D/YYYY, which is how this source writes them. Rebuilt and checked
 * component by component, so `8/32/2026` is refused rather than rolling into
 * September. Nothing here consults the host clock or its timezone.
 */
export function parseBedUsageRange(
  raw: string,
): { start: string; end: string; label: string } | null {
  const match =
    /bed usage (?:report|detail)\s*:\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s*(?:to|-|–|through)\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/i.exec(
      raw.replace(/\s+/g, " "),
    );
  if (!match) return null;
  const iso = (month: string, day: string, year: string): string | null => {
    const m = Number(month);
    const d = Number(day);
    const y = Number(year);
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    const date = new Date(Date.UTC(y, m - 1, d));
    if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
      return null;
    }
    return date.toISOString().slice(0, 10);
  };
  const start = iso(match[1], match[2], match[3]);
  const end = iso(match[4], match[5], match[6]);
  if (!start || !end || start > end) return null;
  return { start, end, label: match[0].trim() };
}

/**
 * Every DISTINCT `Bed Usage Report: <range>` marker in a sheet's header band.
 *
 * SCANNED CELL BY CELL, not row by row. The title lives in a merged range, so
 * the same text reads back from six adjacent cells and de-duplicates to one
 * range — but a row can also carry TWO different markers, which is the case
 * that matters: it means the file was assembled from two runs, and the caller
 * refuses rather than taking whichever came first. Matching once per row would
 * find only the leftmost and miss exactly that.
 */
function findPeriodMarkers(
  sheet: SheetView,
  scanRows = HEADER_SCAN_ROWS,
): { row: number; start: string; end: string; label: string }[] {
  const found: { row: number; start: string; end: string; label: string }[] = [];
  const seen = new Set<string>();
  const limit = Math.min(scanRows, sheet.rowCount);
  for (let row = 1; row <= limit; row += 1) {
    for (let column = 1; column <= sheet.columnCount; column += 1) {
      const parsed = parseBedUsageRange(text(sheet, row, column));
      if (!parsed) continue;
      const key = `${parsed.start}..${parsed.end}`;
      if (seen.has(key)) continue;
      seen.add(key);
      found.push({ row, ...parsed });
    }
  }
  return found;
}

/**
 * The two header rows, located by the row that carries `Ref` in column A.
 *
 * `Ref` is the anchor because it is the only single-word header in the band
 * that is unique to the header row — the title band above repeats a sentence,
 * and the data band below holds numbers. The row above it carries the upper
 * half of the split headers.
 */
function findHeaderRows(sheet: SheetView): { upper: number; lower: number } | null {
  const limit = Math.min(HEADER_SCAN_ROWS, sheet.rowCount);
  for (let row = 2; row <= limit; row += 1) {
    if (text(sheet, row, 1).toLowerCase() !== "ref") continue;
    if (text(sheet, row, 2).toLowerCase() !== "salon name") continue;
    return { upper: row - 1, lower: row };
  }
  return null;
}

/** The joined header for one column: the upper row's word, then the lower's. */
function joinedHeader(sheet: SheetView, rows: { upper: number; lower: number }, column: number) {
  const upper = text(sheet, rows.upper, column);
  const lower = text(sheet, rows.lower, column);
  /*
   * The upper row's leftmost cells hold the merged report title, repeated. A
   * title fragment is not a header word, so anything containing the report name
   * is dropped rather than being joined onto the column below it.
   */
  const upperWord = /bed usage report/i.test(upper) ? "" : upper;
  return `${upperWord} ${lower}`.replace(/\s+/g, " ").trim().toLowerCase();
}

/** Resolves every column by joined header text. */
function resolveColumns(
  sheet: SheetView,
  rows: { upper: number; lower: number },
): {
  columns: BedUsageColumns;
  resolved: Record<string, string>;
  missingRequired: string[];
  missingOptional: string[];
} {
  const headers = new Map<string, number>();
  for (let column = 1; column <= sheet.columnCount; column += 1) {
    const header = joinedHeader(sheet, rows, column);
    if (header.length === 0) continue;
    // First occurrence wins; the source repeats no header inside the band.
    if (!headers.has(header)) headers.set(header, column);
  }

  const columns = Object.fromEntries(
    COLUMN_SPECS.map((spec) => [spec.field, 0]),
  ) as unknown as BedUsageColumns;
  const resolved: Record<string, string> = {};
  const missingRequired: string[] = [];
  const missingOptional: string[] = [];

  for (const spec of COLUMN_SPECS) {
    const column = headers.get(spec.header) ?? 0;
    if (column === 0) {
      (spec.required ? missingRequired : missingOptional).push(spec.header);
      continue;
    }
    columns[spec.field] = column;
    resolved[spec.field] = columnLetter(column);
  }

  return { columns, resolved, missingRequired, missingOptional };
}

/**
 * The chain benchmark block: the `All Salons` label, its own two-row header,
 * then one row per equipment level.
 *
 * Located by its `All Salons` label and read through its OWN headers rather
 * than by offsets from the data band, because the two blocks sit in different
 * columns and have moved independently before.
 *
 * The `Filtered Data` block above it is deliberately IGNORED. Its figures are
 * SUBTOTAL formulas over whatever rows happen to be VISIBLE, so their values
 * depend on the autofilter state the sender left in the file. A benchmark that
 * changes because somebody clicked a filter is not a benchmark. `All Salons`
 * uses plain SUM over the whole column and is the same number every time.
 *
 * Levels are read as the block lists them, so a seventh level appearing
 * upstream is picked up with no code change.
 */
function readChainBenchmarks(
  sheet: SheetView,
  rows: { upper: number; lower: number },
): { benchmarks: ParsedBedUsageChainBenchmark[]; warnings: string[] } {
  const warnings: string[] = [];

  let labelRow = 0;
  outer: for (let row = 1; row < rows.upper; row += 1) {
    for (let column = 1; column <= sheet.columnCount; column += 1) {
      if (/^all salons$/i.test(text(sheet, row, column))) {
        labelRow = row;
        break outer;
      }
    }
  }
  if (labelRow === 0) {
    warnings.push(
      "The chain benchmark block (`All Salons`) was not found, so v Chain figures are stored without the average they were measured against.",
    );
    return { benchmarks: [], warnings };
  }

  // The block's own header is the two rows under its label.
  const blockRows = { upper: labelRow + 1, lower: labelRow + 2 };
  let levelColumn = 0;
  let perBedColumn = 0;
  let bedsColumn = 0;
  let shareColumn = 0;
  for (let column = 1; column <= sheet.columnCount; column += 1) {
    const header = joinedHeader(sheet, blockRows, column);
    if (header === "bed level") levelColumn = column;
    else if (header === "avg tans per bed") perBedColumn = column;
    else if (header.startsWith("total # of beds")) bedsColumn = column;
    else if (header === "% of total tans") shareColumn = column;
  }

  if (levelColumn === 0 || perBedColumn === 0) {
    warnings.push(
      "The chain benchmark block was found but its `Bed Level` and `Avg Tans per bed` columns could not be located, so v Chain figures are stored without the average they were measured against.",
    );
    return { benchmarks: [], warnings };
  }

  const benchmarks: ParsedBedUsageChainBenchmark[] = [];
  for (let row = blockRows.lower + 1; row < rows.upper; row += 1) {
    const level = text(sheet, row, levelColumn);
    if (level.length === 0) continue;
    benchmarks.push({
      level: level.toUpperCase(),
      tansPerBed: numberAt(sheet, row, perBedColumn),
      totalBeds: bedsColumn === 0 ? null : numberAt(sheet, row, bedsColumn),
      shareOfChainTans: shareColumn === 0 ? null : numberAt(sheet, row, shareColumn),
    });
  }

  if (benchmarks.length === 0) {
    warnings.push(
      "The chain benchmark block was found but listed no equipment levels, so v Chain figures are stored without the average they were measured against.",
    );
  }
  return { benchmarks, warnings };
}

/** Structural probe. Never throws for an unrecognised workbook. */
export function detectBedUsage(workbook: WorkbookView): DetectionResult {
  const sheet = workbook.sheet(BED_USAGE_PREFERRED_SHEET);
  const missing: string[] = [];

  /*
   * The one filename-independent claim that this IS the Bed Usage report: the
   * `Bed Usage Report:` / `Bed Usage Detail:` title. Checked across sheets
   * before anything else, because it decides `unsupported` versus
   * `template_drift` — "we do not know this file" and "we know it and it has
   * changed" call for different responses.
   */
  const titled = workbook.sheetNames.some((name) => {
    const candidate = workbook.sheet(name);
    if (!candidate) return false;
    const limit = Math.min(HEADER_SCAN_ROWS, candidate.rowCount);
    for (let row = 1; row <= limit; row += 1) {
      if (/bed usage (report|detail)/i.test(rowText(candidate, row))) return true;
    }
    return false;
  });

  if (!titled) {
    return {
      supported: false,
      kind: "unsupported",
      sheetName: null,
      reason: "No sheet carries a `Bed Usage Report` heading.",
      markersMissing: ["Bed Usage Report heading"],
    };
  }

  if (!sheet) {
    return {
      supported: false,
      kind: "template_drift",
      sheetName: null,
      reason: `The workbook names a Bed Usage Report but has no "${BED_USAGE_PREFERRED_SHEET}" sheet; its sheets are ${workbook.sheetNames.join(", ")}.`,
      markersMissing: [`${BED_USAGE_PREFERRED_SHEET} sheet`],
    };
  }

  const headerRows = findHeaderRows(sheet);
  if (!headerRows) missing.push("Ref / Salon Name header row");

  const markers = findPeriodMarkers(sheet);
  if (markers.length === 0) missing.push("Bed Usage Report: <M/D/YYYY> to <M/D/YYYY>");

  if (headerRows) {
    const { missingRequired } = resolveColumns(sheet, headerRows);
    for (const header of missingRequired) missing.push(`${header} column`);
  }

  if (missing.length > 0) {
    return {
      supported: false,
      kind: "template_drift",
      sheetName: sheet.name,
      reason: `The Bed Usage Report's structure has changed: ${missing.join("; ")}.`,
      markersMissing: missing,
    };
  }

  return {
    supported: true,
    sheetName: sheet.name,
    markersMatched: ["Bed Usage Report", markers[0].label],
  };
}

/**
 * Full parse. Throws `ReportParseError` when the report cannot be trusted.
 *
 * `company` is a parameter with the authorized company as its default so a test
 * can scope to another company without editing the constant — never so a caller
 * can widen the slice. `parseBedUsage(workbook)` is the only call in the
 * application.
 */
export function parseBedUsage(
  workbook: WorkbookView,
  options: { company?: string } = {},
): ParsedBedUsageReport {
  const detection = detectBedUsage(workbook);
  if (!detection.supported) {
    throw new ReportParseError(
      detection.kind === "template_drift" ? "template_drift" : "unsupported_workbook",
      detection.reason,
      { details: detection.markersMissing },
    );
  }

  const sheet = workbook.sheet(detection.sheetName)!;
  const warnings: string[] = [];
  const headerRows = findHeaderRows(sheet)!;
  const { columns, resolved, missingOptional } = resolveColumns(sheet, headerRows);

  for (const header of missingOptional) {
    warnings.push(
      `The optional column "${header}" is absent from this report; the measures that depend on it are recorded as unavailable rather than as zero.`,
    );
  }

  // ---------------------------------------------------------------- period ---
  const markers = findPeriodMarkers(sheet);
  const distinct = new Set(markers.map((marker) => `${marker.start}..${marker.end}`));
  if (distinct.size > 1) {
    /*
     * AMBIGUITY IS A FAILURE, NOT A CHOICE. Two different ranges in one header
     * band means the file was assembled from two runs, and picking either would
     * file one month's figures under the other's name.
     */
    throw new ReportParseError(
      "period_unreadable",
      `The header band names more than one reporting period (${[...distinct].join(", ")}), so the period cannot be determined.`,
      { details: [...distinct] },
    );
  }
  const period = markers[0];

  /*
   * The Usage Detail sheet repeats the range. Checked rather than trusted: a
   * mismatch means the two sheets came from different runs, which is exactly
   * the case where a period must not be guessed.
   */
  const detail = workbook.sheet(BED_USAGE_DETAIL_SHEET);
  const sheetNames = [sheet.name];
  if (detail) {
    const detailMarkers = findPeriodMarkers(detail, 4);
    const disagreeing = detailMarkers.find(
      (marker) => marker.start !== period.start || marker.end !== period.end,
    );
    if (disagreeing) {
      throw new ReportParseError(
        "period_unreadable",
        `"${BED_USAGE_PREFERRED_SHEET}" reports ${period.start} to ${period.end} but "${BED_USAGE_DETAIL_SHEET}" reports ${disagreeing.start} to ${disagreeing.end}.`,
      );
    }
    if (detailMarkers.length > 0) sheetNames.push(detail.name);
  }

  // ------------------------------------------------------------- benchmark ---
  const chain = readChainBenchmarks(sheet, headerRows);
  warnings.push(...chain.warnings);

  // ------------------------------------------------------------------ rows ---
  const wanted = options.company ?? null;
  const keep = (company: string) =>
    wanted === null ? isAuthorizedCompany(company) : company.trim() === wanted.trim();

  const equipment: ParsedBedUsageEquipmentRow[] = [];
  const salons: ParsedBedUsageSalonRow[] = [];
  const salonsSeen = new Map<string, number>();
  const sourceSalons = new Set<string>();
  const sourceCompanies = new Set<string>();
  let scanned = 0;
  let firstDataRow = 0;
  let lastDataRow = 0;

  for (let row = headerRows.lower + 1; row <= sheet.rowCount; row += 1) {
    const storeName = text(sheet, row, columns.salonName);
    if (storeName.length === 0) continue;
    const company = text(sheet, row, columns.company);

    scanned += 1;
    sourceSalons.add(`${company}|${storeName}`);
    if (company.length > 0) sourceCompanies.add(company);
    if (firstDataRow === 0) firstDataRow = row;
    lastDataRow = row;

    /*
     * THE COMPANY GATE. Everything below this line describes the authorized
     * company only. Filtering here rather than downstream means no other
     * company's figures ever reach a `ParsedBedUsageReport`, so they cannot be
     * persisted, cached, aggregated or accidentally rendered.
     */
    if (!keep(company)) continue;

    const level = text(sheet, row, columns.level).toUpperCase();
    if (level.length === 0) {
      warnings.push(`Row ${row} ("${storeName}") has no equipment level and was skipped.`);
      continue;
    }
    if (!BED_LEVELS.includes(level)) {
      /*
       * A NEW LEVEL IS KEPT, NOT DROPPED. `BED_LEVELS` is the observed
       * vocabulary and a seventh level is a business change, not corruption —
       * dropping the rows would understate the salon. It is reported so the
       * addition is noticed.
       */
      warnings.push(
        `Row ${row} ("${storeName}") reports equipment level "${level}", which is not one of the six known levels. The row is kept and the level is recorded as reported.`,
      );
    }

    const clientTans = numberAt(sheet, row, columns.clientTans);
    const qty = numberAt(sheet, row, columns.qty);
    const vChainRatio = numberAt(sheet, row, columns.vChain);

    equipment.push({
      storeName,
      company,
      level,
      bedType: text(sheet, row, columns.bedType),
      qty,
      clientTans,
      totalTansWithEmployee: numberAt(sheet, row, columns.totalTans),
      perBed: numberAt(sheet, row, columns.perBed),
      vChainPercent: percentFromRatio(vChainRatio),
      vChainRatio,
      vBedTypePercent: percentFromRatio(numberAt(sheet, row, columns.vBedType)),
      shareOfSalonTans: numberAt(sheet, row, columns.shareOfTans),
      shareOfSalonBeds: numberAt(sheet, row, columns.shareOfBeds),
      sourceRow: row,
    });

    /*
     * THE SALON TOTAL, ONCE PER SALON.
     *
     * `Salon Tans` and `Bed Count` repeat on every row of a salon, and the
     * source marks the salon's FIRST row with `Ref` = 1 — its own summary block
     * counts salons with `SUM(A:A)`. So the total is taken from the `Ref` = 1
     * row. Where a report ever arrives without the flag, the first row seen for
     * a salon is used instead and the substitution is reported, because the
     * alternative — summing the column — is wrong by a factor of ten.
     */
    if (salonsSeen.has(storeName)) continue;
    const ref = numberAt(sheet, row, columns.ref);
    if (ref !== 1) {
      warnings.push(
        `"${storeName}" has no row flagged as its first (Ref = 1); its salon totals were read from row ${row}, the first row seen for it.`,
      );
    }
    salonsSeen.set(storeName, row);
    salons.push({
      storeName,
      company,
      totalTans: numberAt(sheet, row, columns.salonTans),
      bedCount: numberAt(sheet, row, columns.bedCount),
      sourceRow: row,
    });
  }

  if (salons.length === 0) {
    /*
     * A REFUSAL RATHER THAN AN EMPTY REPORT. An empty ingestion would supersede
     * the previous month's facts with nothing and leave a dashboard reporting
     * zero salons as though that were the answer.
     */
    throw new ReportParseError(
      "authorized_company_absent",
      `The report contains no rows for ${wanted ?? "the authorized company"}. It was read successfully and describes ${sourceSalons.size} salons across ${sourceCompanies.size} companies, none of them this one.`,
    );
  }

  return {
    parserKey: BED_USAGE_PARSER_KEY,
    parserVersion: BED_USAGE_PARSER_VERSION,
    reportFamily: BED_USAGE_FAMILY,
    sourceSheetNames: sheetNames,
    period: {
      grain: "mtd",
      periodStart: period.start,
      periodEnd: period.end,
      fiscalYear: Number(period.end.slice(0, 4)),
      labelRaw: period.label,
    },
    company: wanted ?? salons[0].company,
    salons,
    equipment,
    chainBenchmarks: chain.benchmarks,
    warnings,
    diagnostics: {
      sheetName: sheet.name,
      headerRows: [headerRows.upper, headerRows.lower],
      firstDataRow,
      lastDataRow,
      sourceRowsScanned: scanned,
      sourceSalonCount: sourceSalons.size,
      sourceCompanyCount: sourceCompanies.size,
      resolvedColumns: resolved,
      optionalColumnsMissing: missingOptional,
    },
  };
}
