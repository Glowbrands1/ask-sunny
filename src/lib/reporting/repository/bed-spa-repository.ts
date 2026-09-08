import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseAdmin } from "@/lib/supabase/server";
import type { ParsedBedUsageReport } from "../bed-usage/parser";
import type { ParsedSpaEngagementReport } from "../spa-engagement/parser";
import type { ParsedSpaWellnessReport, ParsedSpaWellnessWindow } from "../spa-wellness/parser";
import { ingestionFingerprint, REPORTING_BUCKET } from "./supabase-reporting-repository";
import { safeFailureReason } from "./supabase-reporting-repository";
import type { IngestionResult, SourceFileRecord } from "./types";

/**
 * ============================================================================
 * PERSISTENCE FOR THE THREE NEW REPORT FAMILIES
 * ============================================================================
 *
 * The same three-call shape as `SupabaseReportingRepository`, for the same
 * reason: supabase-js has no client-side transaction, so the atomic write lives
 * in a database function and this class calls it.
 *
 *   begin_report_ingestion               commits the file row and the attempt,
 *                                        so a failure still leaves a record.
 *   complete_<family>_ingestion          the atomic write, marking the attempt
 *                                        succeeded inside the same transaction.
 *   fail_report_ingestion                annotates the surviving attempt.
 *
 * `begin` and `fail` are the EXISTING functions, called rather than
 * reimplemented — so all four idempotency layers, the lineage columns and the
 * failure history behave identically for the new families and cannot drift
 * from the Comp Report's.
 *
 * ONE CALL PER PARSER-VISIBLE UNIT. Bed Usage and Spa Engagement are one call
 * each. SPA WELLNESS IS ONE CALL PER WINDOW, because each window is its own
 * period: three windows in one file means three attempts, three periods and
 * three snapshots. Their parser VERSIONS are the same, so the attempt key
 * includes the window — see `windowParserKey` below.
 */

/** The payload shape `complete_bed_usage_ingestion` reads. */
export function buildBedUsagePayload(report: ParsedBedUsageReport) {
  return {
    period: {
      grain: report.period.grain,
      period_end: report.period.periodEnd,
      period_start: report.period.periodStart,
      fiscal_year: report.period.fiscalYear,
      label_raw: report.period.labelRaw,
    },
    company: report.company,
    salons: report.salons.map((salon) => ({
      store_name: salon.storeName,
      total_tans: salon.totalTans,
      bed_count: salon.bedCount,
      source_row: salon.sourceRow,
    })),
    equipment: report.equipment.map((row) => ({
      store_name: row.storeName,
      level: row.level,
      bed_type: row.bedType,
      qty: row.qty,
      client_tans: row.clientTans,
      total_tans_with_employee: row.totalTansWithEmployee,
      per_bed: row.perBed,
      v_chain_percent: row.vChainPercent,
      v_chain_ratio: row.vChainRatio,
      v_bed_type_percent: row.vBedTypePercent,
      share_of_salon_tans: row.shareOfSalonTans,
      share_of_salon_beds: row.shareOfSalonBeds,
      source_row: row.sourceRow,
    })),
    benchmarks: report.chainBenchmarks.map((benchmark) => ({
      level: benchmark.level,
      tans_per_bed: benchmark.tansPerBed,
      total_beds: benchmark.totalBeds,
      share_of_chain_tans: benchmark.shareOfChainTans,
    })),
    diagnostics: {
      source_salon_count: report.diagnostics.sourceSalonCount,
      source_company_count: report.diagnostics.sourceCompanyCount,
    },
    // Warning MESSAGES only, and they are structural by construction: they name
    // columns, sheets and salons of OUR OWN company, never a figure.
    warnings: report.warnings,
  };
}

