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
import type { MetricResolution } from "./metric-map";
import {
  assertNoDuplicateSalons,
  candidateSalonRows,
  findDescriptorHeaderRow,
  headerCells,
  readDimension,
  TOTALS_ROW_PATTERN,
} from "./salon-band";
import { OBSERVED_YTD_COLUMNS, resolveYtdColumns } from "./ytd-map";

/**
 * COMP SALES YEAR-TO-DATE PARSER — `CompReport(YTD)`.
 *
 * Reads the eight approved measures accumulated from 1 January, each as a 2026
 * figure, a 2025 figure and the source's own percentage change.
 *
 * A SEPARATE PERIOD, NOT A SEPARATE VIEW OF THE SAME ONE. This is the point of
 * the whole parser. The month-to-date sheets are marked `MTD 08/30/2026`; this
 * one is marked `YTD 07 2026`, and those describe different accumulation
 * windows over different spans of time. They therefore get different
 * `report_periods` rows, with different grains, and no query that scopes itself
 * to one can reach the other. A year-to-date revenue figure sitting beside a
 * month-to-date one under a single heading would be wrong by a factor of about
 * nine — measured, not guessed: the audit found the year-to-date figures run
 * eight to thirteen times the month-to-date ones.
 *
 * WHY ITS OWN PARSER KEY. The idempotency index on `report_ingestions` is
 * `(file_id, parser_key, parser_version)`, so this parser reads the same file
 * the other two already ingested without colliding with either, and supersession
 * is scoped to period, salon and source sheet — so it cannot touch a fact
 * belonging to the month-to-date period.
 *
 * WHAT THIS PARSER DELIBERATELY DOES NOT DO:
 *
 *   * It does not read the trailing-window columns this sheet also carries.
 *     Seven of their eight blocks are byte-identical to the month-to-date
 *     sheet's and the eighth contradicts that, so they are not year-to-date
 *     figures. See `ytd-map.ts` for the measurements.
 *   * It does not read the `AJ`/`AK` pair, whose two year labels contradict
 *     each other and whose baseline exists nowhere else on the sheet.
 *   * It does not derive a year-to-date figure from month-to-date facts, or a
 *     month-to-date figure from these. Nothing is computed across periods.
 *   * It does not treat `2026 Revenue (if >24 mos. old)` as a measure. It
 *     repeats `AF` exactly on all fifteen rows and answers a different question.
 *   * It does not write to a database. It returns `ParsedReport` and nothing else.
 */

export const YTD_PARSER_KEY = "comp_sales_ytd";
export const YTD_PARSER_VERSION = 1;
export const YTD_FAMILY = "comp_sales";
export const YTD_PREFERRED_SHEET = "CompReport(YTD)";
const EXPECTED_GRAIN: ReportPeriodGrain = "ytd";

/**
 * How wide the descriptor band is on this sheet.
 *
 * `CompReport(YTD)` runs its descriptors to V, one short of the rolling sheet.
 * Scanned to Z so a template that adds another still finds it; anything in the
 * range that does not resolve to a reviewed descriptor is reported and ignored.
 */
const YTD_DIMENSION_BAND_END = 26;

/**
 * How far to search for the period marker.
 *
 * The same tight anchor the rolling parser uses, for the same reason.
 * `detectPeriod` scans every row ABOVE the row it is given and refuses when it
 * finds two different periods. This sheet's marker is in F1, and the
 * thirty-two rows between there and the descriptor header carry summary blocks
 * full of dates — salon-age cohorts, open-date bands, quintile rows. Anchoring
 * on row 2 searches row 1 only, which is where the marker is.
 */
const PERIOD_SEARCH_ANCHOR_ROW = 2;

/**
 * Measures whose absence means this is not the year-to-date sheet.
 *
 * Total Revenue at both years plus its change: enough to prove the sheet's
 * defining comparison is present, without rejecting a template that drops one
 * of the volume measures — those are reported as `missing_metric_header`.
 */
