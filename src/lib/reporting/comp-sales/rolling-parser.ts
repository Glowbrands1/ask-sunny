import { asNumber, asText, isNullPlaceholder, normalizeHeader } from "../cells";
import { ReportParseError } from "../errors";
import { SALON_NUMBER_PATTERN } from "../salon-number";
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
import type { SheetView, WorkbookView } from "../workbook";
import { resolveDimensionColumns, type DimensionResolution } from "./dimensions";
import {
  assertNoDuplicateSalons,
  candidateSalonRows,
  findDescriptorHeaderRow,
  headerCells,
  readDimension,
  TOTALS_ROW_PATTERN,
} from "./salon-band";
import {
  resolveRollingColumns,
  rollingMetricCode,
  ROLLING_WINDOWS,
  type RollingResolution,
} from "./rolling-map";

/**
 * COMP SALES ROLLING PARSER — `CompReport(MTD)`.
 *
 * Reads the trailing-window comparisons the SOURCE calculated: Revenue and Total
 * Tans over the last 3, 6, 9 and 12 months, each as a current-year figure, a
 * prior-year figure and the source's own percentage change. Twenty-four
 * measures, and nothing else on a 333-column sheet.
 *
 * WHY A SECOND PARSER RATHER THAN A NEW VERSION OF THE FIRST.
 *
 * This is a different SHEET, not a different reading of the same one. Giving it
 * its own `parser_key` has a consequence that is the whole point: the idempotency
 * index on `report_ingestions` is `(file_id, parser_key, parser_version)`, so
 * this parser can read the same file the first one already ingested WITHOUT
 * colliding with it and without superseding a single fact. The 562 facts from
 * `comp_sales_mtd_vs_2024` stay live, and the rolling facts land beside them as a
 * separate source view.
 *
 * WHAT THIS PARSER DELIBERATELY DOES NOT DO:
 *
 *   * It does not compute a trailing window. Every figure is read from a column;
 *     nothing is derived from the year-comparison sheet or from stored periods.
 *   * It does not treat a window as a history. "Last 12 Months" is one number,
 *     not twelve monthly reports, and it must never be plotted as a path.
 *   * It does not read the repeated rolling block. The audited sheet carries a
 *     second copy at GO..HC; only the largest cluster is live, and the repeat is
 *     reported and excluded, never merged.
 *   * It does not compute totals, targets or period comparisons.
 *   * It does not write to a database. It returns `ParsedReport` and nothing else.
 */

export const ROLLING_PARSER_KEY = "comp_sales_mtd_rolling";
export const ROLLING_PARSER_VERSION = 1;
export const ROLLING_FAMILY = "comp_sales";
export const ROLLING_PREFERRED_SHEET = "CompReport(MTD)";
const EXPECTED_GRAIN: ReportPeriodGrain = "mtd";

/**
 * How wide the descriptor band is on this sheet.
 *
 * `CompReport(MTD)` runs its descriptors to column W — two further than the
 * vs-2024 sheet, because it adds `$9.99 Fast (12 mo Commitment)`, `Market
 * Consolidation` and `PF - 1st Distance`. The band is scanned to Z so a template
 * that adds another descriptor still finds it; anything in the range that does
 * not resolve to a reviewed descriptor is reported and ignored, exactly as
 * elsewhere.
 */
const ROLLING_DIMENSION_BAND_END = 26;

/**
 * How far to search for the period marker.
 *
 * Deliberately tight. `detectPeriod` scans every row ABOVE the row it is given
 * and REFUSES when it finds two different periods — correctly, since guessing
 * between them would be inventing a period. This sheet's marker sits in F1, and
 * the thirty-two rows between there and the descriptor header carry a summary
 * block full of dates (salon-age cohorts, open-date bands). Anchoring on row 2
 * searches row 1 only, which is where the marker actually is, instead of
 * inviting an ambiguity failure from rows that were never period markers.
 */
const PERIOD_SEARCH_ANCHOR_ROW = 2;

