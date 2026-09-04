import "server-only";

import { sha256Hex } from "../ingest";
import { looksLikeHtmlReport, readHtmlReport } from "../html-report";
import { ReportParseError } from "../errors";
import {
  buildReportStoragePath,
  SupabaseReportSourceStorage,
  type ReportSourceStorage,
} from "../repository/source-storage";
import { REPORTING_BUCKET } from "../repository/supabase-reporting-repository";
import {
  ingestSalesTotalsReport,
  SALES_TOTALS_SOURCE_CODE,
  type SalesTotalsIngestDependencies,
  type SalesTotalsIngestResult,
} from "./ingest";
import {
  detectSalesTotals,
  parseSalesTotals,
  SALES_TOTALS_FAMILY,
  type ParsedSalesTotalsReport,
} from "./parser";

/**
 * ============================================================================
 * ONE SALES TOTALS DELIVERY, FROM BYTES TO ROWS.
 * ============================================================================
 *
 * The same six steps `intakeReportWorkbook` performs for the Comp Report, in
 * the same order and for the same reasons — and a separate function because
 * the two families genuinely differ at three of them:
 *
 *   1. IDENTITY FIRST. SHA-256 of the bytes, before anything else.
 *   2. READ. `readHtmlReport`, not `readWorkbook`: this report is HTML wearing
 *      an `.xls` name, proven from the real received file. ExcelJS refuses it.
 *   3. DETECT, then PARSE AND VALIDATE BEFORE STORING ANYTHING. A file that
 *      fails leaves no object in the bucket and no row anywhere.
 *   4. UPLOAD ONCE, at a path derived from the content digest, so a
 *      re-delivery is recognised as already stored rather than re-uploaded.
 *   5. WRITE IN ONE TRANSACTION, through `ingest_sales_totals`.
 *
 * WHAT IS NOT DUPLICATED: idempotency and lineage. Both come from
 * `begin_report_ingestion`, which the Comp Report uses too — see `ingest.ts`.
 *
 * ONE GRAIN, NO PERIOD. A Sales Totals delivery is a daily SNAPSHOT carrying
 * two windows (the report day and month to date). It has no reporting period in
 * the Comp Report's sense, and inventing one to reuse that path would have
 * meant a "period" per day whose MTD figures were not summable. The storage
 * path therefore uses `daily-<report date>`, which keeps every delivery's
 * object addressable by the day it reports on.
 */

/**
 * THE CONTENT TYPE THIS REPORT IS STORED UNDER, and why it is not `text/html`.
 *
 * THE BUG THIS CONSTANT EXISTS TO FIX. The first real delivery failed here.
 * The upload declared `text/html` — the honest description of the bytes — and
 * the `reporting-sources` bucket refuses it: its `allowed_mime_types` are the
 * two Excel types, `application/vnd.ms-excel` and `text/csv`. Storage rejected
 * the object, `upload` threw, and the route's outer catch reported
 * `intake_failed` with no indication of which stage had failed. No local test
 * caught it because a test double records an upload; only a real bucket
 * enforces a mime allowlist.
 *
 * THE ALLOWLIST IS RIGHT AND THE UPLOAD WAS WRONG. A private bucket that
 * cannot hold `text/html` cannot ever serve stored salon financials as
 * executable markup, which is exactly the accident a mime allowlist prevents.
 * Widening it to admit HTML to make one report work would trade a real control
 * for a label.
 *
 * So the object is stored under the type the MAILER gave the attachment —
 * `application/vnd.ms-excel`, which is what a mail client labels anything named
 * `.xls` and what `report_files.mime_type` already records for this delivery.
 * That is not a pretence about the bytes: the parser never consults it, the
 * format is decided by `looksLikeHtmlReport` reading the content, and the file
 * is HTML wearing an `.xls` name by the source system's choice, not ours.
 */
export const STORAGE_CONTENT_TYPE = "application/vnd.ms-excel";

