/**
 * Errors the reporting parsers raise. Messages are user-safe: they describe the
 * SHAPE of the problem and never echo a figure, a salon name or a manager name
 * out of the workbook, because these strings reach an admin screen and a log.
 */

export type ReportParseErrorCode =
  /** The bytes are not a readable workbook at all. */
  | "workbook_unreadable"
  /** No registered parser recognised any sheet in the workbook. */
  | "unsupported_workbook"
  /**
   * A sheet was recognised by name but its structure no longer matches what the
   * parser was written against. Distinguished from `unsupported_workbook`
   * because it means "our parser is out of date", not "wrong file" — a
   * different operational response.
   */
  | "template_drift"
  /** The reporting period marker is missing, or present and not parseable. */
  | "period_unreadable"
  /** The sheet was recognised but contained no usable salon rows. */
  | "no_data_rows";

export class ReportParseError extends Error {
  readonly code: ReportParseErrorCode;
  /** HTTP status an ingest route should answer with. */
  readonly status: number;
  /**
   * Structural detail for an operator: which markers failed, which sheet was
   * examined. Never contains cell values from the data band.
   */
  readonly details: string[];

  constructor(
    code: ReportParseErrorCode,
    message: string,
    options?: { status?: number; details?: string[]; cause?: unknown },
  ) {
    super(message, { cause: options?.cause });
    this.name = "ReportParseError";
    this.code = code;
    this.status = options?.status ?? 422;
    this.details = options?.details ?? [];
  }
}

export function isReportParseError(error: unknown): error is ReportParseError {
  return error instanceof ReportParseError;
}