/**
 * Measures whose absence means this is not the rolling sheet.
 *
 * One complete revenue triple plus the matching Total Tans change: enough to
 * prove both measures and a well-formed window are present, without rejecting a
 * template that drops a window — a missing 6, 9 or 12 month block is reported as
 * `missing_metric_header` rather than treated as a different sheet.
 */
export const REQUIRED_ROLLING_METRICS = [
  rollingMetricCode("total_revenue", 3, "current"),
  rollingMetricCode("total_revenue", 3, "prior"),
  rollingMetricCode("total_revenue", 3, "pct_change"),
  rollingMetricCode("total_tans", 3, "pct_change"),
] as const;

interface RollingAnalysis {
  sheet: SheetView;
  headerRow: number;
  firstDataRow: number;
  dimensions: DimensionResolution;
  rolling: RollingResolution;
  columnsScanned: number;
}

/**
 * Analyses one sheet without judging it.
 *
 * The rolling band is resolved across the WHOLE header row rather than from a
 * band start, because the resolver clusters what it finds and discards every
 * cluster but the largest. That is what excludes the repeated block, and it
 * cannot work on a pre-narrowed range.
 */
function analyzeSheet(sheet: SheetView): RollingAnalysis | null {
  const bandEnd = Math.min(ROLLING_DIMENSION_BAND_END, Math.max(sheet.columnCount, 1));
  const headerRow = findDescriptorHeaderRow(sheet, bandEnd);
  if (headerRow === null) return null;

  const dimensions = resolveDimensionColumns(headerCells(sheet, headerRow, 1, bandEnd));
  const rolling = resolveRollingColumns(headerCells(sheet, headerRow, 1, sheet.columnCount));

  return {
    sheet,
    headerRow,
    firstDataRow: headerRow + 1,
    dimensions,
    rolling,
    columnsScanned: sheet.columnCount,
  };
}

/**
 * Does this sheet's name look like the rolling source?
 *
 * `CompReport(MTD)` and NOT `CompReport(MTD) vs 2024`, which is a different sheet
 * read by a different parser. The anchored pattern is what keeps the two apart:
 * a loose `includes("compreport mtd")` would make each parser claim the other's
 * sheet, and whichever ran first would win.
 */
function nameLooksPreferred(name: string): boolean {
  return /^comp\s*report\s*mtd$/.test(normalizeHeader(name));
}

interface SheetMarkers {
  identityMatched: string[];
  identityMissing: string[];
  /**
   * The period marker is NOT an identity marker.
   *
   * A sheet with the right descriptor band and the right rolling measures IS the
   * rolling report even when its period cell is malformed. Calling that
   * "template drift" would send an operator looking for a changed template when
   * the real problem is one unreadable cell, so detection identifies the report
   * and `parse` raises the specific `period_unreadable`.
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

  if (analysis.dimensions.byProperty.has("salonNumber")) {
    identityMatched.push("salon number column");
  } else identityMissing.push("salon number column");

  if (analysis.dimensions.byProperty.has("storeName")) {
    identityMatched.push("store name column");
  } else identityMissing.push("store name column");

  /**
   * A DUPLICATED MEASURE STILL COUNTS AS PRESENT, FOR IDENTITY.
   *
   * The resolver excludes both occurrences of an ambiguous code, so a duplicate
   * would otherwise read as a MISSING core measure and detection would reject
   * the sheet as unrecognised. It is nothing of the kind: it is plainly the
   * rolling sheet, with a template problem `parse` can describe precisely — the
   * same separation of identity from value validation as the period marker.
   */
  const presentCodes = new Set([
    ...analysis.rolling.resolved.map((entry) => entry.code),
    ...analysis.rolling.duplicates.map((entry) => entry.code),
  ]);
  const missingCore = REQUIRED_ROLLING_METRICS.filter((code) => !presentCodes.has(code));
  if (missingCore.length === 0) {
    identityMatched.push(`rolling window headers (${analysis.rolling.resolved.length} of 24)`);
  } else {
    identityMissing.push(`rolling window headers: ${missingCore.join(", ")}`);
  }