/** The payload shape `complete_spa_wellness_ingestion` reads, per window. */
export function buildSpaWellnessPayload(
  report: ParsedSpaWellnessReport,
  window: ParsedSpaWellnessWindow,
) {
  /*
   * Per-equipment dates are attached to the USE rows here rather than stored in
   * a table of their own. They describe a (salon, equipment) pair and are the
   * same across the three windows — the date sheets carry one value each — so a
   * separate table would either duplicate them per window or need a fourth
   * grain nothing else uses.
   */
  const dates = new Map(
    report.equipmentDates.map((entry) => [
      `${entry.storeName}|${entry.equipmentCode}`,
      entry,
    ]),
  );

  return {
    period: {
      grain: window.period.grain,
      period_end: window.period.periodEnd,
      period_start: window.period.periodStart,
      fiscal_year: window.period.fiscalYear,
      label_raw: window.period.labelRaw,
    },
    window_code: window.window,
    source_sheet: window.sheetName,
    company: report.company,
    equipment_types: window.equipmentTypes.map((type) => ({
      code: type.code,
      label: type.label,
      short_label: type.shortLabel,
      is_comparable: type.isComparable,
      display_order: type.displayOrder,
    })),
    salons: window.salons.map((salon) => ({
      store_name: salon.storeName,
      total_sessions: salon.totalSessions,
      equipment_pieces: salon.equipmentPieces,
      equipment_types_used: salon.equipmentTypesUsed,
      district_label: salon.districtLabel,
      region_label: salon.regionLabel,
      first_use_date: salon.firstUseDate,
      newest_first_use_date: salon.newestFirstUseDate,
      is_comp_salon: salon.isCompSalon,
      source_row: salon.sourceRow,
    })),
    equipment_use: window.equipmentUse.map((use) => {
      const date = dates.get(`${use.storeName}|${use.equipmentCode}`);
      return {
        store_name: use.storeName,
        equipment_code: use.equipmentCode,
        sessions: use.sessions,
        first_use_date: date?.firstUseDate ?? null,
        last_use_date: date?.lastUseDate ?? null,
        source_row: use.sourceRow,
      };
    }),
    benchmarks: window.benchmarks.map((benchmark) => ({
      equipment_code: benchmark.equipmentCode,
      chain_salon_count: benchmark.chainSalonCount,
      chain_average_sessions: benchmark.chainAverageSessions,
      peer_salon_count: benchmark.peerSalonCount,
      peer_average_sessions: benchmark.peerAverageSessions,
    })),
    diagnostics: {
      source_salon_count: window.diagnostics.sourceSalonCount,
      not_installed_cells: window.diagnostics.notInstalledCells,
    },
    warnings: report.warnings,
  };
}

/** The payload shape `complete_spa_engagement_ingestion` reads. */
export function buildSpaEngagementPayload(report: ParsedSpaEngagementReport) {
  return {
    period: {
      grain: report.period.grain,
      period_end: report.period.periodEnd,
      period_start: report.period.periodStart,
      fiscal_year: report.period.fiscalYear,
      label_raw: report.period.labelRaw,
    },
    company: report.company,
    rank_population: report.rankPopulation,
    rank_weights: report.rankWeights,
    /*
     * THE ROSTER, which is the only reason this delivery may introduce a salon:
     * it is the only place a salon number appears in any of the three reports.
     * Sent as (number, name, opened) — never the addresses, phone numbers or
     * e-mail addresses the roster sheet also carries, which this application
     * has no use for and should not hold.
     */
    roster: report.roster.map((entry) => ({
      salon_number: entry.salonNumber,
      store_name: entry.storeName,
      opened_at: entry.openedAt,
    })),
    salons: report.salons.map((salon) => ({
      salon_number: salon.salonNumber,
      store_name: salon.storeName,
      spa_sessions: salon.spaSessions,
      total_unique_tanners: salon.totalUniqueTanners,
      unique_spa_tanners: salon.uniqueSpaTanners,
      spa_beds: salon.spaBeds,
      ownership: salon.ownership,
      district_label: salon.districtLabel,
      region_label: salon.regionLabel,
      reported_spa_sessions_per_bed: salon.reportedSpaSessionsPerBed,
      reported_spa_sessions_per_unique_per_bed: salon.reportedSpaSessionsPerUniquePerBed,
      reported_unique_spa_tanner_pct: salon.reportedUniqueSpaTannerPct,
      reported_ranks: salon.reportedRanks,
      reported_overall_rank: salon.reportedOverallRank,
      computed_weighted_score: salon.computedWeightedScore,
      source_row: salon.sourceRow,
    })),
    managers: report.managers.map((manager) => ({
      district_label: manager.districtLabel,
      region_label: manager.regionLabel,
      spa_sessions: manager.spaSessions,
      total_unique_tanners: manager.totalUniqueTanners,
      unique_spa_tanners: manager.uniqueSpaTanners,
      spa_beds: manager.spaBeds,
      reported_overall_rank: manager.reportedOverallRank,
    })),
    inventory: report.bedInventory.map((row) => ({
      store_name: row.storeName,
      type_description: row.typeDescription,
      units: row.units,
      category: row.category,
    })),
    daily: report.dailyEngagement.map((row) => ({
      store_name: row.storeName,
      activity_date: row.date,
      unique_tanners: row.uniqueTanners,
      unique_spa_tanners: row.uniqueSpaTanners,
      total_visits: row.totalVisits,
      spa_visits: row.spaVisits,
    })),
    diagnostics: {
      source_salon_count: report.diagnostics.sourceSalonCount,
      unrostered_salons: report.diagnostics.unrosteredSalons,
      daily_range_start: report.diagnostics.dailyDateRange?.[0] ?? null,
      daily_range_end: report.diagnostics.dailyDateRange?.[1] ?? null,
    },
    warnings: report.warnings,
  };
}