export const REQUIRED_YTD_METRICS = [
  "total_revenue",
  "total_revenue_pct_change",
] as const;

/** Every code this parser can produce, for reporting and for tests. */
export const YTD_MEASURE_CODES = [
  "total_revenue",
  "otc_revenue",
  "eft_revenue",
  "uv_tans",
  "sunless_tans",
  "spa_sessions",
  "unique_tanners",
  "total_tans",
] as const;

interface YtdAnalysis {
  sheet: SheetView;
  headerRow: number;
  firstDataRow: number;
  dimensions: DimensionResolution;
  metrics: MetricResolution;
  columnsScanned: number;
}

/**
 * Analyses one sheet without judging it.
 *
 * Measures are resolved across the WHOLE header row rather than from a band
 * start, because the resolver clusters what it finds and keeps only the largest
 * cluster. That is what excludes this sheet's stale repeat block — which begins
 * at FR with `OTC Revenue MTD` on a year-to-date sheet and runs on to
 * `Est. 2014 Total Revenue` — and it cannot work on a pre-narrowed range.
 */
function analyzeSheet(sheet: SheetView): YtdAnalysis | null {
  const bandEnd = Math.min(YTD_DIMENSION_BAND_END, Math.max(sheet.columnCount, 1));
  const headerRow = findDescriptorHeaderRow(sheet, bandEnd);
  if (headerRow === null) return null;

  /**
   * MEASURE HEADERS COME FROM THE DESCRIPTOR HEADER ROW, NOT ROW 1.
   *
   * Both rows carry headers and they DISAGREE. Row 1 heads column AF
   * "Est. 2026 Total Revenue"; row 34 heads it "YTD 2026 Total Revenue". The
   * arithmetic settles it — AF equals `OTC Revenue YTD` plus `EFT Revenue` on
   * all fifteen rows, so it is an actual, not an estimate — and row 34 is the
   * row that says so. It is also the row the salon band is defined by, which
   * makes it the one that describes the columns beneath it.
   */
  const dimensions = resolveDimensionColumns(headerCells(sheet, headerRow, 1, bandEnd));
  const metrics = resolveYtdColumns(headerCells(sheet, headerRow, 1, sheet.columnCount));

  return {
    sheet,
    headerRow,
    firstDataRow: headerRow + 1,
    dimensions,
    metrics,
    columnsScanned: sheet.columnCount,
  };
}

/**
 * Does this sheet's name look like the year-to-date source?
 *
 * Anchored, so `CompReport(MTD)` and `CompReport(MTD) vs 2024` cannot match.
 * The three sheets live in one workbook and a loose test would let each parser
 * claim another's sheet, with whichever ran first winning.
 */
function nameLooksPreferred(name: string): boolean {
  return /^comp\s*report\s*ytd$/.test(normalizeHeader(name));
}

interface SheetMarkers {
  identityMatched: string[];
  identityMissing: string[];
  /** Not an identity marker — see the rolling parser's note on the same field. */
  periodMarker: string | null;
}

