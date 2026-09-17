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
import {
  DIMENSION_BAND_END,
  resolveDimensionColumns,
  type DimensionResolution,
} from "./dimensions";
import {
  REQUIRED_CORE_METRICS,
  resolveMetricColumns,
  type MetricResolution,
  type ResolvedMetricColumn,
} from "./metric-map";
import {
  assertNoDuplicateSalons,
  candidateSalonRows,
  findDescriptorHeaderRow,
  headerCells,
  readDimension,
  TOTALS_ROW_PATTERN,
} from "./salon-band";

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
/**
 * ============================================================================
 * PARSER VERSION — WHAT THIS PARSER PRODUCES, NOT WHEN IT WAS EDITED
 * ============================================================================
 *
 * The version is part of the ingestion's identity: `begin_report_ingestion`
 * refuses a file that already has a SUCCEEDED attempt at the same
 * `(file_id, parser_key, parser_version)`. So a version that does not move when
 * the OUTPUT moves has two costs — the lineage records a fact set under a
 * version that never produced it, and the affected file cannot be re-read to
 * replace what the old version wrote.
 *
 *   v1  Every column the sheet's headers resolved, filed under whatever basis
 *       year those headers named.
 *
 *   v2  Excludes a basis-year block that repeats another year's figures measure
 *       for measure and salon for salon (`excludeMirroredBasisYears`). v1 read
 *       the September delivery's stale "2019" headers at face value and wrote
 *       210 facts that were bit-identical to the 2024 facts beside them, which
 *       the app then offered as a "2019 baseline" comparison.
 *
 * A FILE INGESTED AT v1 IS NOT CORRECTED BY THIS BUMP. Supersession is scoped
 * to a period, its salons and the sheets a report read, so the v1 facts stay
 * live for their own period until that same file is ingested again — which this
 * bump is what makes possible.
 */
export const COMP_SALES_PARSER_VERSION = 2;
export const COMP_SALES_FAMILY = "comp_sales";
export const COMP_SALES_PREFERRED_SHEET = "CompReport(MTD) vs 2024";
const EXPECTED_GRAIN: ReportPeriodGrain = "mtd";

/**
 * The salon-number text key, copied from `salons_salon_number_format` in
 * `20260831001200_reporting_dimensions.sql`. A value that fails here is skipped
 * rather than repaired: the alternative is guessing at a store's identity.
 */
export { SALON_NUMBER_PATTERN } from "../salon-number";

interface SheetAnalysis {
  sheet: SheetView;
  /** Row carrying the descriptor (A-T) headers. */
  headerRow: number;
  /** Row carrying the measure headers; may be well above `headerRow`. */
  metricHeaderRow: number;
  firstDataRow: number;
  dimensions: DimensionResolution;
  metrics: MetricResolution;
  /** Column index where the measure blocks begin. */
  metricBandStart: number;
  columnsScanned: number;
}

/**
 * Analyses one sheet without deciding whether it is acceptable. Returns null
 * only when no header row exists at all — every other judgement belongs to
 * `detect`, so the marker list can be reported in full.
 */
