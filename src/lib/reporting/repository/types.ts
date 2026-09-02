import type { ParsedReport } from "../types";

/**
 * THE PERSISTENCE PORT.
 *
 * The parser knows nothing about this file, and this file knows nothing about
 * Excel. The only thing crossing between them is `ParsedReport`.
 */

/** Metadata about the raw artifact, as recorded on `report_files`. */
export interface SourceFileRecord {
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  /** Lowercase hex SHA-256 of the bytes as received. Idempotency layer 1. */
  sha256: string;
  /** Object key inside the private reporting bucket. Server-generated. */
  storagePath: string;
  storageBucket: string;
  /** Upstream message id, when the producer has a stable one. Layer 2. */
  externalMessageId: string | null;
  /** Recorded for lineage; NEVER fetched by the server. */
  externalArchiveUrl: string | null;
  /**
   * Sending address as the intake caller reported it. Lineage only.
   *
   * NEVER USED FOR AUTHORIZATION. The caller is authenticated by
   * `REPORTING_INGEST_SECRET`; a From address is trivially forged and deciding
   * anything on it would turn lineage into a security control.
   */
  senderEmail?: string | null;
  /**
   * When the MESSAGE arrived, ISO 8601. Null when the caller does not know.
   *
   * Not when we processed it. The two diverge exactly when it matters — a
   * delayed message, a replay, a backfill weeks later — and the column defaults
   * to `now()` only when this is absent.
   */
  receivedAt?: string | null;
}

export type IngestionOutcome =
  /** The normalized write completed. */
  | "succeeded"
  /** These bytes had already been ingested by this parser and version. */
  | "already_ingested"
  /** The attempt is recorded as failed; nothing was written. */
  | "failed";

export interface IngestionResult {
  outcome: IngestionOutcome;
  ingestionId: string;
  fileId: string;
  periodId: string | null;
  factCount: number;
  salonCount: number;
  supersededFacts: number;
  supersededAttributes: number;
  /** True when the file row was created rather than matched. */
  fileCreated: boolean;
  /** User-safe reason, set when `outcome` is `failed`. */
  failureReason: string | null;
}

export interface ReportingRepository {
  /**
   * Persists a parsed report. Implementations must be atomic in the normalized
   * write and must keep a failed attempt in history.
   */
  ingest(input: {
    sourceCode: string;
    file: SourceFileRecord;
    report: ParsedReport;
  }): Promise<IngestionResult>;
}
