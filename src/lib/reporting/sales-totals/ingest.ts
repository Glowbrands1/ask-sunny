import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseAdmin } from "@/lib/supabase/server";
import { ingestionFingerprint, safeFailureReason } from "../repository/supabase-reporting-repository";
import type { SourceFileRecord } from "../repository/types";
import { HTML_SHEET_NAME } from "../html-report";
import type { ParsedSalesTotalsReport, SalesTotalsRow } from "./parser";

/**
 * ============================================================================
 * WRITING A SALES TOTALS REPORT — the half that was missing.
 * ============================================================================
 *
 * The parser, the schema, the `ingest_sales_totals` transaction and the whole
 * dashboard were built. NOTHING IN TYPESCRIPT CALLED THE TRANSACTION. That is
 * why the inbound route answered `family_not_ingestible_by_email`: not a
 * configuration gap, a missing bridge.
 *
 * This is that bridge, and it is deliberately thin. It reuses:
 *
 *   `begin_report_ingestion`  — the SAME idempotency and lineage layer the Comp
 *                               Report uses. The file digest, the parser key
 *                               and version form the ingestion's identity, so a
 *                               re-delivery of identical bytes returns
 *                               `already_ingested` and writes nothing. This is
 *                               where replay protection lives; it is not
 *                               reimplemented here.
 *   `ingest_sales_totals`     — snapshot, facts and supersession in one
 *                               transaction, scoped to the report DATE so a
 *                               corrected report replaces its own day and a
 *                               different day replaces nothing.
 *   `fail_report_ingestion`   — records why a rolled-back attempt failed, so
 *                               the attempt history stays honest.
 *
 * WHY NOT `SupabaseReportingRepository.ingest`. That method calls
 * `complete_comp_sales_ingestion` unconditionally and takes a `ParsedReport` —
 * the comp-sales shape, with periods and salon dimensions. Sales Totals has no
 * period: it has a report DATE, two windows per delivery, estate scopes and no
 * salon numbers. Forcing it through that signature would mean inventing a
 * period for a daily snapshot, which is the one thing the schema was designed
 * to avoid. So the two families share the layers that are genuinely shared and
 * diverge exactly where the data does.
 */

/** `report_sources.code` this report arrives under. Seeded by its migration. */
export const SALES_TOTALS_SOURCE_CODE = "sales_totals_email";

export type SalesTotalsIngestOutcome = "succeeded" | "already_ingested" | "failed";

export interface SalesTotalsIngestResult {
  outcome: SalesTotalsIngestOutcome;
  ingestionId: string;
  fileId: string;
  /** Null unless a snapshot was written. */
  snapshotId: string | null;
  reportDate: string;
  factsWritten: number;
  factsSuperseded: number;
  /** The snapshot this delivery replaced, when it corrected an earlier one. */
  supersededSnapshotId: string | null;
  /**
   * Store names in the report that match no salon row.
   *
   * REPORTED, NEVER INVENTED. This report carries no salon number, so an
   * unrecognised name cannot become a salon without fabricating an identifier.
   * The transaction skips those rows and returns their names.
   */
  unresolvedSalons: string[];
  fileCreated: boolean;
  failureReason: string | null;
}

/** One fact row, in the shape `ingest_sales_totals` reads. */
interface SalesTotalsFactPayload {
  scope_kind: "summary" | "salon";
  scope_code: string | null;
  store_name: string | null;
  metric_code: string;
  report_window: string;
  value: number | null;
  salon_count: number | null;
  source_row: number | null;
}

/**
 * The scope CODE for a summary row, from the label the report wrote.
 *
 * The report says "All Salons"; the schema keys on `all_salons`. Derived rather
 * than mapped by a lookup table so a new estate scope in the source appears as
 * an unresolved code — visible — instead of being silently dropped by a map
 * nobody updated.
 */
