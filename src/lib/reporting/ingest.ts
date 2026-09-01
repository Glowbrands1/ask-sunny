import "server-only";

import { createHash } from "node:crypto";

import { ReportParseError } from "./errors";
import { detectReport, parseReportWorkbook } from "./index";
import { COMP_SALES_FAMILY } from "./comp-sales/parser";
import {
  buildReportStoragePath,
  SupabaseReportSourceStorage,
  type ReportSourceStorage,
} from "./repository/source-storage";
import {
  REPORTING_BUCKET,
  SupabaseReportingRepository,
} from "./repository/supabase-reporting-repository";
import type { IngestionResult, ReportingRepository } from "./repository/types";
import type { ParsedReport } from "./types";
import { validateParsedReport, type ValidationProblem } from "./validation";
import { readWorkbook } from "./workbook";

/**
 * THE INGESTION SERVICE.
 *
 * bytes
 *   -> SHA-256
 *   -> parser detection
 *   -> parse
 *   -> validation
 *   -> private source-file storage
 *   -> report_files / report_ingestions / report_periods / salons
 *      / salon_period_attributes / comp_sales_facts   (one transaction)
 *   -> result
 *
 * ORDERING IS DELIBERATE. Validation runs before anything is written, so a
 * report that cannot become rows never opens an attempt or stores a file. The
 * upload happens before the database write so that a `report_files` row never
 * names an object that does not exist — lineage that points at nothing is worse
 * than no lineage. The reverse failure is harmless: an uploaded object with no
 * row is dead weight, and because its path is derived from the content hash a
 * retry overwrites it rather than accumulating copies.
 */

export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export class ReportValidationError extends Error {
  readonly problems: ValidationProblem[];
  readonly status = 422;

  constructor(problems: ValidationProblem[]) {
    super(
      `The report cannot be ingested: ${problems.map((problem) => problem.message).join(" ")}`,
    );
    this.name = "ReportValidationError";
    this.problems = problems;
  }
}

export interface IngestReportInput {
  bytes: Uint8Array;
  originalFilename: string;
  mimeType?: string;
  /** Upstream message id, when the producer has a stable one. */
  externalMessageId?: string | null;
  /** Recorded for lineage only; never fetched. */
  externalArchiveUrl?: string | null;
  /** `report_sources.code` this delivery arrived through. */
  sourceCode?: string;
}

export interface IngestReportOutcome extends IngestionResult {
  sha256: string;
  storagePath: string;
  storageBucket: string;
  report: ParsedReport;
}

export interface IngestDependencies {
  repository?: ReportingRepository;
  storage?: ReportSourceStorage;
}

/** Lowercase hex SHA-256 of the bytes as received, computed before anything else. */
export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Parses without writing. Useful for a dry run and for the ingest route's preflight. */
export async function inspectWorkbook(bytes: Uint8Array): Promise<{
  sha256: string;
  report: ParsedReport;
  problems: ValidationProblem[];
}> {
  const sha256 = sha256Hex(bytes);
  const workbook = await readWorkbook(bytes);
  const detection = detectReport(workbook);
  if (!detection.supported) {
    throw new ReportParseError(
      detection.kind === "template_drift" ? "template_drift" : "unsupported_workbook",
      detection.reason,
      { details: detection.markersMissing },
    );
  }
  const report = await parseReportWorkbook(bytes);
  const { problems } = validateParsedReport(report);
  return { sha256, report, problems };
}

export async function ingestReportWorkbook(
  input: IngestReportInput,
  dependencies: IngestDependencies = {},
): Promise<IngestReportOutcome> {
  const repository = dependencies.repository ?? new SupabaseReportingRepository();
  const storage = dependencies.storage ?? new SupabaseReportSourceStorage();

  const { sha256, report, problems } = await inspectWorkbook(input.bytes);

  // Nothing is written for a report that cannot become rows.
  if (problems.length > 0) throw new ReportValidationError(problems);

  const storagePath = buildReportStoragePath({
    reportFamily: report.reportFamily || COMP_SALES_FAMILY,
    grain: report.period.grain,
    periodEnd: report.period.periodEnd,
    sha256,
    originalFilename: input.originalFilename,
  });

  await storage.upload({
    path: storagePath,
    bytes: input.bytes,
    contentType: input.mimeType ?? XLSX_MIME,
  });

  const result = await repository.ingest({
    sourceCode: input.sourceCode ?? "comp_report_email",
    file: {
      originalFilename: input.originalFilename,
      mimeType: input.mimeType ?? XLSX_MIME,
      sizeBytes: input.bytes.byteLength,
      sha256,
      storagePath,
      storageBucket: REPORTING_BUCKET,
      externalMessageId: input.externalMessageId ?? null,
      externalArchiveUrl: input.externalArchiveUrl ?? null,
    },
    report,
  });

  return { ...result, sha256, storagePath, storageBucket: REPORTING_BUCKET, report };
}