function analyzeSheet(sheet: SheetView): SheetAnalysis | null {
  const bandEnd = Math.min(DIMENSION_BAND_END, Math.max(sheet.columnCount, 1));
  const headerRow = findDescriptorHeaderRow(sheet, bandEnd);
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

  // THE MEASURE HEADER ROW IS THE ONE NEAREST THE DATA.
  //
  // The audited sheet carries measure headers on TWO rows, and they disagree:
  //
  //   row 1  heads the summary block (filtered totals, averages, age cohorts,
  //          quintiles) that occupies rows 2-32. Its far-right columns read
  //          "2025 Spa Sessions" / "2023 Spa Sessions".
  //   row 34 heads the SALON DATA BAND beginning at row 35, carries the
  //          descriptor headers too, and its same far-right columns read
  //          "2026 Spa Sessions" / "2024 Spa Sessions".
  //
  // So the choice is load-bearing, not cosmetic: reading row 1 would stamp the
  // data band's spa figures with basis years 2025 and 2023 — wrong years, on
  // real numbers, with no error anywhere. Picking whichever row resolves the
  // MOST headers would be a coin toss decided by template debris.
  //
  // Adjacency settles it. A header row describes the rows beneath it until the
  // next header row, so the row nearest the data band governs the data band.
  // We therefore start at the descriptor header row and walk UPWARDS, taking
  // the first row that resolves the required core measures. Single-header
  // templates satisfy this on the first attempt.
  let metricHeaderRow = headerRow;
  let metrics: MetricResolution = {
    resolved: [],
    duplicates: [],
    unresolved: [],
    separators: [],
    warnings: [],
  };
  if (metricBandStart <= sheet.columnCount) {
    for (let row = headerRow; row >= 1; row -= 1) {
      const candidate = resolveMetricColumns(
        headerCells(sheet, row, metricBandStart, sheet.columnCount),
      );
      const resolvedCodes = new Set(candidate.resolved.map((entry) => entry.mapping.code));
      const hasCore = REQUIRED_CORE_METRICS.every((code) => resolvedCodes.has(code));
      if (hasCore) {
        metrics = candidate;
        metricHeaderRow = row;
        break;
      }
      // Keep the best partial result, so a template that never satisfies the
      // core check still reports what it did find rather than nothing.
      if (candidate.resolved.length > metrics.resolved.length) {
        metrics = candidate;
        metricHeaderRow = row;
      }
    }
  }

  return {
    sheet,
    headerRow,
    metricHeaderRow,
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
      headerRow: analysis.metricHeaderRow,
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

/**
 * CLASSIFIES EVERY DUPLICATE COLUMN BY COMPARING ITS DATA.
 *
 * The audited workbook contains both kinds of duplicate, and header text cannot
 * tell them apart:
 *
 *   BENIGN REDUNDANCY — a second copy of a column holding the same figures.
 *     (BR..BT repeat the spa-session block verbatim.)
 *
 *   A STALE MIS-HEADED COLUMN — a header left behind by a template
 *     roll-forward, whose data belongs to a different year than it claims.
 *     Seven columns headed "2024 <measure>" in the audited sheet hold values
 *     IDENTICAL to the 2026 current-year columns and differ from the true 2024
 *     columns on every row. Their headers lie.
 *
 * That second kind is the most dangerous defect a header-primary parser can
 * meet, because the header is exactly what it trusts. The dropped column
 * happens to be excluded already — the leftmost duplicate wins — but "we got
 * lucky about column order" is not a guarantee, so the exclusion is proven here
 * instead of assumed.
 *
 * A duplicate whose values differ AND which matches no other basis year is
 * unexplained: the parser cannot tell which column is authoritative, so it says
 * so and marks the report for review rather than choosing.
 */
function verifyDuplicateColumns(
  sheet: SheetView,
  metrics: MetricResolution,
  salonRows: number[],
  warnings: ParserWarning[],
): { requiresReview: boolean } {
  let requiresReview = false;
  if (salonRows.length === 0) return { requiresReview };

  const valuesOf = (column: number): (number | null)[] =>
    salonRows.map((row) => asNumber(sheet.cell(row, column)));

  const agree = (a: (number | null)[], b: (number | null)[]): boolean =>
    a.every((value, index) => {
      const other = b[index];
      if (value === null && other === null) return true;
      if (value === null || other === null) return false;
      return Math.abs(value - other) < 1e-9;
    });

  for (const pair of metrics.duplicates) {
    const droppedValues = valuesOf(pair.dropped.column);
    if (agree(valuesOf(pair.kept.column), droppedValues)) {
      // Same metric, same year, same numbers: a redundant copy. Already
      // excluded, and nothing is at stake.
      continue;
    }

    // The values differ. Does the dropped column actually belong to a DIFFERENT
    // basis year that this sheet also reports? If so its header is stale, and
    // excluding it was correct for a reason we can now state.
    const impostorFor = metrics.resolved.find(
      (candidate) =>
        candidate.mapping.code === pair.dropped.mapping.code &&
        candidate.basisYear !== pair.dropped.basisYear &&
        agree(valuesOf(candidate.column), droppedValues),
    );

    if (impostorFor) {
      warnings.push({
        code: "stale_header_suspected",
        message:
          `Column ${pair.dropped.letter} is headed "${pair.dropped.header}" but its values ` +
          `are identical to column ${impostorFor.letter} (basis ` +
          `${impostorFor.basisYear ?? "none"}) and differ from column ${pair.kept.letter}, ` +
          `which its header claims to duplicate. The header is stale — probably left by a ` +
          `template roll-forward — so the column was EXCLUDED. Column ${pair.kept.letter} ` +
          `is the authoritative ${pair.dropped.basisYear ?? "?"} figure.`,
        column: pair.dropped.letter,
      });
      continue;
    }

    // Unexplained: two columns, same metric and year, different numbers, and no
    // evidence which is right. Refuse to decide.
    requiresReview = true;
    warnings.push({
      code: "conflicting_metric_column",
      message:
        `Columns ${pair.kept.letter} and ${pair.dropped.letter} both claim ` +
        `"${pair.dropped.mapping.label}" for basis year ${pair.dropped.basisYear ?? "none"} ` +
        `but hold different values, and nothing identifies which is authoritative. ` +
        `Column ${pair.kept.letter} was used; this report needs review before the figures ` +
        `are trusted.`,
      column: pair.dropped.letter,
    });
  }

  return { requiresReview };
}

/**
 * ============================================================================
 * A BASIS-YEAR BLOCK THAT IS A COPY OF ANOTHER YEAR'S
 * ============================================================================
 *
 * WHAT THIS CAUGHT. The deployed database holds, for the September delivery,
 * 210 facts filed under basis year 2019 — fourteen measures across fifteen
 * salons — every one of which is bit-identical to the 2024 fact beside it. The
 * app therefore offered a "2019 baseline" comparison whose figures were the
 * 2024 comparison, and nothing on the page said so.
 *
 * WHERE IT COMES FROM. The source workbook itself. Row 34 of
 * `CompReport(MTD) vs 2024` heads columns AU..BO `2024 OTC Revenue`,
 * `2019 OTC Revenue`, `TY vs 2019 % Change` and so on — a template roll-forward
 * whose year labels were never updated — and every one of those columns holds
 * the 2024 figure. Verified on rows 35..49 of the 09-08 and 09-10 deliveries:
 * AV equals V, BB equals AB, BC equals AC, for all seven measures on all
 * fifteen salons. The headers lie, and the parser believed them.
 *
 * WHY NEITHER EXISTING GUARD SAW IT. `verifyDuplicateColumns` compares columns
 * that claim the same measure AND the same year; these claim different years,
 * so no collision is ever registered. `out_of_band_column` excludes a remnant
 * separated from the live band by a wide run of unheaded columns, and this
 * remnant is CONTIGUOUS with it — AR to AU is a two-column gap, well inside the
 * band tolerance, so the clustering correctly sees one band. Both guards are
 * right about what they check and both are blind to this.
 *
 * THE EVIDENCE IS THE AGREEMENT ITSELF. Two genuinely different years cannot
 * produce identical figures for a dozen measures on every salon; one measure
 * could coincide, and fourteen cannot. So the parser does not need to know
 * which template drifted — the repetition proves one block's year labels are
 * wrong.
 *
 * WHICH BLOCK IS DROPPED. The one that begins further right. The live band is
 * written first and template debris accumulates to the right of it, never to
 * the left — the same convention `out_of_band_column` already states and the
 * same one the duplicate rule follows in keeping the leftmost column.
 *
 * NOT BLOCKING, deliberately. `requiresReview` REFUSES the delivery, and the
 * block being repeated is good data: refusing September's Comp Report over a
 * remnant would cost the report every figure it got right. The mirror is
 * dropped, the warning names both years and both column ranges, and the rest
 * of the delivery lands.
 */

/** Shared measures below this could agree by chance; a dozen cannot. */
const MIRROR_MIN_SHARED_MEASURES = 3;

function excludeMirroredBasisYears(
  sheet: SheetView,
  metrics: MetricResolution,
  salonRows: number[],
  warnings: ParserWarning[],
): void {
  if (salonRows.length === 0) return;

  const byYear = new Map<number, ResolvedMetricColumn[]>();
  for (const entry of metrics.resolved) {
    if (entry.basisYear === null) continue;
    const bucket = byYear.get(entry.basisYear);
    if (bucket) bucket.push(entry);
    else byYear.set(entry.basisYear, [entry]);
  }
  if (byYear.size < 2) return;

  const valuesOf = (column: number): (number | null)[] =>
    salonRows.map((row) => asNumber(sheet.cell(row, column)));

  const years = [...byYear.keys()].sort((a, b) => a - b);
  const dropped = new Set<number>();

  for (let i = 0; i < years.length; i += 1) {
    for (let j = i + 1; j < years.length; j += 1) {
      const left = byYear.get(years[i])!;
      const right = byYear.get(years[j])!;
      if (dropped.has(years[i]) || dropped.has(years[j])) continue;

      const rightByCode = new Map(right.map((entry) => [entry.mapping.code, entry]));
      let comparable = 0;
      let agreed = 0;

      for (const entry of left) {
        const other = rightByCode.get(entry.mapping.code);
        if (!other) continue;
        const a = valuesOf(entry.column);
        const b = valuesOf(other.column);
        /*
         * TWO EMPTY COLUMNS ARE NOT EVIDENCE. A measure neither block reports
         * agrees trivially, and counting it would let a pair of mostly-absent
         * blocks reach the threshold on nothing at all.
         */
        const bothPresent = a.some((value, index) => value !== null && b[index] !== null);
        if (!bothPresent) continue;
        comparable += 1;
        const same = a.every((value, index) => {
          const other2 = b[index];
          if (value === null && other2 === null) return true;
          if (value === null || other2 === null) return false;
          return Math.abs(value - other2) < 1e-9;
        });
        if (same) agreed += 1;
      }

      if (comparable < MIRROR_MIN_SHARED_MEASURES || agreed !== comparable) continue;

      // The block that starts further right is the remnant.
      const startOf = (block: ResolvedMetricColumn[]) =>
        Math.min(...block.map((entry) => entry.column));
      const mirrorYear = startOf(left) > startOf(right) ? years[i] : years[j];
      const keptYear = mirrorYear === years[i] ? years[j] : years[i];
      const mirror = byYear.get(mirrorYear)!;
      const letters = [...mirror]
        .sort((a, b) => a.column - b.column)
        .map((entry) => entry.letter);

      dropped.add(mirrorYear);
      warnings.push({
        code: "mirrored_basis_year",
        message:
          `Columns ${letters[0]}..${letters[letters.length - 1]} are headed as the ` +
          `${mirrorYear} baseline, but every one of their ${comparable} measures holds ` +
          `values identical to the ${keptYear} baseline on all ${salonRows.length} salons. ` +
          `Two different years cannot agree that closely, so the ${mirrorYear} headers are ` +
          `stale — probably left by a template roll-forward. The ${mirrorYear} block was ` +
          `EXCLUDED; the ${keptYear} figures are unaffected.`,
        column: letters[0],
      });
    }
  }

  if (dropped.size === 0) return;
  for (let index = metrics.resolved.length - 1; index >= 0; index -= 1) {
    const entry = metrics.resolved[index];
    if (entry.basisYear !== null && dropped.has(entry.basisYear)) {
      metrics.resolved.splice(index, 1);
      metrics.unresolved.push({
        column: entry.column,
        letter: entry.letter,
        header: entry.header,
      });
    }
  }
}

function parseSheet(sheet: SheetView): ParsedReport {
  const analysis = analyzeSheet(sheet);
  if (!analysis) {
    throw new ReportParseError(
      "template_drift",
      "The sheet has no header row with both a salon-number and a store-name column.",
    );
  }

  // Anchored on the measure header row: the audited sheet's period marker sits
  // in F1 alongside the measure headers, and widening the search to everything
  // above the descriptor row at line 34 would drag in the summary block.
  const period = detectPeriod(sheet, {
    headerRow: analysis.metricHeaderRow,
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

  // Columns already carrying a SPECIFIC explanation — a duplicate, a stale
  // header, an out-of-band remnant — must not also collect the generic
  // "not a supported metric" line. It is untrue of them (they resolved fine;
  // they were excluded for a stated reason) and it buries the real finding.
  const explained = new Set(
    analysis.metrics.warnings.map((warning) => warning.column).filter((column): column is string => Boolean(column)),
  );
  for (const cell of analysis.metrics.unresolved) {
    if (explained.has(cell.letter)) continue;
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

  // A cheap pre-pass over the rows that look like salons, so duplicate columns
  // can be classified against real data before any fact is produced — and so a
  // duplicate salon number fails the ingestion before a single fact exists.
  const salonRows = candidateSalonRows(sheet, salonColumn.column, analysis.firstDataRow);
  assertNoDuplicateSalons(sheet, salonColumn.column, salonRows);

  const { requiresReview } = verifyDuplicateColumns(
    sheet,
    analysis.metrics,
    salonRows,
    warnings,
  );

  /*
   * AFTER the duplicate pass, because that one settles which column owns a
   * given measure-and-year and this one compares whole years against each
   * other. Running it first would compare blocks that still contain columns
   * the duplicate rule is about to drop.
   */
  excludeMirroredBasisYears(sheet, analysis.metrics, salonRows, warnings);

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
      // A PRE-NUMBERED TEMPLATE SLOT vs. A ROW THAT LOST ITS KEY.
      //
      // The audited workbook's template runs to 116 salon slots, each carrying
      // reference values, and this recipient's copy fills 15 of them. The other
      // 101 are unused capacity, not rows whose salon number went missing —
      // reporting them as the latter would suggest data loss where there is
      // none, and would bury a genuine missing key among a hundred non-events.
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
      //
      // An explicit `n/a` is the same fact stated out loud — the audited sheet
      // uses it for salons the measure does not apply to — so it is absent
      // rather than malformed, and produces no warning.
      if (cell.kind === "empty" || isNullPlaceholder(cell)) continue;

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
      metricHeaderRow: analysis.metricHeaderRow,
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
      requiresReview,
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