  let periodMarker: string | null = null;
  try {
    periodMarker = detectPeriod(sheet, {
      headerRow: PERIOD_SEARCH_ANCHOR_ROW,
      expectedGrain: EXPECTED_GRAIN,
    }).cell;
  } catch {
    periodMarker = null;
  }

  return { identityMatched, identityMissing, periodMarker };
}

/**
 * STRUCTURAL DETECTION.
 *
 * The sheet NAME orders the candidates and is never sufficient on its own: a
 * workbook with a sheet called `CompReport(MTD)` and unrelated contents fails
 * every structural marker and is rejected.
 *
 * A named candidate that fails is `template_drift` (this parser is out of date);
 * anything else is `unsupported` (wrong file). Those want different responses
 * from an operator, so they are different answers.
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
        `Sheet "${driftCandidate.sheetName}" is named like the rolling Comp Report but no ` +
        `longer matches the structure this parser reads. The template has probably changed.`,
      markersMissing: driftCandidate.markersMissing,
    };
  }

  return {
    supported: false,
    kind: "unsupported",
    sheetName: null,
    reason:
      "No sheet in this workbook matches the rolling Comp Report structure: a descriptor " +
      "band with salon number and store name, and the trailing-window measure headers.",
    markersMissing: ["comp sales rolling sheet structure"],
  };
}

/** The last row holding anything at all, so trailing padding can be named. */
function lastPopulatedRow(analysis: RollingAnalysis): number {
  const { sheet } = analysis;
  const columns = [
    ...analysis.dimensions.resolved.map((entry) => entry.column),
    ...analysis.rolling.resolved.map((entry) => entry.column),
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
    headerRow: PERIOD_SEARCH_ANCHOR_ROW,
    expectedGrain: EXPECTED_GRAIN,
  }).period;

  const warnings: ParserWarning[] = [
    ...analysis.dimensions.warnings,
    ...analysis.rolling.warnings,
  ];
  const skippedRows: SkippedRow[] = [];
  const salons: ParsedSalon[] = [];
  const attributes: ParsedSalonPeriodAttributes[] = [];
  const facts: ParsedFact[] = [];

  /**
   * A DUPLICATE IN THE LIVE BAND FAILS THE INGESTION.
   *
   * The resolver already excludes both occurrences and warns, which is right for
   * a read. For an INGESTION it is not enough: a code that resolved twice means
   * the template is not the one this parser was written against, and quietly
   * loading 22 of 24 measures would leave a view that looks complete and is not.
   * Fail closed, and name the codes.
   */
  if (analysis.rolling.duplicates.length > 0) {
    throw new ReportParseError(
      "template_drift",
      `The rolling band maps ${analysis.rolling.duplicates.length === 1 ? "a measure" : "measures"} ` +
        `more than once inside the live block, so which column is authoritative cannot be ` +
        `determined. Affected ` +
        `${analysis.rolling.duplicates.length === 1 ? "measure" : "measures"}: ` +
        `${analysis.rolling.duplicates.map((entry) => entry.code).join(", ")}.`,
      {
        details: analysis.rolling.duplicates.map(
          (entry) => `${entry.code}: columns ${entry.letters.join(", ")}`,
        ),
      },
    );
  }

  const missingCore = REQUIRED_ROLLING_METRICS.filter(
    (code) => !analysis.rolling.resolved.some((entry) => entry.code === code),
  );
  if (missingCore.length > 0) {
    throw new ReportParseError(
      "template_drift",
      `The sheet is missing rolling measures this parser requires: ${missingCore.join(", ")}.`,
    );
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

  // Before any fact exists: one row per salon, or nothing.
  const salonRows = candidateSalonRows(sheet, salonColumn.column, analysis.firstDataRow);
  assertNoDuplicateSalons(sheet, salonColumn.column, salonRows);

  for (let row = analysis.firstDataRow; row <= sheet.rowCount; row += 1) {
    const salonText = asText(sheet.cell(row, salonColumn.column));
    const rowHasAnyMetric = analysis.rolling.resolved.some(
      (entry) => sheet.cell(row, entry.column).kind !== "empty",
    );
    const rowHasAnyDimension = analysis.dimensions.resolved.some(
      (entry) => sheet.cell(row, entry.column).kind !== "empty",
    );

    if (!rowHasAnyMetric && !rowHasAnyDimension) {
      skippedRows.push({ row, reason: row > lastRow ? "trailing_padding" : "blank_row" });
      continue;
    }

    if (
      (salonText !== null && TOTALS_ROW_PATTERN.test(salonText)) ||
      (salonText === null && rowHasAnyMetric)
    ) {
      skippedRows.push({ row, reason: "totals_row" });
      continue;
    }

    if (salonText === null) {
      // A pre-numbered template slot, not a row that lost its key: the template
      // runs to 116 salon slots and this recipient's copy fills fifteen.
      const hasIdentity = asText(sheet.cell(row, storeColumn.column)) !== null;
      skippedRows.push({
        row,
        reason: hasIdentity ? "missing_salon_number" : "template_placeholder",
      });
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
      // Text throughout: '0468' keeps its leading zero.
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
      nearestCompetitorDistance:
        (salonValues.nearestCompetitorDistance as number | null) ?? null,
      sourceRow: row,
    });

    for (const entry of analysis.rolling.resolved) {
      const cell = sheet.cell(row, entry.column);
      // An empty measure is an ABSENT fact, not a zero, and an explicit `n/a` is
      // the same fact stated out loud.
      if (cell.kind === "empty" || isNullPlaceholder(cell)) continue;

      const value = asNumber(cell);
      if (value === null) {
        warnings.push({
          code: "malformed_metric_value",
          message:
            `${entry.code} on row ${row} (column ${entry.letter}) is not a number, so no ` +
            `fact was produced for it.`,
          column: entry.letter,
          row,
        });
        continue;
      }

      facts.push({
        salonNumber: salonText,
        metricCode: entry.code,
        // A trailing window carries NO basis year: the window is the period, and
        // the database's own check constraint enforces the pairing.
        metricBasisYearRequired: false,
        basisYear: null,
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
    parserKey: ROLLING_PARSER_KEY,
    parserVersion: ROLLING_PARSER_VERSION,
    reportFamily: ROLLING_FAMILY,
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
      metricHeaderRow: analysis.headerRow,
      firstDataRow: analysis.firstDataRow,
      lastDataRow: lastRow,
      columnsScanned: analysis.columnsScanned,
      resolvedMetricColumns: analysis.rolling.resolved.map((entry) => ({
        column: entry.letter,
        header: entry.header,
        metricCode: entry.code,
        basisYear: null,
        resolvedBy: "header" as const,
      })),
      resolvedDimensionColumns: analysis.dimensions.resolved.map((entry) => ({
        column: entry.letter,
        header: entry.header,
        field: entry.field.property,
      })),
      unresolvedColumns: analysis.dimensions.unresolved.map((cell) => ({
        column: cell.letter,
        header: cell.header,
      })),
      separatorColumns: [],
      salonRowsParsed: salons.length,
      factsProduced: facts.length,
      // Every duplicate and every missing core measure has already thrown, so a
      // report that reaches here needs no human adjudication.
      requiresReview: false,
    },
  };
}

/** Every rolling code this parser can produce, for reporting and for tests. */
export const ROLLING_METRIC_CODES = ["total_revenue", "total_tans"].flatMap((measure) =>
  ROLLING_WINDOWS.flatMap((months) =>
    (["current", "prior", "pct_change"] as const).map((side) =>
      rollingMetricCode(measure, months, side),
    ),
  ),
);

export const compSalesRollingParser: SingleSheetParser = {
  key: ROLLING_PARSER_KEY,
  version: ROLLING_PARSER_VERSION,
  family: ROLLING_FAMILY,
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
        "workbook_unreadable",
        `Sheet "${detection.sheetName}" could not be read after detection.`,
      );
    }
    return parseSheet(sheet);
  },
};
