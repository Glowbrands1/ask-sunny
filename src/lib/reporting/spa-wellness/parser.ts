import { ReportParseError } from "../errors";
import type { DetectionResult } from "../parser";
import { isAuthorizedCompany } from "../store-identity";
import { columnLetter, isoDate, type SheetView, type WorkbookView } from "../workbook";
import {
  SPA_WELLNESS_DESCRIPTOR_HEADERS,
  SPA_WELLNESS_OTHER_HEADER,
  SPA_WELLNESS_SHEETS,
  SPA_WELLNESS_TOTAL_HEADER,
  spaEquipmentCode,
  spaEquipmentShortLabel,
  type SpaWellnessWindow,
} from "./metric-map";

/**
 * ============================================================================
 * THE SPA WELLNESS TRACKING PARSER
 * ============================================================================
 *
 * One workbook, three period windows, and a chain-wide population that must be
 * narrowed to the authorized company — except for the peer averages, which are
 * the whole point of the report and are therefore computed across the chain and
 * kept as AVERAGES with no salon attached.
 *
 * THE SHAPE, from the real workbook:
 *
 *     sheets MTD / YTD / LTM        the same layout, three windows
 *       R1                          "STC SPA Wellness Tracking - Month to Date"
 *       R3                          summary header; R3C2/R3C3 name the dates
 *       R4..R8                      Filtered Total / Average / % of Trans.,
 *                                   Comp Total / Comp Average
 *       R10                         the SALON header row
 *       R11..                       one row per salon
 *     sheet "First Use Dates"       per-equipment FIRST use, per salon
 *     sheet "Last Use Dates"        per-equipment MOST RECENT use, per salon
 *
 * THE PERIOD COMES FROM THE BODY, and from two cells rather than one: the
 * summary block's `Date This Year` column holds the window's start on one row
 * and its end on the next (2026-08-01 / 2026-08-31 for MTD; 2026-01-01 /
 * 2026-08-31 for YTD; 2025-08-31 / 2026-08-31 for LTM). Both are real Excel
 * date cells, read as UTC so no host timezone can shift a month boundary.
 *
 * THE EQUIPMENT COLUMNS ARE DISCOVERED, NEVER NUMBERED. The block is
 * everything between the last named DESCRIPTOR column and the `Total SPA
 * Sessions (Active Beds)` column. That rule is what makes a new equipment type
 * a data change rather than a deployment: it needs no list to be updated, and
 * it cannot mistake `SPA Products Net Sales` (a dollar figure eight columns
 * past the end of the block) for a machine. The parser then RECONCILES: the
 * equipment columns it found must sum to the source's own total on every row,
 * which is checked for all 248 rows and refuses the sheet if it fails.
 *
 * A BLANK OR ZERO CELL PRODUCES NO FACT. See `metric-map.ts` — this is the
 * report's governing business rule and the parser is where it is enforced.
 */

export const SPA_WELLNESS_PARSER_KEY = "spa_wellness_tracking";
/** Bump when a change alters the figures this parser produces. */
export const SPA_WELLNESS_PARSER_VERSION = 1;
export const SPA_WELLNESS_FAMILY = "spa_wellness";

/** How far down to look for a sheet's title and its header rows. */
const HEADER_SCAN_ROWS = 20;

/** One equipment type as this delivery listed it. */
export interface ParsedSpaEquipmentType {
  /** Stable derived code, e.g. `spa_hydromassage`. */
  readonly code: string;
  /** The header exactly as the workbook wrote it. */
  readonly label: string;
  /** `Hydromassage` — the header without its `SPA ` prefix. */
  readonly shortLabel: string;
  /**
   * False for the `Other` catch-all bucket, which aggregates whatever did not
   * map to a named type and is therefore not the same machine between salons.
   */
  readonly isComparable: boolean;
  /** Column letter it was read from, for lineage. */
  readonly sourceColumn: string;
  /** 1-indexed worksheet column. Not persisted; used to read the cells. */
  readonly sourceColumnIndex: number;
  /** Position within the equipment block, for stable display order. */
  readonly displayOrder: number;
}

