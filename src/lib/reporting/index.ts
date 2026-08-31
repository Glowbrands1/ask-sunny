import { ReportParseError } from "./errors";
import { selectParser, type DetectionResult, type ReportParser } from "./parser";
import { compSalesReportParser } from "./comp-sales/parser";
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
export { detectPeriod, periodFromMarker, parseMarkerDate } from "./period";
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

/**
 * THE PARSER REGISTRY.
 *
 * One entry per report family. Adding KPI, Personal Bonus or Salon Bonus means
 * adding a module and one line here — no existing parser is touched, and there
 * is no conditional in a shared parse function to extend.
 *
 * Order matters only as a tie-break: each parser's `detect` is structural, so
 * two parsers should never both claim a sheet. If they ever do, the first wins
 * and that is a bug in whichever detection is too loose.
 */
export const REPORT_PARSERS: readonly ReportParser[] = [compSalesReportParser];

/** Which parser, if any, recognises this workbook. Never throws. */
export function detectReport(workbook: WorkbookView): DetectionResult {
  const selection = selectParser(workbook, REPORT_PARSERS);
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
export async function parseReportWorkbook(buffer: Uint8Array): Promise<ParsedReport> {
  const workbook = await readWorkbook(buffer);
  const selection = selectParser(workbook, REPORT_PARSERS);
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
