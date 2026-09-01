import { ReportParseError } from "./errors";
import { selectParser, type DetectionResult, type ReportParser } from "./parser";
import { compSalesReportParser } from "./comp-sales/parser";
import { compSalesRollingParser } from "./comp-sales/rolling-parser";
import { compSalesYtdParser } from "./comp-sales/ytd-parser";
import type { ParsedReport } from "./types";
import { readWorkbook, type WorkbookView } from "./workbook";

export * from "./errors";
export * from "./types";
export * from "./parser";
export {
  readWorkbook,
  sheetViewFromGrid,
  columnLetter,
  columnIndex,
  type CellValue,
  type SheetView,
  type WorkbookView,
} from "./workbook";
export { detectPeriod, periodFromMarker, parseMarkerDate, parseMonthMarker } from "./period";
export {
  compSalesReportParser,
  COMP_SALES_PARSER_KEY,
  COMP_SALES_PARSER_VERSION,
  COMP_SALES_FAMILY,
  COMP_SALES_PREFERRED_SHEET,
  SALON_NUMBER_PATTERN,
} from "./comp-sales/parser";
export {
  COMP_SALES_METRICS,
  METRICS_BY_CODE,
  REQUIRED_CORE_METRICS,
  resolveMetricColumns,
  type MetricMapping,
} from "./comp-sales/metric-map";
export { DIMENSION_FIELDS, DIMENSION_BAND_END } from "./comp-sales/dimensions";
export {
  compSalesRollingParser,
  ROLLING_PARSER_KEY,
  ROLLING_PARSER_VERSION,
  ROLLING_PREFERRED_SHEET,
  ROLLING_METRIC_CODES,
  REQUIRED_ROLLING_METRICS,
} from "./comp-sales/rolling-parser";
export {
  compSalesYtdParser,
  YTD_PARSER_KEY,
  YTD_PARSER_VERSION,
  YTD_PREFERRED_SHEET,
  YTD_MEASURE_CODES,
  REQUIRED_YTD_METRICS,
} from "./comp-sales/ytd-parser";
export {
  resolveYtdColumns,
  isTrailingWindowHeader,
  OBSERVED_YTD_COLUMNS,
  YTD_RESOLVE_OPTIONS,
} from "./comp-sales/ytd-map";
export {
  resolveRollingColumns,
  rollingMetricCode,
  ROLLING_MEASURES,
  ROLLING_WINDOWS,
  OBSERVED_ROLLING_COLUMNS,
} from "./comp-sales/rolling-map";

/**
 * THE PARSER REGISTRY.
 *
 * One entry per SHEET a report family reads. Adding KPI, Personal Bonus or Salon
 * Bonus means adding a module and one line here — no existing parser is touched,
 * and there is no conditional in a shared parse function to extend.
 *
 * THREE PARSERS NOW READ THE SAME WORKBOOK, and that changes how selection has
 * to work. The Comp Report file contains `CompReport(MTD) vs 2024`,
 * `CompReport(MTD)` and `CompReport(YTD)`; each parser detects its own sheet, so
 * ALL THREE succeed on the same bytes. Automatic selection would therefore
 * always return whichever is listed first, and the other two sheets could never
 * be ingested at all.
 *
 * So a caller that knows which sheet it wants NAMES THE PARSER, and automatic
 * selection is only the fallback for a caller that does not. That is why
 * `parserKey` threads all the way from the ingest route: choosing the view is a
 * decision, not something to be inferred from a file that contains both.
 */
export const REPORT_PARSERS: readonly ReportParser[] = [
  compSalesReportParser,
  compSalesRollingParser,
  compSalesYtdParser,
];

/** The registered parser with this key, or null. */
export function parserByKey(key: string): ReportParser | null {
  return REPORT_PARSERS.find((parser) => parser.key === key) ?? null;
}

/** Parsers to consider: the named one alone, or all of them. */
function candidateParsers(parserKey?: string | null): readonly ReportParser[] {
  if (!parserKey) return REPORT_PARSERS;
  const named = parserByKey(parserKey);
  // An unknown key returns nothing rather than silently falling back to every
  // parser: a caller that asked for a specific view and got another one would
  // file the wrong sheet's figures under it.
  return named ? [named] : [];
}

/** Which parser, if any, recognises this workbook. Never throws. */
export function detectReport(
  workbook: WorkbookView,
  options: { parserKey?: string | null } = {},
): DetectionResult {
  const parsers = candidateParsers(options.parserKey);
  if (parsers.length === 0) {
    return {
      supported: false,
      kind: "unsupported",
      sheetName: null,
      reason: `No parser is registered under the key "${options.parserKey}".`,
      markersMissing: ["known parser key"],
    };
  }
  const selection = selectParser(workbook, parsers);
  if (selection.parser) {
    return { supported: true, sheetName: selection.detection.sheetName, markersMatched: selection.detection.markersMatched };
  }
  // Prefer a drift rejection: "our parser is out of date" is more actionable
  // than "unrecognised file", and it is the more specific claim.
  const drift = selection.rejections.find((rejection) => rejection.kind === "template_drift");
  return drift ?? selection.rejections[0] ?? {
    supported: false,
    kind: "unsupported",
    sheetName: null,
    reason: "No report parsers are registered.",
    markersMissing: [],
  };
}

/**
 * Reads workbook bytes and returns a `ParsedReport`.
 *
 * NO DATABASE, NO STORAGE, NO NETWORK. Persisting the result is the job of a
 * `ReportingRepository`, which does not exist yet — keeping that boundary is
 * what lets the whole parser be tested from a byte array.
 */
export async function parseReportWorkbook(
  buffer: Uint8Array,
  options: { parserKey?: string | null } = {},
): Promise<ParsedReport> {
  const workbook = await readWorkbook(buffer);
  const parsers = candidateParsers(options.parserKey);
  if (parsers.length === 0) {
    throw new ReportParseError(
      "unsupported_workbook",
      `No parser is registered under the key "${options.parserKey}".`,
    );
  }
  const selection = selectParser(workbook, parsers);
  if (!selection.parser) {
    const drift = selection.rejections.find((rejection) => rejection.kind === "template_drift");
    const chosen = drift ?? selection.rejections[0];
    throw new ReportParseError(
      chosen?.kind === "template_drift" ? "template_drift" : "unsupported_workbook",
      chosen?.reason ?? "No registered parser recognised this workbook.",
      { details: chosen?.markersMissing ?? [] },
    );
  }
  return selection.parser.parse(workbook);
}