/** One salon's use of one equipment type. Only ever written where use > 0. */
export interface ParsedSpaEquipmentUse {
  readonly storeName: string;
  readonly equipmentCode: string;
  readonly sessions: number;
  readonly sourceRow: number;
}

/**
 * The chain-wide average sessions for one equipment type.
 *
 * Computed over the salons that USED that equipment in this window — see the
 * installed-only rule — and kept as an average with a count. No salon, no
 * company, no store name, so this discloses nothing about another company's
 * sites while still supporting the report's central comparison.
 *
 * `peerSalonCount` / `peerAverageSessions` EXCLUDE the authorized company, so
 * "JB against its peers" is a comparison with other people rather than with a
 * pool JB is inside. `chainSalonCount` / `chainAverageSessions` include
 * everybody, which is what the workbook's own `Filtered Average` row reports.
 */
export interface ParsedSpaEquipmentBenchmark {
  readonly equipmentCode: string;
  readonly chainSalonCount: number;
  readonly chainAverageSessions: number | null;
  readonly peerSalonCount: number;
  readonly peerAverageSessions: number | null;
}

/** One salon's period row. */
export interface ParsedSpaWellnessSalon {
  readonly storeName: string;
  readonly company: string;
  /** A manager's personal name in the source. Descriptive, never a key. */
  readonly districtLabel: string | null;
  readonly regionLabel: string | null;
  /** From `Count of SPA Equipment` — installed UNITS, not types. */
  readonly equipmentPieces: number | null;
  /** The source's own `Total SPA Sessions (Active Beds)`. */
  readonly totalSessions: number | null;
  /** Distinct equipment types with non-zero use in this window. */
  readonly equipmentTypesUsed: number;
  /** Earliest first-use of any spa equipment at this salon. */
  readonly firstUseDate: string | null;
  /** Most recent FIRST use — i.e. when the newest piece was first used. */
  readonly newestFirstUseDate: string | null;
  readonly isCompSalon: boolean | null;
  readonly sourceRow: number;
}

/** Per-equipment first and last use, from the two date sheets. */
export interface ParsedSpaEquipmentDates {
  readonly storeName: string;
  readonly equipmentCode: string;
  readonly firstUseDate: string | null;
  readonly lastUseDate: string | null;
}

/** One window of the workbook: one sheet, one period, its own facts. */
export interface ParsedSpaWellnessWindow {
  readonly window: SpaWellnessWindow;
  readonly sheetName: string;
  readonly label: string;
  readonly period: {
    readonly grain: "mtd" | "ytd" | "ltm";
    readonly periodStart: string;
    readonly periodEnd: string;
    readonly fiscalYear: number;
    readonly labelRaw: string;
  };
  readonly equipmentTypes: readonly ParsedSpaEquipmentType[];
  readonly salons: readonly ParsedSpaWellnessSalon[];
  readonly equipmentUse: readonly ParsedSpaEquipmentUse[];
  readonly benchmarks: readonly ParsedSpaEquipmentBenchmark[];
  readonly diagnostics: {
    readonly headerRow: number;
    readonly firstDataRow: number;
    readonly lastDataRow: number;
    readonly equipmentColumns: readonly string[];
    readonly totalColumn: string;
    /** Salon rows in the whole sheet, before company scoping. */
    readonly sourceSalonCount: number;
    /** Equipment cells that were blank or zero, and produced no fact. */
    readonly notInstalledCells: number;
  };
}

export interface ParsedSpaWellnessReport {
  readonly parserKey: string;
  readonly parserVersion: number;
  readonly reportFamily: string;
  readonly sourceSheetNames: readonly string[];
  readonly company: string;
  readonly windows: readonly ParsedSpaWellnessWindow[];
  /** Per-equipment dates, for the authorized company's salons only. */
  readonly equipmentDates: readonly ParsedSpaEquipmentDates[];
  readonly warnings: readonly string[];
}

function text(sheet: SheetView, row: number, column: number): string {
  return sheet.cell(row, column).text.replace(/\s+/g, " ").trim();
}

