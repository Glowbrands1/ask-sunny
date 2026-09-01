import "server-only";

import { createHash } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseAdmin } from "@/lib/supabase/server";
import type { ParsedReport } from "../types";
import type { IngestionResult, ReportingRepository, SourceFileRecord } from "./types";

/**
 * SupabaseReportingRepository — the production persistence implementation.
 *
 * It deliberately performs NO multi-table writing of its own. Every write goes
 * through one of three database functions, because supabase-js has no
 * client-side transaction: each `.from(...).insert(...)` commits on its own, so
 * an atomic period-plus-salons-plus-facts write is not expressible from here.
 * A function body is a transaction, so that is where the write lives.
 *
 * The split into three calls is what preserves retry semantics:
 *
 *   begin  → commits the file row and the attempt row, so the attempt exists
 *            even if everything after it fails.
 *   complete → the atomic normalized write; all of it or none of it, and the
 *            `succeeded` status is set inside the same transaction, so a
 *            half-written report can never be marked successful.
 *   fail   → annotates the surviving attempt with a user-safe reason.
 *
 * Server-side only: it holds the secret-key client, which bypasses RLS.
 * `import "server-only"` makes a client-component import a build error.
 */

export const REPORTING_BUCKET = "reporting-sources";

/**
 * The diagnostic correlation value recorded on every attempt.
 *
 * Defined by the schema comment as
 * `sha256(source_code | file_sha256 | parser_key | parser_version)`. It is NOT
 * unique by design — the natural key is, and enforcing uniqueness on a digest
 * would turn a bug in how it is computed into a spurious rejection.
 */
export function ingestionFingerprint(input: {
  sourceCode: string;
  fileSha256: string;
  parserKey: string;
  parserVersion: number;
}): string {
  return createHash("sha256")
    .update(
      [input.sourceCode, input.fileSha256, input.parserKey, String(input.parserVersion)].join("|"),
    )
    .digest("hex");
}

/** The payload shape `complete_comp_sales_ingestion` reads. */
export function buildIngestionPayload(report: ParsedReport) {
  return {
    period: {
      grain: report.period.grain,
      period_end: report.period.periodEnd,
      period_start: report.period.periodStart,
      fiscal_year: report.period.fiscalYear,
      label_raw: report.period.labelRaw,
    },
    salons: report.salons.map((salon) => ({
      salon_number: salon.salonNumber,
      store_name: salon.storeName,
      owner_ref: salon.ownerRef,
      owner_uid: salon.ownerUid,
      opened_at: salon.openedAt,
    })),
    attributes: report.salonPeriodAttributes.map((attributes) => ({
      salon_number: attributes.salonNumber,
      district_label: attributes.districtLabel,
      region_label: attributes.regionLabel,
      company: attributes.company,
      ownership_group: attributes.ownershipGroup,
      dma: attributes.dma,
      pricing_plan: attributes.pricingPlan,
      is_comp_salon: attributes.isCompSalon,
      spa_pieces: attributes.spaPieces,
      spa_install_date: attributes.spaInstallDate,
      quintile_group: attributes.quintileGroup,
      revenue_rank: attributes.revenueRank,
      salon_age_years: attributes.salonAgeYears,
      avg_client_age: attributes.avgClientAge,
      market_consolidation: attributes.marketConsolidation,
      nearest_competitor_distance: attributes.nearestCompetitorDistance,
    })),
    facts: report.facts.map((fact) => ({
      salon_number: fact.salonNumber,
      metric_code: fact.metricCode,
      basis_year: fact.basisYear,
      value: fact.value,
      source_sheet: fact.sourceSheet,
      source_column: fact.sourceColumn,
    })),
    // Warning MESSAGES only. They are structural by construction and carry no
    // figures, which matters because this array is surfaced in an admin view.
    warnings: report.warnings.map((warning) => `${warning.code}: ${warning.message}`),
    sheet_names: report.sourceSheetNames,
  };
}

export class SupabaseReportingRepository implements ReportingRepository {
  private readonly client: SupabaseClient;

  constructor(client: SupabaseClient = getSupabaseAdmin()) {
    this.client = client;
  }

  async ingest(input: {
    sourceCode: string;
    file: SourceFileRecord;
    report: ParsedReport;
  }): Promise<IngestionResult> {
    const { sourceCode, file, report } = input;

    const begun = await this.client.rpc("begin_report_ingestion", {
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
      },
      p_parser_key: report.parserKey,
      p_parser_version: report.parserVersion,
      p_fingerprint: ingestionFingerprint({
        sourceCode,
        fileSha256: file.sha256,
        parserKey: report.parserKey,
        parserVersion: report.parserVersion,
      }),
      p_sheet_names: report.sourceSheetNames,
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
      // Idempotent by design: the same bytes under the same parser and version
      // return the earlier ingestion untouched. No new attempt, no new facts.
      return {
        outcome: "already_ingested",
        ingestionId: opened.ingestion_id,
        fileId: opened.file_id,
        periodId: null,
        factCount: 0,
        salonCount: 0,
        supersededFacts: 0,
        supersededAttributes: 0,
        fileCreated: opened.file_created,
        failureReason: null,
      };
    }

    const completed = await this.client.rpc("complete_comp_sales_ingestion", {
      p_ingestion_id: opened.ingestion_id,
      p_payload: buildIngestionPayload(report),
    });

    if (completed.error) {
      // The atomic write rolled back. The attempt row survives because it was
      // committed separately, so record WHY — that history is the point.
      const reason = safeFailureReason(completed.error.message);
      await this.client.rpc("fail_report_ingestion", {
        p_ingestion_id: opened.ingestion_id,
        p_reason: reason,
      });
      return {
        outcome: "failed",
        ingestionId: opened.ingestion_id,
        fileId: opened.file_id,
        periodId: null,
        factCount: 0,
        salonCount: 0,
        supersededFacts: 0,
        supersededAttributes: 0,
        fileCreated: opened.file_created,
        failureReason: reason,
      };
    }

    const result = completed.data as {
      period_id: string;
      fact_count: number;
      salon_count: number;
      superseded_facts: number;
      superseded_attributes: number;
    };

    return {
      outcome: "succeeded",
      ingestionId: opened.ingestion_id,
      fileId: opened.file_id,
      periodId: result.period_id,
      factCount: result.fact_count,
      salonCount: result.salon_count,
      supersededFacts: result.superseded_facts,
      supersededAttributes: result.superseded_attributes,
      fileCreated: opened.file_created,
      failureReason: null,
    };
  }
}

/**
 * Keeps a database error short and free of anything that could be a data value.
 *
 * `failure_reason` is shown to an operator, so a raw Postgres message — which
 * happily quotes the offending row — must not go through verbatim.
 */
export function safeFailureReason(message: string): string {
  const firstLine = message.split("\n")[0] ?? message;
  // Strip anything in parentheses or after `DETAIL:`, where Postgres puts the
  // offending values.
  const withoutDetail = firstLine.split(/detail:/i)[0];
  const withoutValues = withoutDetail.replace(/\([^)]*\)/g, "(...)");
  return `The normalized write was refused and rolled back: ${withoutValues.trim().slice(0, 400)}`;
}
