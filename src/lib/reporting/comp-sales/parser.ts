import { asBoolean, asDateIso, asNumber, asText, normalizeHeader } from "../cells";
import { ReportParseError } from "../errors";
import { detectPeriod } from "../period";
import type { DetectionResult, SingleSheetParser } from "../parser";
import type {
  ParsedFact,
  ParsedReport,
  ParsedSalon,
  ParsedSalonPeriodAttributes,
  ParserWarning,
  ReportPeriodGrain,
  SkippedRow,
} from "../types";
import { columnLetter, type SheetView, type WorkbookView } from "../workbook";
import {
  DIMENSION_BAND_END,
  resolveDimensionColumns,
  type DimensionField,
  type DimensionResolution,
} from "./dimensions";
import {
  REQUIRED_CORE_METRICS,
  resolveMetricColumns,
  type HeaderCell,
  type MetricResolution,
} from "./metric-map";

/**
 * COMP SALES PARSER — `CompReport(MTD) vs 2024`.
 *
 * Reads comparable-store (same-store) salon performance. NOT compensation,
 * payroll, salary or bonuses: the sheet has no employee dimension at all, and
 * its grain is one row per salon per reporting period.
 *
 * WHAT THIS PARSER DELIBERATELY DOES NOT DO:
 *
 *   * It does not compute company totals. A recipient's copy of the workbook may
 *     be filtered to a subset of salons, so a total computed here would be a
 *     confident number about a population we cannot verify. Totals rows already
 *     present in the sheet are SKIPPED for the same reason.
 *   * It does not compute actual-vs-target. The workbook contains no targets.
 *   * It does not compare periods. One historical workbook cannot support that.
 *   * It does not read the abandoned template block. Columns that do not resolve
 *     to a supported metric are ignored and reported, never guessed at.
 *   * It does not write to a database. It returns `ParsedReport` and nothing else.
 */

export const COMP_SALES_PARSER_KEY = "comp_sales_mtd_vs_2024";
export const COMP_SALES_PARSER_VERSION = 1;
export const COMP_SALES_FAMILY = "comp_sales";
export const COMP_SALES_PREFERRED_SHEET = "CompReport(MTD) vs 2024";
const EXPECTED_GRAIN: ReportPeriodGrain = "mtd";

/** How far down the sheet to look for the header row. */
const MAX_HEADER_SCAN_ROWS = 12;

/**
 * The salon-number text key, copied from `salons_salon_number_format` in
 * `20260831001200_reporting_dimensions.sql`. A value that fails here is skipped
 * rather than repaired: the alternative is guessing at a store's identity.
 */
export const SALON_NUMBER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;

/** Row labels that mark an aggregate rather than a salon. */
const TOTALS_ROW_PATTERN =
  /^(total|totals|sub[\s-]?total|grand[\s-]?total|company|companies|all[\s-]salons|average|avg|mean|summary)\b/i;

interface SheetAnalysis {
  sheet: SheetView;
  headerRow: number;
  firstDataRow: number;
  dimensions: DimensionResolution;
  metrics: MetricResolution;
  /** Column index where the measure blocks begin. */
  metricBandStart: number;
  columnsScanned: number;
}