/**
 * The stages a delivery passes through, for a SAFE failure identifier.
 *
 * The route's outer catch turns any unexpected exception into `intake_failed`,
 * which is the right posture for a response — an upstream error message can
 * carry a constraint name and occasionally a value from the offending row — but
 * it left the first real failure undiagnosable without database archaeology.
 * This names the stage and nothing else: no message, no path, no value.
 */
export type SalesTotalsStage = "storage_upload" | "ingest_sales_totals";

export class SalesTotalsStageError extends Error {
  constructor(
    readonly stage: SalesTotalsStage,
    readonly cause: unknown,
  ) {
    // The message is the STAGE, never the underlying text.
    super(`The Sales Totals delivery failed at ${stage}.`);
    this.name = "SalesTotalsStageError";
  }
}

/** Runs one stage, labelling anything it throws. */
async function atStage<T>(stage: SalesTotalsStage, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    throw new SalesTotalsStageError(stage, error);
  }
}

export type SalesTotalsIntakeStatus = "ingested" | "already_ingested" | "failed" | "rejected";

export interface SalesTotalsIntakeInput {
  bytes: Uint8Array;
  /** The attachment name as the sender wrote it. Never the transport's. */
  originalFilename: string;
  mimeType?: string;
  externalMessageId?: string | null;
  senderEmail?: string | null;
  receivedAt?: string | null;
  inboundEmailId?: string | null;
  externalArchiveUrl?: string | null;
  sourceCode?: string;
}

export interface SalesTotalsIntakeResult {
  status: SalesTotalsIntakeStatus;
  code:
    | "ingested"
    | "already_ingested"
    | "ingestion_failed"
    | "unreadable_report"
    | "template_drift"
    | "unsupported_report";
  reason: string;
  sha256: string;
  sizeBytes: number;
  originalFilename: string;
  /** Structural facts about the delivery. Never a financial value. */
  report: {
    parserKey: string;
    parserVersion: number;
    reportDate: string;
    reportDateRaw: string;
    monthStart: string;
    summaryRowCount: number;
    salonRowCount: number;
    valueCount: number;
    windows: string[];
    metrics: string[];
    warnings: string[];
  } | null;
  ingest: SalesTotalsIngestResult | null;
  /** Present when the report was refused before anything was written. */
  rejection: { code: string; message: string; markersMissing: string[] } | null;
}

export interface SalesTotalsIntakeDependencies extends SalesTotalsIngestDependencies {
  storage?: ReportSourceStorage;
  /** Injected so a test can drive persistence without a database. */
  persist?: typeof ingestSalesTotalsReport;
}

function structural(report: ParsedSalesTotalsReport) {
  const values = [...report.summaryRows, ...report.salonRows].flatMap((row) => row.values);
  return {
    parserKey: report.parserKey,
    parserVersion: report.parserVersion,
    reportDate: report.reportDate,
    reportDateRaw: report.reportDateRaw,
    monthStart: report.monthStart,
    summaryRowCount: report.diagnostics.summaryRowCount,
    salonRowCount: report.diagnostics.salonRowCount,
    valueCount: report.diagnostics.valueCount,
    windows: [...new Set(values.map((value) => value.window))],
    metrics: report.diagnostics.measureColumns.map((column) => column.code),
    warnings: [...report.warnings],
  };
}