export function summaryScopeCode(label: string): string {
  return label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

/** Flattens the parsed report into the RPC's fact array. */
export function buildSalesTotalsFacts(report: ParsedSalesTotalsReport): SalesTotalsFactPayload[] {
  const facts: SalesTotalsFactPayload[] = [];

  const push = (row: SalesTotalsRow, kind: "summary" | "salon") => {
    for (const value of row.values) {
      /*
       * A BLANK CELL IS NOT A ZERO and is not written. The parser preserves the
       * distinction as `null`; carrying it into a fact row would state a figure
       * the report did not, and averages computed downstream would be wrong in
       * the direction that looks plausible.
       */
      if (value.value === null) continue;
      facts.push({
        scope_kind: kind,
        scope_code: kind === "summary" ? summaryScopeCode(row.scopeLabel) : null,
        store_name: kind === "salon" ? row.scopeLabel : null,
        metric_code: value.metricCode,
        report_window: value.window,
        value: value.value,
        salon_count: kind === "summary" ? row.salonCount : null,
        source_row: null,
      });
    }
  };

  for (const row of report.summaryRows) push(row, "summary");
  for (const row of report.salonRows) push(row, "salon");
  return facts;
}

export interface SalesTotalsIngestDependencies {
  client?: SupabaseClient;
}

/**
 * Opens an ingestion, writes the snapshot, or records why it could not.
 *
 * The ordering mirrors the Comp Report's exactly, because the guarantees are
 * the same: the attempt row is committed FIRST so a rolled-back write still
 * leaves a record of having been tried, and the failure reason is sanitised
 * before it is stored — a raw Postgres message quotes the offending row, and
 * that row holds salon financials.
 */
export async function ingestSalesTotalsReport(
  input: { report: ParsedSalesTotalsReport; file: SourceFileRecord; sourceCode?: string },
  dependencies: SalesTotalsIngestDependencies = {},
): Promise<SalesTotalsIngestResult> {
  const client = dependencies.client ?? getSupabaseAdmin();
  const { report, file } = input;
  const sourceCode = input.sourceCode ?? SALES_TOTALS_SOURCE_CODE;

  const begun = await client.rpc("begin_report_ingestion", {
    p_source_code: sourceCode,
    p_file: {
      storage_bucket: file.storageBucket,
      storage_path: file.storagePath,
      original_filename: file.originalFilename,
      mime_type: file.mimeType,
      size_bytes: file.sizeBytes,
      file_sha256: file.sha256,
      external_message_id: file.externalMessageId,
      external_archive_url: file.externalArchiveUrl,
      // Read only when the RPC CREATES the file row: a re-delivery of the same
      // bytes matches by digest and must not rewrite the first delivery's
      // sender or arrival time.
      sender_email: file.senderEmail ?? null,
      received_at: file.receivedAt ?? null,
      inbound_email_id: file.inboundEmailId ?? null,
    },
    p_parser_key: report.parserKey,
    p_parser_version: report.parserVersion,
    p_fingerprint: ingestionFingerprint({
      sourceCode,
      fileSha256: file.sha256,
      parserKey: report.parserKey,
      parserVersion: report.parserVersion,
    }),
    // An HTML report has one synthetic sheet; recorded so lineage reads the
    // same way as a workbook's.
    p_sheet_names: [report.diagnostics.sheetName || HTML_SHEET_NAME],
  });

  if (begun.error) {
    throw new Error(`Could not open an ingestion attempt: ${begun.error.message}`);
  }

  const opened = begun.data as {
    status: string;
    file_id: string;
    file_created: boolean;
    ingestion_id: string;
  };

  if (opened.status === "already_ingested") {
    /*
     * THE REPLAY CASE, and the guarantee this checkpoint had to prove. Same
     * bytes, same parser, same version: the earlier ingestion is returned
     * untouched. No snapshot, no facts, no supersession — so a webhook retry
     * or a forwarding rule that fires twice cannot double a day's figures.
     */
    return {
      outcome: "already_ingested",
      ingestionId: opened.ingestion_id,
      fileId: opened.file_id,
      snapshotId: null,
      reportDate: report.reportDate,
      factsWritten: 0,
      factsSuperseded: 0,
      supersededSnapshotId: null,
      unresolvedSalons: [],
      fileCreated: opened.file_created,
      failureReason: null,
    };
  }

  const facts = buildSalesTotalsFacts(report);
  const written = await client.rpc("ingest_sales_totals", {
    p_ingestion_id: opened.ingestion_id,
    p_report_date: report.reportDate,
    p_report_date_raw: report.reportDateRaw,
    p_summary_row_count: report.diagnostics.summaryRowCount,
    p_salon_row_count: report.diagnostics.salonRowCount,
    p_value_count: report.diagnostics.valueCount,
    p_warnings: [...report.warnings],
    p_facts: facts,
  });

  if (written.error) {
    const reason = safeFailureReason(written.error.message);
    await client.rpc("fail_report_ingestion", {
      p_ingestion_id: opened.ingestion_id,
      p_reason: reason,
    });
    return {
      outcome: "failed",
      ingestionId: opened.ingestion_id,
      fileId: opened.file_id,
      snapshotId: null,
      reportDate: report.reportDate,
      factsWritten: 0,
      factsSuperseded: 0,
      supersededSnapshotId: null,
      unresolvedSalons: [],
      fileCreated: opened.file_created,
      failureReason: reason,
    };
  }

  const result = written.data as {
    snapshot_id: string;
    facts_written: number;
    facts_superseded: number;
    superseded_snapshot_id: string | null;
    unresolved_salons: string[] | null;
  };

  return {
    outcome: "succeeded",
    ingestionId: opened.ingestion_id,
    fileId: opened.file_id,
    snapshotId: result.snapshot_id,
    reportDate: report.reportDate,
    factsWritten: result.facts_written,
    factsSuperseded: result.facts_superseded,
    supersededSnapshotId: result.superseded_snapshot_id,
    unresolvedSalons: result.unresolved_salons ?? [],
    fileCreated: opened.file_created,
    failureReason: null,
  };
}