/**
 * A window's own attempt key.
 *
 * `spa_wellness_tracking` reads three sheets from one file and each becomes its
 * own period. The idempotency index is
 * `(file_id, parser_key, parser_version) where status = 'succeeded'`, so three
 * attempts under one key would make the second and third look like duplicates
 * of the first — and only one window would ever load. Qualifying the key with
 * the window makes them three distinct attempts of the same file, which is what
 * they are.
 */
export function windowParserKey(parserKey: string, window: string): string {
  return `${parserKey}:${window}`;
}

/** What one family's write returned, in the shape the intake layer reports. */
export interface BedSpaIngestionResult extends IngestionResult {
  /** Salon names the delivery named that this application could not place. */
  unresolvedSalons: string[];
  /** Which period this write landed in, for the response's period list. */
  period: {
    grain: string;
    periodStart: string;
    periodEnd: string;
    label: string;
  } | null;
}

export class SupabaseBedSpaRepository {
  private readonly client: SupabaseClient;

  constructor(client: SupabaseClient = getSupabaseAdmin()) {
    this.client = client;
  }

  async ingestBedUsage(input: {
    sourceCode?: string;
    file: SourceFileRecord;
    report: ParsedBedUsageReport;
  }): Promise<BedSpaIngestionResult> {
    return this.run({
      sourceCode: input.sourceCode ?? "bed_usage_email",
      file: input.file,
      parserKey: input.report.parserKey,
      parserVersion: input.report.parserVersion,
      sheetNames: [...input.report.sourceSheetNames],
      completeFunction: "complete_bed_usage_ingestion",
      payload: buildBedUsagePayload(input.report),
      period: {
        grain: input.report.period.grain,
        periodStart: input.report.period.periodStart,
        periodEnd: input.report.period.periodEnd,
        label: input.report.period.labelRaw,
      },
    });
  }

