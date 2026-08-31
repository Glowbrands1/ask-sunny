import type { ParsedReport } from "./types";
import type { SheetView, WorkbookView } from "./workbook";

/**
 * THE PARSER SEAM.
 *
 * One parser per REPORT FAMILY, registered in `index.ts`. KPI, Personal Bonus
 * and Salon Bonus each become a new module implementing this interface; none of
 * them touches this file, and none of them touches `CompSalesReportParser`.
 *
 * Deliberately NOT one parser with a growing `if (sheetName === ...)` chain.
 * Every report family has its own header vocabulary, its own period convention
 * and its own fact table, and a shared conditional parser would end up with all
 * of them interleaved — the point at which nobody can change one report without
 * risking the others.
 *
 * `detect` is separate from `parse` so a caller can ask "can anything here read
 * this file?" cheaply, and so a failed detection can name the specific
 * structural marker that was missing rather than dying inside a parse.
 */

export interface SheetDetection {
  supported: true;
  /** The sheet this parser would read. */
  sheetName: string;
  /** Structural markers that were confirmed. Shown to an operator. */
  markersMatched: string[];
}

export interface SheetRejection {
  supported: false;
  /**
   * `template_drift` when a sheet was clearly the right one but its structure
   * has moved; `unsupported` when nothing here looks like this report at all.
   * The distinction drives a different operational response.
   */
  kind: "unsupported" | "template_drift";
  /** The best candidate examined, when there was one. */
  sheetName: string | null;
  reason: string;
  /** Which markers failed, for a drift report. */
  markersMissing: string[];
}

export type DetectionResult = SheetDetection | SheetRejection;

export interface ReportParser {
  /** Stable machine name recorded on every ingestion. */
  readonly key: string;
  /**
   * Bumped whenever a change alters the figures this parser produces. It is
   * part of an ingestion's identity: re-reading the same bytes with a newer
   * version is legitimate work that supersedes, rather than a duplicate.
   */
  readonly version: number;
  /** Which fact family the output belongs to, e.g. `comp_sales`. */
  readonly family: string;
  /** Cheap structural probe. Never throws for an unrecognised workbook. */
  detect(workbook: WorkbookView): DetectionResult;
  /** Full parse. Throws `ReportParseError` when the report cannot be trusted. */
  parse(workbook: WorkbookView): ParsedReport;
}

/**
 * A parser that works from a single sheet — all of them, so far. Splitting this
 * out keeps `detect`/`parse` from each having to re-locate the sheet.
 */
export interface SingleSheetParser extends ReportParser {
  parseSheet(sheet: SheetView): ParsedReport;
}

/** Picks the first registered parser that recognises the workbook. */
export function selectParser(
  workbook: WorkbookView,
  parsers: readonly ReportParser[],
): { parser: ReportParser; detection: SheetDetection } | { parser: null; rejections: SheetRejection[] } {
  const rejections: SheetRejection[] = [];
  for (const parser of parsers) {
    const result = parser.detect(workbook);
    if (result.supported) return { parser, detection: result };
    rejections.push(result);
  }
  return { parser: null, rejections };
}