/** Reads a row of headers over a column range. */
function headerCells(sheet: SheetView, row: number, from: number, to: number): HeaderCell[] {
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
 * Locates the header row: the first row whose descriptor band yields both a
 * salon-number and a store-name column. Searching for the REQUIRED pair rather
 * than for a single keyword is what stops a title row that happens to contain
 * the words "Salon Number" from being mistaken for the header.
 */
function findHeaderRow(sheet: SheetView, bandEnd: number): number | null {
  const limit = Math.min(sheet.rowCount, MAX_HEADER_SCAN_ROWS);
  for (let row = 1; row <= limit; row += 1) {
    const headers = headerCells(sheet, row, 1, bandEnd);
    const resolution = resolveDimensionColumns(headers);
    if (resolution.byProperty.has("salonNumber") && resolution.byProperty.has("storeName")) {
      return row;
    }
  }
  return null;
}

/**
 * Analyses one sheet without deciding whether it is acceptable. Returns null
 * only when no header row exists at all — every other judgement belongs to
 * `detect`, so the marker list can be reported in full.
 */
function analyzeSheet(sheet: SheetView): SheetAnalysis | null {
  const bandEnd = Math.min(DIMENSION_BAND_END, Math.max(sheet.columnCount, 1));
  const headerRow = findHeaderRow(sheet, bandEnd);
  if (headerRow === null) return null;

  const dimensionHeaders = headerCells(sheet, headerRow, 1, bandEnd);
  const dimensions = resolveDimensionColumns(dimensionHeaders);

  // Measures begin after the descriptor band — or after the last descriptor
  // actually found, if a template revision widened the band.
  const lastDimensionColumn = dimensions.resolved.reduce(
    (furthest, entry) => Math.max(furthest, entry.column),
    0,
  );
  const metricBandStart = Math.max(bandEnd, lastDimensionColumn) + 1;

  const metrics =
    metricBandStart <= sheet.columnCount
      ? resolveMetricColumns(headerCells(sheet, headerRow, metricBandStart, sheet.columnCount))
      : { resolved: [], unresolved: [], separators: [], warnings: [] };

  return {
    sheet,
    headerRow,
    firstDataRow: headerRow + 1,
    dimensions,
    metrics,
    metricBandStart,
    columnsScanned: sheet.columnCount,
  };
}

/** Does this sheet's name look like the approved source? */
function nameLooksPreferred(name: string): boolean {
  const normalized = normalizeHeader(name);
  // "compreport mtd vs 2024" after punctuation removal. The year is not pinned:
  // next January's file is "vs 2025" and is still this report.
  return /^comp\s*report\s*mtd\s*vs\s*(19|20)\d{2}$/.test(normalized);
}

interface SheetMarkers {
  /**
   * IDENTITY MARKERS — do these say "this is the Comp Report"?
   *
   * Deliberately structural and header-based. All four must hold for a sheet to
   * be accepted, which is what stops a random workbook carrying the approved
   * sheet name from being silently ingested.
   */
  identityMatched: string[];
  identityMissing: string[];
  /**
   * The period marker is NOT an identity marker.
   *
   * A sheet with the right descriptor band and the right core measures IS the
   * Comp Report even when its period cell is malformed — and calling that
   * "template drift" would send an operator looking for a changed template when
   * the real problem is one unreadable cell. So detection identifies the report
   * and `parse` raises the specific `period_unreadable`. The report still fails
   * ingestion either way; it fails with the truth.
   */
  periodMarker: string | null;
}

function detectOnSheet(sheet: SheetView): SheetMarkers {
  const identityMatched: string[] = [];
  const identityMissing: string[] = [];
  const analysis = analyzeSheet(sheet);

  if (!analysis) {
    identityMissing.push("header row with a salon-number and store-name column");
    return { identityMatched, identityMissing, periodMarker: null };
  }
  identityMatched.push(`header row located (row ${analysis.headerRow})`);

  if (analysis.dimensions.byProperty.has("salonNumber")) identityMatched.push("salon number column");
  else identityMissing.push("salon number column");

  if (analysis.dimensions.byProperty.has("storeName")) identityMatched.push("store name column");
  else identityMissing.push("store name column");

  const resolvedCodes = new Set(analysis.metrics.resolved.map((entry) => entry.mapping.code));
  const missingCore = REQUIRED_CORE_METRICS.filter((code) => !resolvedCodes.has(code));
  if (missingCore.length === 0) {
    identityMatched.push(`core metric headers (${REQUIRED_CORE_METRICS.length})`);
  } else {
    identityMissing.push(`core metric headers: ${missingCore.join(", ")}`);
  }

  let periodMarker: string | null = null;
  try {
    periodMarker = detectPeriod(sheet, {
      headerRow: analysis.headerRow,
      expectedGrain: EXPECTED_GRAIN,
    }).cell;
  } catch {
    // Detection never throws. `parse` reports the period problem precisely.
    periodMarker = null;
  }

  return { identityMatched, identityMissing, periodMarker };
}

/**
 * STRUCTURAL DETECTION.
 *
 * The sheet NAME is a hint that orders the candidates; it is never sufficient.
 * A workbook containing a sheet called `CompReport(MTD) vs 2024` with unrelated
 * contents fails every structural marker and is rejected — which is the point
 * of checking six markers rather than one string.
 *
 * A named candidate that fails is reported as `template_drift` (our parser is
 * out of date); anything else is `unsupported` (wrong file). Those want
 * different responses from an operator, so they are different answers.
 */
function detect(workbook: WorkbookView): DetectionResult {
  const named = workbook.sheetNames.filter(nameLooksPreferred);
  const others = workbook.sheetNames.filter((name) => !nameLooksPreferred(name));
  let driftCandidate: { sheetName: string; markersMissing: string[] } | null = null;

  for (const name of [...named, ...others]) {
    const sheet = workbook.sheet(name);
    if (!sheet) continue;
    const markers = detectOnSheet(sheet);
    if (markers.identityMissing.length === 0) {
      return {
        supported: true,
        sheetName: name,
        markersMatched: [
          ...markers.identityMatched,
          markers.periodMarker
            ? `reporting period marker (${markers.periodMarker})`
            : "reporting period marker: UNREADABLE — parsing will reject this file",
        ],
      };
    }
    // Remember the best-named near-miss so drift can be reported specifically.
    if (nameLooksPreferred(name) && !driftCandidate) {
      driftCandidate = { sheetName: name, markersMissing: markers.identityMissing };
    }
  }

  if (driftCandidate) {
    return {
      supported: false,
      kind: "template_drift",
      sheetName: driftCandidate.sheetName,
      reason:
        `Sheet "${driftCandidate.sheetName}" is named like the Comp Report but no longer ` +
        `matches the structure this parser reads. The template has probably changed.`,
      markersMissing: driftCandidate.markersMissing,
    };
  }

  return {
    supported: false,
    kind: "unsupported",
    sheetName: null,
    reason:
      "No sheet in this workbook matches the Comp Report (MTD) structure: a descriptor " +
      "band with salon number and store name, and the core revenue metric headers.",
    markersMissing: ["comp sales sheet structure"],
  };
}

/** Reads one descriptor cell according to its declared kind. */
function readDimension(
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

/** The last row holding anything at all, so trailing padding can be named. */
function lastPopulatedRow(analysis: SheetAnalysis): number {
  const { sheet } = analysis;
  const columns = [
    ...analysis.dimensions.resolved.map((entry) => entry.column),
    ...analysis.metrics.resolved.map((entry) => entry.column),
  ];
  for (let row = sheet.rowCount; row >= analysis.firstDataRow; row -= 1) {
    if (columns.some((column) => sheet.cell(row, column).kind !== "empty")) return row;
  }
  return analysis.firstDataRow - 1;
}

function parseSheet(sheet: SheetView): ParsedReport {
  const analysis = analyzeSheet(sheet);
  if (!analysis) {
    throw new ReportParseError(
      "template_drift",
      "The sheet has no header row with both a salon-number and a store-name column.",
    );
  }

  const period = detectPeriod(sheet, {
    headerRow: analysis.headerRow,
    expectedGrain: EXPECTED_GRAIN,
  }).period;

  const warnings: ParserWarning[] = [
    ...analysis.dimensions.warnings,
    ...analysis.metrics.warnings,
  ];
  const skippedRows: SkippedRow[] = [];
  const salons: ParsedSalon[] = [];
  const attributes: ParsedSalonPeriodAttributes[] = [];
  const facts: ParsedFact[] = [];
  const seenSalonNumbers = new Map<string, number>();

  for (const cell of analysis.metrics.unresolved) {
    warnings.push({
      code: "unresolved_column",
      message:
        `Column ${cell.letter} ("${cell.header}") is not a supported metric and was ignored. ` +
        `Only the 16 reviewed comp sales metrics are ingested.`,
      column: cell.letter,
    });
  }

  const salonColumn = analysis.dimensions.byProperty.get("salonNumber");
  const storeColumn = analysis.dimensions.byProperty.get("storeName");
  if (!salonColumn || !storeColumn) {
    throw new ReportParseError(
      "template_drift",
      "The descriptor band is missing the salon number or store name column.",
    );
  }

  const lastRow = lastPopulatedRow(analysis);

  for (let row = analysis.firstDataRow; row <= sheet.rowCount; row += 1) {
    const salonText = asText(sheet.cell(row, salonColumn.column));
    const rowHasAnyMetric = analysis.metrics.resolved.some(
      (entry) => sheet.cell(row, entry.column).kind !== "empty",
    );
    const rowHasAnyDimension = analysis.dimensions.resolved.some(
      (entry) => sheet.cell(row, entry.column).kind !== "empty",
    );

    if (!rowHasAnyMetric && !rowHasAnyDimension) {
      // Formatting-only rows past the data are padding, not gaps in the data.
      skippedRows.push({ row, reason: row > lastRow ? "trailing_padding" : "blank_row" });
      continue;
    }

    // A totals line: either labelled as one, or carrying figures with no salon.
    if ((salonText !== null && TOTALS_ROW_PATTERN.test(salonText)) || (salonText === null && rowHasAnyMetric)) {
      skippedRows.push({ row, reason: "totals_row" });
      continue;
    }

    if (salonText === null) {
      skippedRows.push({ row, reason: "missing_salon_number" });
      continue;
    }

    if (!SALON_NUMBER_PATTERN.test(salonText)) {
      skippedRows.push({ row, reason: "malformed_salon_number" });
      warnings.push({
        code: "malformed_salon_number",
        message:
          `Row ${row} has a salon number that does not fit the salon text key, so the row ` +
          `was skipped rather than reshaped into something that would match a store.`,
        column: salonColumn.letter,
        row,
      });
      continue;
    }

    const storeName = asText(sheet.cell(row, storeColumn.column));
    if (storeName === null) {
      skippedRows.push({ row, reason: "missing_store_name" });
      continue;
    }

    const firstSeen = seenSalonNumbers.get(salonText);
    if (firstSeen !== undefined) {
      // One live fact per salon/period/metric/year is a database guarantee. A
      // second row for the same salon would collide, so it is skipped here with
      // the reason recorded — never merged, and never allowed to double a figure.
      skippedRows.push({ row, reason: "duplicate_salon" });
      warnings.push({
        code: "duplicate_salon_row",
        message:
          `Salon on row ${row} already appeared on row ${firstSeen}. The later row was ` +
          `skipped; the first occurrence is authoritative.`,
        row,
      });
      continue;
    }
    seenSalonNumbers.set(salonText, row);

    const salonValues: Record<string, string | number | boolean | null> = {};
    for (const entry of analysis.dimensions.resolved) {
      salonValues[entry.field.property] = readDimension(
        sheet,
        row,
        entry.column,
        entry.field,
        entry.letter,
        warnings,
      );
    }

    salons.push({
      salonNumber: salonText,
      storeName,
      ownerRef: (salonValues.ownerRef as string | null) ?? null,
      ownerUid: (salonValues.ownerUid as string | null) ?? null,
      openedAt: (salonValues.openedAt as string | null) ?? null,
      sourceRow: row,
    });

    attributes.push({
      salonNumber: salonText,
      districtLabel: (salonValues.districtLabel as string | null) ?? null,
      regionLabel: (salonValues.regionLabel as string | null) ?? null,
      company: (salonValues.company as string | null) ?? null,
      ownershipGroup: (salonValues.ownershipGroup as string | null) ?? null,
      dma: (salonValues.dma as string | null) ?? null,
      pricingPlan: (salonValues.pricingPlan as string | null) ?? null,
      isCompSalon: (salonValues.isCompSalon as boolean | null) ?? null,
      spaPieces: (salonValues.spaPieces as number | null) ?? null,
      spaInstallDate: (salonValues.spaInstallDate as string | null) ?? null,
      quintileGroup: (salonValues.quintileGroup as string | null) ?? null,
      revenueRank: (salonValues.revenueRank as number | null) ?? null,
      salonAgeYears: (salonValues.salonAgeYears as number | null) ?? null,
      avgClientAge: (salonValues.avgClientAge as number | null) ?? null,
      marketConsolidation: (salonValues.marketConsolidation as string | null) ?? null,
      nearestCompetitorDistance: (salonValues.nearestCompetitorDistance as number | null) ?? null,
      sourceRow: row,
    });

    for (const entry of analysis.metrics.resolved) {
      const cell = sheet.cell(row, entry.column);
      // An empty measure is an ABSENT fact, not a zero. The narrow fact model
      // exists precisely so absence and zero stay distinguishable.
      if (cell.kind === "empty") continue;

      const value = asNumber(cell);
      if (value === null) {
        warnings.push({
          code: "malformed_metric_value",
          message:
            `${entry.mapping.label} on row ${row} (column ${entry.letter}) is not a number, ` +
            `so no fact was produced for it.`,
          column: entry.letter,
          row,
        });
        continue;
      }

      facts.push({
        salonNumber: salonText,
        metricCode: entry.mapping.code,
        metricBasisYearRequired: entry.mapping.basisYearRequired,
        basisYear: entry.basisYear,
        value,
        sourceSheet: sheet.name,
        sourceColumn: entry.letter,
        sourceRow: row,
      });
    }
  }

  if (salons.length === 0) {
    throw new ReportParseError(
      "no_data_rows",
      "The sheet was recognised but contained no usable salon rows.",
      { details: [`rows examined: ${analysis.firstDataRow}-${sheet.rowCount}`] },
    );
  }

  return {
    parserKey: COMP_SALES_PARSER_KEY,
    parserVersion: COMP_SALES_PARSER_VERSION,
    reportFamily: COMP_SALES_FAMILY,
    sourceSheetNames: [sheet.name],
    period,
    salons,
    salonPeriodAttributes: attributes,
    facts,
    warnings,
    skippedRows,
    diagnostics: {
      sheetSelected: sheet.name,
      headerRow: analysis.headerRow,
      firstDataRow: analysis.firstDataRow,
      lastDataRow: lastRow,
      columnsScanned: analysis.columnsScanned,
      resolvedMetricColumns: analysis.metrics.resolved.map((entry) => ({
        column: entry.letter,
        header: entry.header,
        metricCode: entry.mapping.code,
        basisYear: entry.basisYear,
        resolvedBy: entry.resolvedBy,
      })),
      resolvedDimensionColumns: analysis.dimensions.resolved.map((entry) => ({
        column: entry.letter,
        header: entry.header,
        field: entry.field.property,
      })),
      unresolvedColumns: [
        ...analysis.metrics.unresolved.map((cell) => ({ column: cell.letter, header: cell.header })),
        ...analysis.dimensions.unresolved.map((cell) => ({ column: cell.letter, header: cell.header })),
      ],
      separatorColumns: analysis.metrics.separators,
      salonRowsParsed: salons.length,
      factsProduced: facts.length,
    },
  };
}

export const compSalesReportParser: SingleSheetParser = {
  key: COMP_SALES_PARSER_KEY,
  version: COMP_SALES_PARSER_VERSION,
  family: COMP_SALES_FAMILY,
  detect,
  parseSheet,
  parse(workbook: WorkbookView): ParsedReport {
    const detection = detect(workbook);
    if (!detection.supported) {
      throw new ReportParseError(
        detection.kind === "template_drift" ? "template_drift" : "unsupported_workbook",
        detection.reason,
        { details: detection.markersMissing },
      );
    }
    const sheet = workbook.sheet(detection.sheetName);
    if (!sheet) {
      throw new ReportParseError(
        "unsupported_workbook",
        `Sheet "${detection.sheetName}" disappeared between detection and parsing.`,
      );
    }
    return parseSheet(sheet);
  },
};
