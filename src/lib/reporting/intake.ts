import "server-only";

import { ReportParseError } from "./errors";
import {
  detectAllReports,
  ingestParsedReport,
  sha256Hex,
  ReportValidationError,
  XLSX_MIME,
  type ParserDetection,
} from "./ingest";
import { parseReportWorkbook } from "./index";
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
import type { ReportingRepository } from "./repository/types";
import type { ParsedReport } from "./types";
import { validateParsedReport } from "./validation";

/**
 * AUTOMATED REPORT INTAKE — ONE DELIVERY, EVERY COMPATIBLE PARSER.
 *
 * The problem this solves. The Comp Report workbook contains three sheets that
 * three different parsers read, and the existing ingestion route takes a
 * `parserKey` because a human choosing a view is making a decision. An
 * automated sender is not: Power Automate forwards a mailbox attachment and has
 * no business knowing that `comp_sales_ytd` exists, still less that it has to
 * POST the same file three times with three different keys to get a complete
 * report loaded. That arrangement is also fragile in the worst way — three
 * calls means three chances to load two thirds of a report and stop.
 *
 * So intake reads the workbook ONCE, asks every registered parser whether it
 * recognises anything in it, and runs the ones that do. Adding a fourth sheet
 * later means registering a parser; the sender never changes.
 *
 * HOW FAILURE IS CONTAINED, which is the whole design:
 *
 *   STRUCTURAL VALIDATION FIRST, ACROSS THE WHOLE FILE. If no parser recognises
 *   the workbook, nothing is uploaded and nothing is written — the delivery is
 *   refused as drift or as unrecognised, with the reasons each parser gave.
 *
 *   ONE PARSER'S FAILURE IS THAT PARSER'S. Each write is its own transaction
 *   through `begin_report_ingestion` / `complete_comp_sales_ingestion`, so a
 *   parser that throws, fails validation or rolls back leaves the others' rows
 *   exactly as they were. There is no path here that deletes or supersedes
 *   anything on behalf of a parser other than the one being run: supersession
 *   is scoped to (period, salon, source sheet) in the database, and a failed
 *   attempt never reaches it.
 *
 *   FAILURE IS EXPLICIT AND PER PARSER. The response lists what was attempted,
 *   what succeeded, what was already ingested and what failed with a reason for
 *   each. A partial success is reported as a partial success, never as a
 *   success — `accepted` is about the FILE, and the per-parser outcomes are
 *   where the truth about the data lives.
 *
 *   IDEMPOTENCY IS UNTOUCHED AND IS PER PARSER. Re-delivering the same bytes
 *   returns `already_ingested` for each parser that already succeeded on them,
 *   writing nothing. A parser that failed last time is retried, because its
 *   attempt did not succeed — which is exactly what a retry should do.
 *
 * THE RESPONSE CARRIES NO FINANCIAL VALUES. Counts, identifiers, periods,
 * sheet names and warning codes. No figure, no salon name, no manager name.
 */

/** Metadata an automated sender supplies about the delivery. */
export interface ReportIntakeInput {
  bytes: Uint8Array;
  /** The attachment name as the sender wrote it, not the transport's name. */
  originalFilename: string;
  mimeType?: string;
  /** Outlook message id. Idempotency layer 2 and the lineage back to the mail. */
  externalMessageId?: string | null;
  /** Who sent it, so a report from an unexpected mailbox is visible. */
  senderEmail?: string | null;
  /** When the MESSAGE arrived, not when we processed it. ISO 8601. */
  receivedAt?: string | null;
  /** Where the operational copy lives. Recorded for lineage; never fetched. */
  externalArchiveUrl?: string | null;
  /**
   * Resend's id for the received email, when the delivery arrived by mail.
   *
   * Kept separate from `externalMessageId`, which holds the upstream
   * `Message-ID` of the mail Samuel sent. Two different identities: one names
   * the original message, the other names the copy Resend received, and
   * collapsing them would make a correlation back to the Resend dashboard
   * impossible.
   */
  inboundEmailId?: string | null;
  /** `report_sources.code` this delivery arrived through. */
  sourceCode?: string;
}