  /**
   * One call per window. Returns one result per window, in sheet order.
   *
   * A WINDOW'S FAILURE IS THAT WINDOW'S ALONE. Each is its own attempt and its
   * own transaction, so a YTD sheet that cannot be written leaves the MTD
   * figures exactly as they landed — which matters because MTD is the window
   * the Spa Conversion Rate joins against.
   */
  async ingestSpaWellness(input: {
    sourceCode?: string;
    file: SourceFileRecord;
    report: ParsedSpaWellnessReport;
  }): Promise<BedSpaIngestionResult[]> {
    const results: BedSpaIngestionResult[] = [];
    for (const window of input.report.windows) {
      results.push(
        await this.run({
          sourceCode: input.sourceCode ?? "spa_wellness_email",
          file: input.file,
          parserKey: windowParserKey(input.report.parserKey, window.window),
          parserVersion: input.report.parserVersion,
          sheetNames: [window.sheetName],
          completeFunction: "complete_spa_wellness_ingestion",
          payload: buildSpaWellnessPayload(input.report, window),
          period: {
            grain: window.period.grain,
            periodStart: window.period.periodStart,
            periodEnd: window.period.periodEnd,
            label: window.period.labelRaw,
          },
        }),
      );
    }
    return results;
  }

  async ingestSpaEngagement(input: {
    sourceCode?: string;
    file: SourceFileRecord;
    report: ParsedSpaEngagementReport;
  }): Promise<BedSpaIngestionResult> {
    return this.run({
      sourceCode: input.sourceCode ?? "spa_engagement_email",
      file: input.file,
      parserKey: input.report.parserKey,
      parserVersion: input.report.parserVersion,
      sheetNames: [...input.report.sourceSheetNames],
      completeFunction: "complete_spa_engagement_ingestion",
      payload: buildSpaEngagementPayload(input.report),
      period: {
        grain: input.report.period.grain,
        periodStart: input.report.period.periodStart,
        periodEnd: input.report.period.periodEnd,
        label: input.report.period.labelRaw,
      },
    });
  }

  /** begin -> complete -> (fail). The one implementation all three share. */
  private async run(input: {
    sourceCode: string;
    file: SourceFileRecord;
    parserKey: string;
    parserVersion: number;
    sheetNames: string[];
    completeFunction: string;
    payload: unknown;
    period: BedSpaIngestionResult["period"];
  }): Promise<BedSpaIngestionResult> {
    const { file } = input;

    const begun = await this.client.rpc("begin_report_ingestion", {
      p_source_code: input.sourceCode,
      p_file: {
        storage_bucket: file.storageBucket ?? REPORTING_BUCKET,
        storage_path: file.storagePath,
        original_filename: file.originalFilename,
        mime_type: file.mimeType,
        size_bytes: file.sizeBytes,
        file_sha256: file.sha256,
        external_message_id: file.externalMessageId,
        external_archive_url: file.externalArchiveUrl,
        // Read only when the RPC CREATES the file row. A re-delivery matches by
        // digest and must not rewrite the first delivery's lineage.
        sender_email: file.senderEmail ?? null,
        received_at: file.receivedAt ?? null,
        inbound_email_id: file.inboundEmailId ?? null,
      },
      p_parser_key: input.parserKey,
      p_parser_version: input.parserVersion,
      p_fingerprint: ingestionFingerprint({
        sourceCode: input.sourceCode,
        fileSha256: file.sha256,
        parserKey: input.parserKey,
        parserVersion: input.parserVersion,
      }),
      p_sheet_names: input.sheetNames,
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
        unresolvedSalons: [],
        period: null,
      };
    }

    const completed = await this.client.rpc(input.completeFunction, {
      p_ingestion_id: opened.ingestion_id,
      p_payload: input.payload,
    });

    if (completed.error) {
      // The atomic write rolled back. The attempt row survives because it was
      // committed separately, so record WHY.
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
        unresolvedSalons: [],
        period: null,
      };
    }

    const result = (completed.data ?? {}) as {
      period_id?: string;
      salon_count?: number;
      fact_count?: number;
      superseded_facts?: number;
      unresolved_salons?: string[];
    };

    return {
      outcome: "succeeded",
      ingestionId: opened.ingestion_id,
      fileId: opened.file_id,
      periodId: result.period_id ?? null,
      factCount: result.fact_count ?? 0,
      salonCount: result.salon_count ?? 0,
      supersededFacts: result.superseded_facts ?? 0,
      supersededAttributes: 0,
      fileCreated: opened.file_created,
      failureReason: null,
      unresolvedSalons: result.unresolved_salons ?? [],
      period: input.period,
    };
  }
}