/** True when the sheet carries a readable marker for a DIFFERENT grain. */
function statesAnotherGrain(sheet: SheetView): boolean {
  for (const grain of ["mtd"] as const) {
    try {
      detectPeriod(sheet, { headerRow: PERIOD_SEARCH_ANCHOR_ROW, expectedGrain: grain });
      return true;
    } catch {
      // Not that grain either; fall through.
    }
  }
  return false;
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
   * The resolver drops the later occurrence, so a duplicate could otherwise
   * read as a missing core measure and the sheet would be rejected as
   * unrecognised. It is nothing of the kind — it is plainly the year-to-date
   * sheet with a template problem `parse` can describe precisely.
   */
  const presentCodes = new Set([
    ...analysis.metrics.resolved.map((entry) => entry.mapping.code),
    ...analysis.metrics.duplicates.map((entry) => entry.dropped.mapping.code),
  ]);
  const missingCore = REQUIRED_YTD_METRICS.filter((code) => !presentCodes.has(code));
  if (missingCore.length === 0) {
    identityMatched.push(
      `year-to-date measure headers (${analysis.metrics.resolved.length} columns)`,
    );
  } else {
    identityMissing.push(`year-to-date measure headers: ${missingCore.join(", ")}`);
  }

  /**
   * THE GRAIN IS AN IDENTITY MARKER HERE, and on no other parser — but only
   * when the sheet states a grain that is not ours.
   *
   * `CompReport(YTD)` shares its descriptor band and most of its measure
   * headers with `CompReport(MTD)`, so structure alone does not separate them.
   * What does is the period marker's grain word. Without this check a
   * year-to-date parser pointed at the month-to-date sheet would match every
   * structural marker and then file a month of figures as a year — overstating
   * each by roughly a factor of nine.
   *
   * THREE OUTCOMES, and the third is why this is not a plain identity check:
   *
   *   a readable year-to-date marker — this is our sheet;
   *   a readable marker that says something else — NOT our sheet, so identity
   *     fails and the caller is told the structure did not match;
   *   NO readable marker at all — still our sheet, with one bad cell. Calling
   *     that "template drift" would send an operator looking for a changed
   *     template, so identity passes and `parse` raises the precise
   *     `period_unreadable` instead.
   */
  let periodMarker: string | null = null;
  try {
    periodMarker = detectPeriod(sheet, {
      headerRow: PERIOD_SEARCH_ANCHOR_ROW,
      expectedGrain: EXPECTED_GRAIN,
    }).cell;
  } catch {
    periodMarker = null;
  }
  if (periodMarker === null && statesAnotherGrain(sheet)) {
    identityMissing.push("year-to-date period marker (this sheet states another grain)");
  }

  return { identityMatched, identityMissing, periodMarker };
}