export type ParserAttemptStatus =
  /** Parsed, validated and written. */
  | "succeeded"
  /** These bytes had already succeeded under this parser and version. */
  | "already_ingested"
  /** Attempted and refused or rolled back. Nothing of this parser's was written. */
  | "failed"
  /** This parser does not recognise anything in this workbook. Not an error. */
  | "not_applicable";

/** What one parser did with the delivery. Structural only. */
export interface ParserAttempt {
  parserKey: string;
  parserVersion: number;
  status: ParserAttemptStatus;
  /** The workbook sheet this parser read, when it recognised one. */
  sourceSheet: string | null;
  /** The period this parser's figures belong to. Null when nothing was written. */
  period: {
    grain: string;
    periodStart: string;
    periodEnd: string;
    /** The period string exactly as the workbook stated it. */
    label: string;
    periodId: string | null;
  } | null;
  factsWritten: number;
  salonsWritten: number;
  supersededFacts: number;
  supersededAttributes: number;
  /** True when the parser wants a human to look before the figures are trusted. */
  requiresReview: boolean;
  /** Counts by code. Never the messages, which can name columns. */
  warningsByCode: Record<string, number>;
  /** Counts by reason. The parser reports these; the schema does not store them. */
  skippedByReason: Record<string, number>;
  ingestionId: string | null;
  /** Set when `status` is `failed` or `not_applicable`. */
  failure: { code: string; message: string; details: string[] } | null;
}

export interface ReportIntakeResult {
  /** True when the file was recognised and at least one parser was attempted. */
  fileAccepted: boolean;
  sha256: string;
  sizeBytes: number;
  originalFilename: string;
  /** The credential that delivered it, when one is known. Never the secret. */
  credentialId: string | null;
  parsersAttempted: string[];
  parsersSucceeded: string[];
  parsersAlreadyIngested: string[];
  parsersFailed: string[];
  /** Registered parsers that recognise nothing here. Informational. */
  parsersNotApplicable: string[];
  /** Distinct periods this delivery touched, and whether each was new. */
  periods: {
    grain: string;
    periodEnd: string;
    label: string;
    periodId: string;
    /** True when this ingestion created the period rather than reusing it. */
    created: boolean;
  }[];
  factsWritten: number;
  supersededFacts: number;
  /** True when ANY successful parser asked for review. */
  reviewRequired: boolean;
  attempts: ParserAttempt[];
}

export interface IntakeDependencies {
  repository?: ReportingRepository;
  storage?: ReportSourceStorage;
  /** Existing period ids, for deciding `created`. Injected so it is testable. */
  knownPeriodIds?: () => Promise<Set<string>>;
}

/**
 * Raised when no registered parser can read the delivery.
 *
 * Carries every parser's reason, because "the workbook changed" is only
 * actionable if it says which sheet and which marker. A drift verdict is
 * preferred over an unsupported one in the message for the same reason it is in
 * `detectReport`: "our mapping is out of date" is the more specific claim.
 */
export type IntakeRejectionCode =
  /** A sheet is present but no longer matches the reviewed mapping. */
  | "template_drift"
  /** Readable as a workbook, but nothing in it is a report we know. */
  | "unsupported_workbook"
  /** Not readable as a workbook at all. */
  | "unreadable_workbook";

export class ReportIntakeRejected extends Error {
  readonly status = 422;
  readonly code: IntakeRejectionCode;
  readonly detections: ParserDetection[];

  constructor(detections: ParserDetection[], unreadable?: string) {
    const drifted = detections.filter((entry) => entry.kind === "template_drift");
    const code: IntakeRejectionCode = unreadable
      ? "unreadable_workbook"
      : drifted.length > 0
        ? "template_drift"
        : "unsupported_workbook";
    super(
      unreadable
        ? `The delivery could not be read as an .xlsx workbook: ${unreadable}`
        : drifted.length > 0
          ? `The workbook no longer matches the reviewed mapping: ${drifted
              .map((entry) => entry.reason)
              .join(" ")}`
          : "No registered parser recognised this workbook.",
    );
    this.name = "ReportIntakeRejected";
    this.code = code;
    this.detections = detections;
  }
}

