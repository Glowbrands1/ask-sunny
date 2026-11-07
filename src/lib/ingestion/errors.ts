/** Error classes the ingestion pipeline raises. Messages are user-safe. */

export type IngestionErrorCode =
  | "unsupported_type"
  | "too_large"
  | "empty_file"
  | "no_text"
  | "extraction_failed"
  | "embedding_failed"
  | "persistence_failed"
  | "not_configured"
  /* WOVEN_PDF_OCR_ENABLED: a scanned PDF over a cap, or the transcription request failed (`extract/pdf-ocr.ts`). */
  | "ocr_too_many_pages"
  | "ocr_budget_spent"
  | "ocr_failed";

export class IngestionError extends Error {
  readonly code: IngestionErrorCode;
  /** HTTP status the API route should answer with. */
  readonly status: number;

  constructor(
    code: IngestionErrorCode,
    message: string,
    status = 400,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "IngestionError";
    this.code = code;
    this.status = status;
  }
}

export function isIngestionError(error: unknown): error is IngestionError {
  return error instanceof IngestionError;
}