/** A header, normalized the way the descriptor list is written. */
function headerAt(sheet: SheetView, row: number, column: number): string {
  return text(sheet, row, column).toLowerCase();
}

function numberAt(sheet: SheetView, row: number, column: number): number | null {
  if (column <= 0) return null;
  const cell = sheet.cell(row, column);
  return cell.number !== null && Number.isFinite(cell.number) ? cell.number : null;
}

/**
 * A date cell as ISO `yyyy-mm-dd`, or null.
 *
 * Real date cells only, plus the `yyyy-mm-dd` text form. A `1/22/2026` string
 * is NOT accepted here: this workbook writes genuine dates, and accepting an
 * ambiguous numeric string would let `3/4/2026` mean March or April depending
 * on nothing. Always read in UTC, so the same file parses identically wherever
 * it runs.
 */
function dateAt(sheet: SheetView, row: number, column: number): string | null {
  if (column <= 0) return null;
  const cell = sheet.cell(row, column);
  if (cell.date) return isoDate(cell.date);
  const raw = cell.text.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

/** `Yes` / `No` -> boolean, anything else -> null. */
function yesNoAt(sheet: SheetView, row: number, column: number): boolean | null {
  const raw = text(sheet, row, column).toLowerCase();
  if (raw === "yes") return true;
  if (raw === "no") return false;
  return null;
}

/** The salon block's header row: the one whose first labelled cell is `Salon`. */
function findSalonHeaderRow(sheet: SheetView): number {
  const limit = Math.min(HEADER_SCAN_ROWS, sheet.rowCount);
  for (let row = 1; row <= limit; row += 1) {
    for (let column = 1; column <= Math.min(4, sheet.columnCount); column += 1) {
      if (headerAt(sheet, row, column) !== "salon") continue;
      // The SUMMARY header row also exists (`Date This Year | Metric | ...`)
      // and does not carry `Salon`, so this is unambiguous.
      return row;
    }
  }
  return 0;
}

/** Which column holds a given header on the header row. 0 when absent. */
function columnOf(sheet: SheetView, headerRow: number, header: string): number {
  for (let column = 1; column <= sheet.columnCount; column += 1) {
    if (headerAt(sheet, headerRow, column) === header) return column;
  }
  return 0;
}

/**
 * THE EQUIPMENT BLOCK: everything between the descriptors and the total.
 *
 * Returns the block's bounds and the types inside it, in column order. A
 * labelled column inside the block is an equipment type by construction — which
 * is exactly the property that lets a new type arrive without a deployment.
 * An UNLABELLED column inside the block is a spacer and is skipped; it is
 * reported so an accidentally blanked header is visible.
 */
function resolveEquipmentBlock(
  sheet: SheetView,
  headerRow: number,
): {
  totalColumn: number;
  types: ParsedSpaEquipmentType[];
  blankColumns: string[];
} | null {
  const totalColumn = columnOf(sheet, headerRow, SPA_WELLNESS_TOTAL_HEADER);
  if (totalColumn === 0) return null;

  let lastDescriptor = 0;
  for (let column = 1; column < totalColumn; column += 1) {
    if (SPA_WELLNESS_DESCRIPTOR_HEADERS.includes(headerAt(sheet, headerRow, column))) {
      lastDescriptor = column;
    }
  }
  if (lastDescriptor === 0) return null;

  const types: ParsedSpaEquipmentType[] = [];
  const blankColumns: string[] = [];
  for (let column = lastDescriptor + 1; column < totalColumn; column += 1) {
    const label = text(sheet, headerRow, column);
    if (label.length === 0) {
      blankColumns.push(columnLetter(column));
      continue;
    }
    types.push({
      code: spaEquipmentCode(label),
      label,
      shortLabel: spaEquipmentShortLabel(label),
      isComparable: label.toLowerCase() !== SPA_WELLNESS_OTHER_HEADER,
      sourceColumn: columnLetter(column),
      sourceColumnIndex: column,
      displayOrder: types.length + 1,
    });
  }

  return { totalColumn, types, blankColumns };
}

/**
 * The window's start and end, from the summary block's date column.
 *
 * The column headed `Date This Year` carries the start on its first populated
 * row and the end on the next. Read as the two earliest populated cells in that
 * column above the salon header, in order, so an inserted summary row does not
 * move them.
 */
function readWindowPeriod(
  sheet: SheetView,
  salonHeaderRow: number,
): { start: string; end: string } | null {
  let dateColumn = 0;
  let summaryHeaderRow = 0;
  for (let row = 1; row < salonHeaderRow && summaryHeaderRow === 0; row += 1) {
    for (let column = 1; column <= Math.min(8, sheet.columnCount); column += 1) {
      if (headerAt(sheet, row, column) === "date this year") {
        summaryHeaderRow = row;
        dateColumn = column;
        break;
      }
    }
  }
  if (dateColumn === 0) return null;

  const dates: string[] = [];
  for (let row = summaryHeaderRow + 1; row < salonHeaderRow && dates.length < 2; row += 1) {
    const value = dateAt(sheet, row, dateColumn);
    if (value) dates.push(value);
  }
  if (dates.length < 2) return null;
  const [start, end] = dates;
  if (start > end) return null;
  return { start, end };
}

/** Structural probe. Never throws. */
export function detectSpaWellness(workbook: WorkbookView): DetectionResult {
  const titled = workbook.sheetNames.some((name) => {
    const sheet = workbook.sheet(name);
    if (!sheet) return false;
    const limit = Math.min(4, sheet.rowCount);
    for (let row = 1; row <= limit; row += 1) {
      for (let column = 1; column <= Math.min(6, sheet.columnCount); column += 1) {
        if (/spa wellness/i.test(text(sheet, row, column))) return true;
      }
    }
    return false;
  });

  if (!titled) {
    return {
      supported: false,
      kind: "unsupported",
      sheetName: null,
      reason: "No sheet carries a `SPA Wellness` heading.",
      markersMissing: ["SPA Wellness heading"],
    };
  }

  const missing: string[] = [];
  const present = SPA_WELLNESS_SHEETS.filter((entry) => workbook.sheet(entry.sheet) !== null);
  if (present.length === 0) {
    missing.push(`one of the ${SPA_WELLNESS_SHEETS.map((entry) => entry.sheet).join(" / ")} sheets`);
  }

  /*
   * A WINDOW SHEET MAY BE ABSENT WITHOUT THIS BEING DRIFT. The delivery is
   * defined by the windows it carries, and a file with only MTD is a smaller
   * report rather than a broken one. What is NOT tolerated is a window sheet
   * whose own structure has changed — that is drift, because its figures could
   * not be read correctly.
   */
  for (const entry of present) {
    const sheet = workbook.sheet(entry.sheet)!;
    const headerRow = findSalonHeaderRow(sheet);
    if (headerRow === 0) {
      missing.push(`${entry.sheet}: Salon header row`);
      continue;
    }
    const block = resolveEquipmentBlock(sheet, headerRow);
    if (!block) {
      missing.push(`${entry.sheet}: "${SPA_WELLNESS_TOTAL_HEADER}" column`);
      continue;
    }
    if (block.types.length === 0) missing.push(`${entry.sheet}: equipment columns`);
    if (columnOf(sheet, headerRow, "company") === 0) missing.push(`${entry.sheet}: Company column`);
    if (!readWindowPeriod(sheet, headerRow)) missing.push(`${entry.sheet}: Date This Year range`);
  }

  if (missing.length > 0) {
    return {
      supported: false,
      kind: "template_drift",
      sheetName: present[0]?.sheet ?? null,
      reason: `The SPA Wellness Tracking report's structure has changed: ${missing.join("; ")}.`,
      markersMissing: missing,
    };
  }

  return {
    supported: true,
    sheetName: present[0].sheet,
    markersMatched: ["STC SPA Wellness Tracking", ...present.map((entry) => entry.sheet)],
  };
}

/** Reads one window sheet. */
function parseWindow(
  sheet: SheetView,
  entry: (typeof SPA_WELLNESS_SHEETS)[number],
  keep: (company: string) => boolean,
  warnings: string[],
): ParsedSpaWellnessWindow {
  const headerRow = findSalonHeaderRow(sheet);
  const block = resolveEquipmentBlock(sheet, headerRow)!;
  const period = readWindowPeriod(sheet, headerRow)!;

  for (const column of block.blankColumns) {
    warnings.push(
      `${entry.sheet}: column ${column} sits inside the equipment block with no header, so it produced no equipment type. If a type was added there, its header is missing.`,
    );
  }

  const columns = {
    salon: columnOf(sheet, headerRow, "salon"),
    district: columnOf(sheet, headerRow, "district"),
    region: columnOf(sheet, headerRow, "region"),
    firstUse:
      columnOf(sheet, headerRow, "spa equipment first use") ||
      columnOf(sheet, headerRow, "first use date"),
    newestUse: columnOf(sheet, headerRow, "newest use date"),
    pieces: columnOf(sheet, headerRow, "count of spa equipment"),
    comp: columnOf(sheet, headerRow, "comp"),
    company: columnOf(sheet, headerRow, "company"),
  };

  const salons: ParsedSpaWellnessSalon[] = [];
  const equipmentUse: ParsedSpaEquipmentUse[] = [];
  /** Chain-wide accumulation for the benchmarks, by equipment code. */
  const chain = new Map<string, { all: number[]; peers: number[] }>();
  for (const type of block.types) chain.set(type.code, { all: [], peers: [] });

  let firstDataRow = 0;
  let lastDataRow = 0;
  let sourceSalonCount = 0;
  let notInstalledCells = 0;

  for (let row = headerRow + 1; row <= sheet.rowCount; row += 1) {
    const storeName = text(sheet, row, columns.salon);
    if (storeName.length === 0) continue;
    const company = text(sheet, row, columns.company);
    sourceSalonCount += 1;
    if (firstDataRow === 0) firstDataRow = row;
    lastDataRow = row;

    const mine = keep(company);
    let typesUsed = 0;
    let equipmentSum = 0;

    for (const type of block.types) {
      const value = numberAt(sheet, row, type.sourceColumnIndex);

      /*
       * THE RULE. A blank cell and a zero cell both mean NOT INSTALLED, so
       * neither produces a fact and neither joins a benchmark. Only positive
       * use counts as installed-and-used.
       */
      if (value === null || value === 0) {
        if (mine) notInstalledCells += 1;
        continue;
      }
      if (value < 0) {
        warnings.push(
          `${entry.sheet} row ${row}: "${type.label}" holds a negative session count and was ignored.`,
        );
        continue;
      }

      equipmentSum += value;
      typesUsed += 1;

      const bucket = chain.get(type.code)!;
      bucket.all.push(value);
      if (!mine) bucket.peers.push(value);

      if (mine) {
        equipmentUse.push({
          storeName,
          equipmentCode: type.code,
          sessions: value,
          sourceRow: row,
        });
      }
    }

    /*
     * RECONCILIATION, ON EVERY ROW OF THE WHOLE SHEET.
     *
     * The equipment columns the parser found must add up to the source's own
     * total. This is what proves the block boundaries are right: including one
     * retail column too many, or stopping one equipment column too early,
     * shows up here immediately rather than as a subtly wrong dashboard. It
     * runs over the CHAIN's rows, not just ours, so a column added at the far
     * end of the block is caught even if no authorized salon uses it yet.
     */
    const reportedTotal = numberAt(sheet, row, block.totalColumn);
    if (reportedTotal !== null && Math.abs(reportedTotal - equipmentSum) > 1e-6) {
      throw new ReportParseError(
        "template_drift",
        `${entry.sheet} row ${row}: the equipment columns sum to a different figure than the sheet's own "${SPA_WELLNESS_TOTAL_HEADER}" column, so the equipment block's boundaries are no longer correct.`,
        { details: [`${entry.sheet} row ${row}`] },
      );
    }

    if (!mine) continue;

    salons.push({
      storeName,
      company,
      districtLabel: text(sheet, row, columns.district) || null,
      regionLabel: text(sheet, row, columns.region) || null,
      equipmentPieces: numberAt(sheet, row, columns.pieces),
      totalSessions: reportedTotal,
      equipmentTypesUsed: typesUsed,
      firstUseDate: dateAt(sheet, row, columns.firstUse),
      newestFirstUseDate: dateAt(sheet, row, columns.newestUse),
      isCompSalon: yesNoAt(sheet, row, columns.comp),
      sourceRow: row,
    });
  }

  const average = (values: number[]): number | null =>
    values.length === 0 ? null : values.reduce((total, value) => total + value, 0) / values.length;

  const benchmarks: ParsedSpaEquipmentBenchmark[] = block.types.map((type) => {
    const bucket = chain.get(type.code)!;
    return {
      equipmentCode: type.code,
      chainSalonCount: bucket.all.length,
      chainAverageSessions: average(bucket.all),
      peerSalonCount: bucket.peers.length,
      peerAverageSessions: average(bucket.peers),
    };
  });

  return {
    window: entry.id,
    sheetName: sheet.name,
    label: entry.label,
    period: {
      grain: entry.grain,
      periodStart: period.start,
      periodEnd: period.end,
      fiscalYear: Number(period.end.slice(0, 4)),
      labelRaw: `${text(sheet, 1, 2) || `STC SPA Wellness Tracking - ${entry.label}`}: ${period.start} to ${period.end}`,
    },
    equipmentTypes: block.types,
    salons,
    equipmentUse,
    benchmarks,
    diagnostics: {
      headerRow,
      firstDataRow,
      lastDataRow,
      equipmentColumns: block.types.map((type) => type.sourceColumn),
      totalColumn: columnLetter(block.totalColumn),
      sourceSalonCount,
      notInstalledCells,
    },
  };
}

/**
 * The two date sheets, read for the authorized company's salons only.
 *
 * These sheets carry no company column, so they are filtered by store name
 * against the salons the window sheets already admitted. That is a narrowing,
 * never a widening: a name not in the authorized set is skipped.
 *
 * Their equipment blocks run from after the descriptors to the last labelled
 * column — there is no closing total — and the two sheets carry DIFFERENT
 * descriptor columns (First Use has `Comp` and `Count of SPA Equipment`, Last
 * Use has neither), which is exactly why the block is resolved by header on
 * each sheet rather than by a shared column number.
 */
function parseEquipmentDates(
  workbook: WorkbookView,
  authorizedNames: ReadonlySet<string>,
  warnings: string[],
): { dates: ParsedSpaEquipmentDates[]; sheetNames: string[] } {
  const first = readDateSheet(workbook, "First Use Dates", authorizedNames, warnings);
  const last = readDateSheet(workbook, "Last Use Dates", authorizedNames, warnings);

  const merged = new Map<string, ParsedSpaEquipmentDates>();
  for (const [key, entry] of first.values) {
    merged.set(key, {
      storeName: entry.storeName,
      equipmentCode: entry.equipmentCode,
      firstUseDate: entry.date,
      lastUseDate: null,
    });
  }
  for (const [key, entry] of last.values) {
    const existing = merged.get(key);
    merged.set(key, {
      storeName: entry.storeName,
      equipmentCode: entry.equipmentCode,
      firstUseDate: existing?.firstUseDate ?? null,
      lastUseDate: entry.date,
    });
  }

  return {
    dates: [...merged.values()],
    sheetNames: [...first.sheetNames, ...last.sheetNames],
  };
}

function readDateSheet(
  workbook: WorkbookView,
  sheetName: string,
  authorizedNames: ReadonlySet<string>,
  warnings: string[],
): {
  values: Map<string, { storeName: string; equipmentCode: string; date: string }>;
  sheetNames: string[];
} {
  const values = new Map<string, { storeName: string; equipmentCode: string; date: string }>();
  const sheet = workbook.sheet(sheetName);
  if (!sheet) {
    warnings.push(
      `The "${sheetName}" sheet is absent from this delivery, so per-equipment ${sheetName.toLowerCase().includes("first") ? "first" : "last"}-use dates are recorded as unavailable.`,
    );
    return { values, sheetNames: [] };
  }

  const headerRow = findSalonHeaderRow(sheet);
  if (headerRow === 0) {
    warnings.push(`The "${sheetName}" sheet has no Salon header row and was not read.`);
    return { values, sheetNames: [] };
  }

  let lastDescriptor = 0;
  for (let column = 1; column <= sheet.columnCount; column += 1) {
    if (SPA_WELLNESS_DESCRIPTOR_HEADERS.includes(headerAt(sheet, headerRow, column))) {
      lastDescriptor = column;
    }
  }
  const salonColumn = columnOf(sheet, headerRow, "salon");
  if (salonColumn === 0 || lastDescriptor === 0) {
    warnings.push(`The "${sheetName}" sheet's descriptor columns could not be located.`);
    return { values, sheetNames: [] };
  }

  for (let row = headerRow + 1; row <= sheet.rowCount; row += 1) {
    const storeName = text(sheet, row, salonColumn);
    if (storeName.length === 0) continue;
    if (!authorizedNames.has(storeName)) continue;
    for (let column = lastDescriptor + 1; column <= sheet.columnCount; column += 1) {
      const label = text(sheet, headerRow, column);
      if (label.length === 0) continue;
      const date = dateAt(sheet, row, column);
      if (!date) continue;
      const code = spaEquipmentCode(label);
      values.set(`${storeName}|${code}`, { storeName, equipmentCode: code, date });
    }
  }

  return { values, sheetNames: [sheet.name] };
}

/**
 * Full parse. Throws `ReportParseError` when the report cannot be trusted.
 *
 * `company` defaults to the authorized company. It is a parameter so a test can
 * scope to another company, never so a caller can widen the slice.
 */
export function parseSpaWellness(
  workbook: WorkbookView,
  options: { company?: string } = {},
): ParsedSpaWellnessReport {
  const detection = detectSpaWellness(workbook);
  if (!detection.supported) {
    throw new ReportParseError(
      detection.kind === "template_drift" ? "template_drift" : "unsupported_workbook",
      detection.reason,
      { details: detection.markersMissing },
    );
  }

  const wanted = options.company ?? null;
  const keep = (company: string) =>
    wanted === null ? isAuthorizedCompany(company) : company.trim() === wanted.trim();

  const warnings: string[] = [];
  const windows: ParsedSpaWellnessWindow[] = [];
  const sheetNames: string[] = [];

  for (const entry of SPA_WELLNESS_SHEETS) {
    const sheet = workbook.sheet(entry.sheet);
    if (!sheet) {
      warnings.push(
        `The "${entry.sheet}" sheet is absent from this delivery, so the ${entry.label} window was not ingested.`,
      );
      continue;
    }
    windows.push(parseWindow(sheet, entry, keep, warnings));
    sheetNames.push(sheet.name);
  }

  if (windows.length === 0) {
    throw new ReportParseError(
      "no_data_rows",
      `The workbook carries none of the ${SPA_WELLNESS_SHEETS.map((entry) => entry.sheet).join(", ")} window sheets.`,
    );
  }

  const authorizedNames = new Set(
    windows.flatMap((window) => window.salons.map((salon) => salon.storeName)),
  );
  if (authorizedNames.size === 0) {
    throw new ReportParseError(
      "authorized_company_absent",
      `The report contains no rows for ${wanted ?? "the authorized company"}. It was read successfully and describes ${windows[0].diagnostics.sourceSalonCount} salons, none of them this company's.`,
    );
  }

  const dates = parseEquipmentDates(workbook, authorizedNames, warnings);
  sheetNames.push(...dates.sheetNames);

  return {
    parserKey: SPA_WELLNESS_PARSER_KEY,
    parserVersion: SPA_WELLNESS_PARSER_VERSION,
    reportFamily: SPA_WELLNESS_FAMILY,
    sourceSheetNames: sheetNames,
    company: wanted ?? windows[0].salons[0].company,
    windows,
    equipmentDates: dates.dates,
    warnings,
  };
}