function countBy<T>(items: T[], key: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const value = key(item);
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

/** A parse or validation failure, reduced to something safe to return. */
function describeFailure(error: unknown): { code: string; message: string; details: string[] } {
  if (error instanceof ReportValidationError) {
    return {
      code: "validation_failed",
      message: error.message,
      details: error.problems.map((problem) => problem.code),
    };
  }
  if (error instanceof ReportParseError) {
    return {
      code: error.code,
      message: error.message,
      // `details` on a parse error names markers and columns, not figures.
      details: Array.isArray(error.details) ? error.details.map(String) : [],
    };
  }
  /*
   * Anything else is reduced to a generic message on purpose. A database error
   * string can carry column names, constraint names and occasionally a value
   * from the row that violated it, and this response goes to an external caller.
   */
  return {
    code: "ingestion_failed",
    message: "The ingestion could not be completed. The attempt is recorded.",
    details: [],
  };
}

/**
 * Runs one delivery through every compatible parser.
 *
 * The order of operations is the safety property:
 *
 *   1. Digest the bytes. Before anything else, so the identity of what arrived
 *      is fixed even if every later step fails.
 *   2. Detect across all parsers. No write, no upload.
 *   3. Refuse the whole delivery if nothing recognises it.
 *   4. Parse and validate each applicable sheet — still no write. A sheet that
 *      cannot become rows is recorded as a failure here, before its bytes are
 *      stored, and does not stop the other sheets.
 *   5. Upload ONCE, only if at least one sheet validated.
 *   6. Write each validated report in its own transaction.
 */
export async function intakeReportWorkbook(
  input: ReportIntakeInput,
  dependencies: IntakeDependencies = {},
): Promise<ReportIntakeResult> {
  const repository = dependencies.repository ?? new SupabaseReportingRepository();
  const storage = dependencies.storage ?? new SupabaseReportSourceStorage();

  // 1. Identity first.
  const sha256 = sha256Hex(input.bytes);

  /*
   * 2. Every parser's verdict, from one read of the workbook.
   *
   * A FAILURE TO READ THE FILE AT ALL IS A REFUSAL, NOT AN ERROR. A mail
   * transport will eventually deliver a PDF, a truncated attachment or a
   * password-protected file, and "we could not read this" is a 422 the sender
   * can act on — not a 500 that reads as our fault and gets retried forever.
   */
  let detections: ParserDetection[];
  try {
    detections = await detectAllReports(input.bytes);
  } catch (error) {
    throw new ReportIntakeRejected(
      [],
      error instanceof ReportParseError
        ? error.message
        : "The file is not a readable spreadsheet.",
    );
  }

  const applicable = detections.filter((entry) => entry.supported);

  // 3. Nothing recognised it: refuse the delivery whole. Nothing written.
  if (applicable.length === 0) throw new ReportIntakeRejected(detections);

  const attempts: ParserAttempt[] = detections
    .filter((entry) => !entry.supported)
    .map((entry) => ({
      parserKey: entry.parserKey,
      parserVersion: entry.parserVersion,
      status: "not_applicable" as const,
      sourceSheet: entry.sheetName,
      period: null,
      factsWritten: 0,
      salonsWritten: 0,
      supersededFacts: 0,
      supersededAttributes: 0,
      requiresReview: false,
      warningsByCode: {},
      skippedByReason: {},
      ingestionId: null,
      failure: {
        code: entry.kind === "template_drift" ? "template_drift" : "sheet_not_present",
        message: entry.reason ?? "This parser recognises nothing in this workbook.",
        details: entry.markersMissing,
      },
    }));

  /*
   * 4. PARSE AND VALIDATE EVERYTHING BEFORE STORING ANYTHING.
   *
   * A sheet that cannot become rows is a failure of that sheet, recorded here
   * with nothing uploaded and nothing written. Doing this before the upload
   * also means a delivery in which EVERY sheet fails validation leaves no
   * object in the bucket at all.
   */
  const parsed: { detection: ParserDetection; report: ParsedReport }[] = [];

  for (const detection of applicable) {
    try {
      const report = await parseReportWorkbook(input.bytes, {
        parserKey: detection.parserKey,
      });
      const { problems } = validateParsedReport(report);
      if (problems.length > 0) throw new ReportValidationError(problems);
      parsed.push({ detection, report });
    } catch (error) {
      attempts.push({
        parserKey: detection.parserKey,
        parserVersion: detection.parserVersion,
        status: "failed",
        sourceSheet: detection.sheetName,
        period: null,
        factsWritten: 0,
        salonsWritten: 0,
        supersededFacts: 0,
        supersededAttributes: 0,
        requiresReview: false,
        warningsByCode: {},
        skippedByReason: {},
        ingestionId: null,
        failure: describeFailure(error),
      });
    }
  }

  if (parsed.length === 0) {
    return summarize({ input, sha256, attempts, periodsCreated: new Set() });
  }

  /*
   * 5. ONE UPLOAD, ONE OBJECT.
   *
   * The path is derived from the FIRST parsed report's family, grain and period
   * end, plus the content digest — deterministic because the registry order is
   * fixed, and identical to the path an equivalent single-parser ingestion would
   * produce. `report_files` is unique on the digest and records exactly this
   * path, so every parser's rows point at the object that actually exists.
   */
  const storagePath = buildReportStoragePath({
    reportFamily: parsed[0].report.reportFamily || COMP_SALES_FAMILY,
    grain: parsed[0].report.period.grain,
    periodEnd: parsed[0].report.period.periodEnd,
    sha256,
    originalFilename: input.originalFilename,
  });

  /*
   * SKIPPED WHEN THE OBJECT IS ALREADY THERE. The path carries the content
   * digest, so "exists" means "these exact bytes are already stored" — and a
   * retrying flow re-delivering the same report is the COMMON case, not the
   * rare one. Re-uploading would be a correct no-op that moves the whole
   * workbook again on every duplicate.
   *
   * A failure to answer is treated as absent and the upload proceeds, because
   * an overwrite of identical bytes is harmless and a missing object is not.
   */
  const alreadyStored = await storage.exists(storagePath).catch(() => false);
  if (!alreadyStored) {
    await storage.upload({
      path: storagePath,
      bytes: input.bytes,
      contentType: input.mimeType ?? XLSX_MIME,
    });
  }

  /*
   * Which periods existed BEFORE this delivery, so `created` is a fact rather
   * than a guess. Read once, before any write — reading it afterwards would
   * report every period as pre-existing.
   */
  const periodsBefore = dependencies.knownPeriodIds
    ? await dependencies.knownPeriodIds()
    : new Set<string>();

  // 6. One transaction per parser. A failure here is that parser's alone.
  for (const { detection, report } of parsed) {
    try {
      const result = await ingestParsedReport(
        {
          report,
          sourceCode: input.sourceCode,
          file: {
            originalFilename: input.originalFilename,
            mimeType: input.mimeType ?? XLSX_MIME,
            sizeBytes: input.bytes.byteLength,
            sha256,
            storagePath,
            storageBucket: REPORTING_BUCKET,
            externalMessageId: input.externalMessageId ?? null,
            externalArchiveUrl: input.externalArchiveUrl ?? null,
            senderEmail: input.senderEmail ?? null,
            receivedAt: input.receivedAt ?? null,
            inboundEmailId: input.inboundEmailId ?? null,
          },
        },
        { repository },
      );

      attempts.push({
        parserKey: report.parserKey,
        parserVersion: report.parserVersion,
        status:
          result.outcome === "succeeded"
            ? "succeeded"
            : result.outcome === "already_ingested"
              ? "already_ingested"
              : "failed",
        sourceSheet: detection.sheetName,
        period:
          result.outcome === "succeeded"
            ? {
                grain: report.period.grain,
                periodStart: report.period.periodStart,
                periodEnd: report.period.periodEnd,
                label: report.period.labelRaw,
                periodId: result.periodId,
              }
            : null,
        factsWritten: result.factCount,
        salonsWritten: result.salonCount,
        supersededFacts: result.supersededFacts,
        supersededAttributes: result.supersededAttributes,
        requiresReview:
          result.outcome === "succeeded" && report.diagnostics.requiresReview,
        warningsByCode: countBy(report.warnings, (warning) => warning.code),
        skippedByReason: countBy(report.skippedRows, (row) => row.reason),
        ingestionId: result.ingestionId,
        failure:
          result.outcome === "failed"
            ? {
                code: "ingestion_failed",
                message:
                  result.failureReason ??
                  "The ingestion could not be completed. The attempt is recorded.",
                details: [],
              }
            : null,
      });
    } catch (error) {
      /*
       * A THROW HERE IS STILL THIS PARSER'S FAILURE ONLY.
       *
       * Caught rather than propagated so the remaining parsers still run: a
       * transient database error on the year-to-date sheet must not discard a
       * month-to-date write that already committed.
       */
      attempts.push({
        parserKey: report.parserKey,
        parserVersion: report.parserVersion,
        status: "failed",
        sourceSheet: detection.sheetName,
        period: null,
        factsWritten: 0,
        salonsWritten: 0,
        supersededFacts: 0,
        supersededAttributes: 0,
        requiresReview: false,
        warningsByCode: countBy(report.warnings, (warning) => warning.code),
        skippedByReason: countBy(report.skippedRows, (row) => row.reason),
        ingestionId: null,
        failure: describeFailure(error),
      });
    }
  }

  return summarize({ input, sha256, attempts, periodsCreated: periodsBefore });
}

/** Rolls the per-parser attempts up, in registry order. */
function summarize(args: {
  input: ReportIntakeInput;
  sha256: string;
  attempts: ParserAttempt[];
  /** Period ids that existed before this delivery. */
  periodsCreated: Set<string>;
}): ReportIntakeResult {
  const { input, sha256, attempts, periodsCreated: before } = args;
  const of = (status: ParserAttemptStatus) =>
    attempts.filter((attempt) => attempt.status === status).map((attempt) => attempt.parserKey);

  const periods = new Map<string, ReportIntakeResult["periods"][number]>();
  for (const attempt of attempts) {
    if (attempt.status !== "succeeded" || !attempt.period?.periodId) continue;
    const { grain, periodEnd, label, periodId } = attempt.period;
    // Keyed on the period id, so the two month-to-date sheets that share a
    // period appear once rather than twice.
    if (!periods.has(periodId)) {
      periods.set(periodId, {
        grain,
        periodEnd,
        label,
        periodId,
        created: !before.has(periodId),
      });
    }
  }

  const attempted = attempts
    .filter((attempt) => attempt.status !== "not_applicable")
    .map((attempt) => attempt.parserKey);

  return {
    // The FILE was accepted: something recognised it and was attempted. Whether
    // the data landed is the per-parser question, deliberately not this one.
    fileAccepted: attempted.length > 0,
    sha256,
    sizeBytes: input.bytes.byteLength,
    originalFilename: input.originalFilename,
    credentialId: null,
    parsersAttempted: attempted,
    parsersSucceeded: of("succeeded"),
    parsersAlreadyIngested: of("already_ingested"),
    parsersFailed: of("failed"),
    parsersNotApplicable: of("not_applicable"),
    periods: [...periods.values()],
    factsWritten: attempts.reduce((total, attempt) => total + attempt.factsWritten, 0),
    supersededFacts: attempts.reduce((total, attempt) => total + attempt.supersededFacts, 0),
    reviewRequired: attempts.some((attempt) => attempt.requiresReview),
    attempts,
  };
}