export async function intakeSalesTotalsReport(
  input: SalesTotalsIntakeInput,
  dependencies: SalesTotalsIntakeDependencies = {},
): Promise<SalesTotalsIntakeResult> {
  const storage = dependencies.storage ?? new SupabaseReportSourceStorage();
  const persist = dependencies.persist ?? ingestSalesTotalsReport;

  const sha256 = sha256Hex(input.bytes);
  const base = {
    sha256,
    sizeBytes: input.bytes.byteLength,
    originalFilename: input.originalFilename,
  };

  /*
   * NOT THIS REPORT — refused before a digest is even useful. The bytes gate in
   * the inbound route has already confirmed the content, so reaching here with
   * something else means a caller bypassed it; answered rather than assumed.
   */
  if (!looksLikeHtmlReport(input.bytes)) {
    return {
      ...base,
      status: "rejected",
      code: "unreadable_report",
      reason: "The Sales Totals report is an HTML document; these bytes are not one.",
      report: null,
      ingest: null,
      rejection: {
        code: "unreadable_report",
        message: "The file does not begin as an HTML document.",
        markersMissing: ["html document"],
      },
    };
  }

  let report: ParsedSalesTotalsReport;
  try {
    const workbook = readHtmlReport(input.bytes);
    const detection = detectSalesTotals(workbook);
    if (!detection.supported) {
      /*
       * FAILS CLOSED, and says which. `template_drift` means "this is the
       * report and our mapping is out of date" — actionable. `unsupported`
       * means "this is not the report" — a stray attachment. Different
       * responses, so different codes.
       */
      return {
        ...base,
        status: "rejected",
        code: detection.kind === "template_drift" ? "template_drift" : "unsupported_report",
        reason: detection.reason,
        report: null,
        ingest: null,
        rejection: {
          code: detection.kind,
          message: detection.reason,
          markersMissing: detection.markersMissing,
        },
      };
    }
    report = parseSalesTotals(workbook);
  } catch (error) {
    const parseError = error instanceof ReportParseError ? error : null;
    return {
      ...base,
      status: "rejected",
      code: parseError?.code === "template_drift" ? "template_drift" : "unreadable_report",
      reason: parseError?.message ?? "The Sales Totals report could not be read.",
      report: null,
      ingest: null,
      rejection: {
        code: parseError?.code ?? "unreadable_report",
        message: parseError?.message ?? "The Sales Totals report could not be read.",
        markersMissing: [],
      },
    };
  }

  /*
   * STORE ONLY WHAT PARSED. The path carries the content digest, so `exists`
   * means "these exact bytes are already stored" — the common case for a
   * re-delivery. A failure to answer is treated as absent, because an
   * overwrite of identical bytes is harmless and a missing object is not.
   */
  const storagePath = buildReportStoragePath({
    reportFamily: report.reportFamily || SALES_TOTALS_FAMILY,
    grain: "daily",
    periodEnd: report.reportDate,
    sha256,
    originalFilename: input.originalFilename,
  });
  const alreadyStored = await storage.exists(storagePath).catch(() => false);
  if (!alreadyStored) {
    await atStage("storage_upload", () =>
      storage.upload({
        path: storagePath,
        bytes: input.bytes,
        contentType: STORAGE_CONTENT_TYPE,
      }),
    );
  }

  const ingest = await atStage("ingest_sales_totals", () =>
    persist(
    {
      report,
      sourceCode: input.sourceCode ?? SALES_TOTALS_SOURCE_CODE,
      file: {
        originalFilename: input.originalFilename,
        mimeType: input.mimeType ?? "text/html",
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
    dependencies,
    ),
  );

  const facts = structural(report);

  if (ingest.outcome === "already_ingested") {
    return {
      ...base,
      status: "already_ingested",
      code: "already_ingested",
      reason:
        "This exact report had already been ingested. No snapshot was written and nothing was changed.",
      report: facts,
      ingest,
      rejection: null,
    };
  }

  if (ingest.outcome === "failed") {
    return {
      ...base,
      status: "failed",
      code: "ingestion_failed",
      reason:
        ingest.failureReason ??
        "The snapshot could not be written. Nothing partial has been left behind.",
      report: facts,
      ingest,
      rejection: null,
    };
  }

  return {
    ...base,
    status: "ingested",
    code: "ingested",
    reason: `Sales Totals for ${report.reportDate} ingested. ${ingest.factsWritten} figure${
      ingest.factsWritten === 1 ? "" : "s"
    } written${ingest.factsSuperseded > 0 ? `, ${ingest.factsSuperseded} superseded` : ""}.`,
    report: facts,
    ingest,
    rejection: null,
  };
}