/**
 * STRUCTURAL DETECTION.
 *
 * The sheet NAME orders the candidates and is never sufficient on its own. A
 * named candidate that fails is `template_drift` (this parser is out of date);
 * anything else is `unsupported` (wrong file).
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
            ? `year-to-date period marker (${markers.periodMarker})`
            : "year-to-date period marker: UNREADABLE — parsing will reject this file",
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
        `Sheet "${driftCandidate.sheetName}" is named like the year-to-date Comp Report but ` +
        `no longer matches the structure this parser reads. The template has probably changed.`,
      markersMissing: driftCandidate.markersMissing,
    };
  }

  return {
    supported: false,
    kind: "unsupported",
    sheetName: null,
    reason:
      "No sheet in this workbook matches the year-to-date Comp Report structure: a " +
      "descriptor band with salon number and store name, the year-to-date measure headers, " +
      "and a period marked YTD.",
    markersMissing: ["comp sales year-to-date sheet structure"],
  };
}

/** The last row holding anything at all, so trailing padding can be named. */
function lastPopulatedRow(analysis: YtdAnalysis): number {
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
    headerRow: PERIOD_SEARCH_ANCHOR_ROW,
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

  /**
   * A DUPLICATE INSIDE THE LIVE BAND FAILS THE INGESTION.
   *
   * Warning and continuing is right for a read and not enough for an ingestion:
   * a measure that resolved twice at the same basis year means the template is
   * not the one this parser was written against, and loading six of eight
   * measures would leave a view that looks complete and is not.
   *
   * The AJ/AK columns do NOT reach here. `AJ` is a duplicate of `AG` and is
   * dropped by the resolver before the band is settled, and `AK` is dropped for
   * having no baseline — both with warnings. Only a duplicate that survives
   * into the live band, which would be genuine drift, throws.
   */
  const liveColumns = new Set(analysis.metrics.resolved.map((entry) => entry.letter));
  const liveDuplicates = analysis.metrics.duplicates.filter((pair) =>
    liveColumns.has(pair.kept.letter),
  );
  if (liveDuplicates.length > 0) {
    throw new ReportParseError(
      "template_drift",
      `The measure band maps ${liveDuplicates.length === 1 ? "a measure" : "measures"} more ` +
        `than once inside the live block, so which column is authoritative cannot be ` +
        `determined. Affected: ` +
        `${[...new Set(liveDuplicates.map((pair) => pair.dropped.mapping.code))].join(", ")}.`,
      {
        details: liveDuplicates.map(
          (pair) =>
            `${pair.dropped.mapping.code} (${pair.dropped.basisYear ?? "no year"}): ` +
            `columns ${pair.kept.letter}, ${pair.dropped.letter}`,
        ),
      },
    );
  }

  const missingCore = REQUIRED_YTD_METRICS.filter(
    (code) => !analysis.metrics.resolved.some((entry) => entry.mapping.code === code),
  );
  if (missingCore.length > 0) {
    throw new ReportParseError(
      "template_drift",
      `The sheet is missing year-to-date measures this parser requires: ${missingCore.join(", ")}.`,
    );
  }

  /**
   * A BASELINE YEAR NOBODY EXPECTED IS DRIFT, NOT DATA.
   *
   * The audited sheet compares 2026 against 2025 and nothing else. A future
   * template that rolls the years forward is fine and will simply report the
   * new pair; a template that introduces a THIRD baseline is a change in what
   * the report means, and the figures should be reviewed before they are
   * published rather than after.
   */
  const basisYears = [
    ...new Set(
      analysis.metrics.resolved
        .map((entry) => entry.basisYear)
        .filter((year): year is number => year !== null),
    ),
  ].sort((a, b) => a - b);
  if (basisYears.length > 2) {
    throw new ReportParseError(
      "template_drift",
      `The sheet reports ${basisYears.length} basis years (${basisYears.join(", ")}). This ` +
        `report compares one year against one baseline; a third means the template has ` +
        `changed and the mapping must be reviewed before ingestion.`,
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
    const rowHasAnyMetric = analysis.metrics.resolved.some(
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
      // A pre-numbered template slot, not a row that lost its key.
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

    for (const entry of analysis.metrics.resolved) {
      const cell = sheet.cell(row, entry.column);
      // An empty measure is an ABSENT fact, not a zero, and an explicit `n/a` is
      // the same fact stated out loud. Five salons report no 2025 spa-session
      // change because their 2025 figure is a real zero — the change is
      // undefined, and no fact is the honest answer.
      if (cell.kind === "empty" || isNullPlaceholder(cell)) continue;

      const value = asNumber(cell);
      if (value === null) {
        warnings.push({
          code: "malformed_metric_value",
          message:
            `${entry.mapping.code} on row ${row} (column ${entry.letter}) is not a number, ` +
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

  // Drift signal against the audited layout. Resolution is by header, so a move
  // is reported rather than acted on.
  for (const entry of analysis.metrics.resolved) {
    const expected = OBSERVED_YTD_COLUMNS[`${entry.mapping.code}|${entry.basisYear ?? ""}`];
    if (expected && expected !== entry.letter) {
      warnings.push({
        code: "unexpected_metric_column",
        message:
          `"${entry.mapping.label}" (basis ${entry.basisYear ?? "none"}) resolved at column ` +
          `${entry.letter}; the audit observed it at ${expected}. Resolved by header, so the ` +
          `figure is correct — the template has shifted.`,
        column: entry.letter,
      });
    }
  }

  return {
    parserKey: YTD_PARSER_KEY,
    parserVersion: YTD_PARSER_VERSION,
    reportFamily: YTD_FAMILY,
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
      unresolvedColumns: analysis.dimensions.unresolved.map((cell) => ({
        column: cell.letter,
        header: cell.header,
      })),
      separatorColumns: analysis.metrics.separators,
      salonRowsParsed: salons.length,
      factsProduced: facts.length,
      // Every duplicate in the live band, every missing core measure and every
      // unexpected basis year has already thrown.
      requiresReview: false,
    },
  };
}

export const compSalesYtdParser: SingleSheetParser = {
  key: YTD_PARSER_KEY,
  version: YTD_PARSER_VERSION,
  family: YTD_FAMILY,
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
