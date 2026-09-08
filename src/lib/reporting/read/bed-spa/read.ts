import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/server";
import { AUTHORIZED_COMPANY } from "../../store-identity";
import { periodLabel, type BedSpaPeriodOption } from "./period-token";
import type {
  BedSpaPeriod,
  BedSpaProvenance,
  BedUsageChainBenchmarkRow,
  BedUsageEquipmentRow,
  BedUsageSalonRow,
  SpaEngagementSalonRow,
  SpaEquipmentBenchmarkRow,
  SpaEquipmentTypeRow,
  SpaEquipmentUseRow,
  SpaWellnessSalonRow,
} from "./types";

/**
 * ============================================================================
 * THE BED USAGE AND SPA READ LAYER
 * ============================================================================
 *
 * Server-only, same posture as the Comp Report and Sales Totals read layers and
 * for the same reason: there is no identity provider yet, `authenticated` is a
 * role nobody holds, and a browser client would read zero rows through RLS. So
 * reads run server-side under the secret key, and `import "server-only"` makes
 * a client component importing this file a BUILD failure rather than a review
 * comment.
 *
 * THREE RULES THIS MODULE ENFORCES BY ITS SHAPE:
 *
 *   EVERY READ IS SCOPED TO ONE PERIOD AND ONE COMPANY. Both are parameters of
 *   every function, and the company defaults to the authorized one. There is
 *   deliberately no function here that reads across companies, so a query
 *   written later cannot widen the slice by forgetting a filter — and the
 *   parser has already ensured no other company's rows exist to be read.
 *
 *   IT NEVER AGGREGATES ACROSS PERIODS. MTD, YTD and LTM through the same day
 *   are three periods covering 1x, 8x and 12x the sessions. Every function
 *   takes one `periodId`; there is no "sum the year" helper, because the year
 *   is a period of its own that the source already computed.
 *
 *   NULL MEANS THE SOURCE DID NOT REPORT IT, all the way through. Numeric
 *   columns come back from PostgREST as strings or nulls; `num()` below
 *   converts and preserves the null rather than defaulting to zero.
 */

/** A numeric column from PostgREST. Null stays null; never coerced to zero. */
function num(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** A text column, trimmed, or null. */
function str(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/** An integer column, or null. */
function int(value: unknown): number | null {
  const parsed = num(value);
  return parsed === null ? null : Math.round(parsed);
}

/*
 * PERIOD IDENTITY AND DISPLAY live in `period-token.ts`, which carries no
 * server dependency — the filter bar is a client component and needs them, and
 * this module's `import "server-only"` correctly refuses that. Re-exported here
 * so a server component has one import for the whole read surface.
 */
export {
  formatBedSpaDate,
  formatLoadedAt,
  matchingPeriod,
  parsePeriodToken,
  periodLabel,
  periodToken,
  resolvePeriod,
  type BedSpaPeriodOption,
} from "./period-token";

// ------------------------------------------------------------- bed usage ---

export interface BedUsageRead {
  readonly period: BedSpaPeriod;
  readonly provenance: BedSpaProvenance;
  readonly salons: readonly BedUsageSalonRow[];
  readonly equipment: readonly BedUsageEquipmentRow[];
  readonly benchmarks: readonly BedUsageChainBenchmarkRow[];
}

/** Every Bed Usage period that has loaded, newest first. */
export async function listBedUsagePeriods(
  company: string = AUTHORIZED_COMPANY,
): Promise<BedSpaPeriodOption[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("bed_usage_current_salon_facts")
    .select("period_id, grain, period_start, period_end, period_label, ingested_at, salon_number")
    .eq("company", company);
  if (error || !data) return [];
  return groupPeriods(data as Record<string, unknown>[]);
}

/** Rolls fact rows up into the period options a control offers. */
function groupPeriods(rows: Record<string, unknown>[]): BedSpaPeriodOption[] {
  const byPeriod = new Map<string, BedSpaPeriodOption & { salons: Set<string> }>();
  for (const row of rows) {
    const periodId = String(row.period_id ?? "");
    if (periodId.length === 0) continue;
    const existing = byPeriod.get(periodId);
    if (existing) {
      existing.salons.add(String(row.salon_number ?? ""));
      continue;
    }
    const grain = String(row.grain ?? "mtd");
    const periodStart = String(row.period_start ?? "");
    const periodEnd = String(row.period_end ?? "");
    byPeriod.set(periodId, {
      periodId,
      grain: grain as BedSpaPeriod["grain"],
      periodStart,
      periodEnd,
      labelRaw: String(row.period_label ?? ""),
      label: periodLabel(grain, periodStart, periodEnd),
      ingestedAt: str(row.ingested_at),
      salonCount: 0,
      salons: new Set([String(row.salon_number ?? "")]),
    });
  }
  return [...byPeriod.values()]
    .map(({ salons, ...option }) => ({ ...option, salonCount: salons.size }))
    .sort(
      (a, b) =>
        // Newest period first, then by a DELIBERATE grain precedence.
        b.periodEnd.localeCompare(a.periodEnd) ||
        GRAIN_PRECEDENCE.indexOf(a.grain) - GRAIN_PRECEDENCE.indexOf(b.grain),
    );
}

/**
 * Which window a report opens on when three end on the same day.
 *
 * MONTH TO DATE FIRST, and not alphabetically. The SPA Wellness workbook
 * carries MTD, YTD and LTM all ending on the month's last day, and sorting
 * their grain strings puts `ltm` first — so the tab opened on a
 * twelve-month accumulation while its heading said the month, and every
 * figure was twelve times what a reader expected. The month is also the
 * window Spa Conversion Rate joins against, which makes it the right default
 * for a second reason.
 */
const GRAIN_PRECEDENCE: readonly string[] = ["mtd", "ytd", "ltm"];

/**
 * One Bed Usage period, in full.
 *
 * Three queries rather than one join, because the three grains are genuinely
 * three answers: 15 salon rows, 150 equipment rows and 6 benchmark rows. A
 * single joined query would return 150 copies of each salon total, which is
 * the same repetition the source makes and this schema exists to undo.
 */
export async function loadBedUsage(
  periodId: string,
  company: string = AUTHORIZED_COMPANY,
): Promise<BedUsageRead | null> {
  const client = getSupabaseAdmin();

  const [salonResult, equipmentResult, benchmarkResult] = await Promise.all([
    client
      .from("bed_usage_current_salon_facts")
      .select(
        "period_id, grain, period_start, period_end, period_label, source_salon_count, salon_number, store_name, district_label, region_label, total_tans, bed_count, ingested_at, parser_key, parser_version, original_filename",
      )
      .eq("period_id", periodId)
      .eq("company", company),
    client
      .from("bed_usage_current_equipment_facts")
      .select(
        "salon_number, store_name, district_label, region_label, level, level_advisory_only, bed_type, qty, client_tans, per_bed, v_chain_percent, v_bed_type_percent, chain_tans_per_bed",
      )
      .eq("period_id", periodId)
      .eq("company", company),
    client
      .from("bed_usage_chain_benchmarks")
      .select("level, tans_per_bed, total_beds")
      .eq("period_id", periodId)
      .is("superseded_by_ingestion_id", null),
  ]);

  const salonRows = (salonResult.data ?? []) as Record<string, unknown>[];
  if (salonResult.error || salonRows.length === 0) return null;

  const first = salonRows[0];
  const period: BedSpaPeriod = {
    grain: String(first.grain ?? "mtd") as BedSpaPeriod["grain"],
    periodStart: String(first.period_start ?? ""),
    periodEnd: String(first.period_end ?? ""),
    labelRaw: String(first.period_label ?? ""),
  };

  return {
    period,
    provenance: {
      period,
      ingestedAt: str(first.ingested_at),
      originalFilename: str(first.original_filename),
      parserKey: str(first.parser_key),
      parserVersion: int(first.parser_version),
      sourceSheetNames: ["Summary", "Usage Detail"],
      salonCount: salonRows.length,
      sourceSalonCount: int(first.source_salon_count),
    },
    salons: salonRows.map((row) => ({
      salonNumber: str(row.salon_number),
      storeName: String(row.store_name ?? ""),
      districtLabel: str(row.district_label),
      regionLabel: str(row.region_label),
      totalTans: num(row.total_tans),
      bedCount: int(row.bed_count),
    })),
    equipment: ((equipmentResult.data ?? []) as Record<string, unknown>[]).map((row) => ({
      salonNumber: str(row.salon_number),
      storeName: String(row.store_name ?? ""),
      districtLabel: str(row.district_label),
      regionLabel: str(row.region_label),
      level: String(row.level ?? ""),
      bedType: String(row.bed_type ?? ""),
      qty: int(row.qty),
      clientTans: num(row.client_tans),
      perBed: num(row.per_bed),
      vChainPercent: num(row.v_chain_percent),
      vBedTypePercent: num(row.v_bed_type_percent),
    })),
    benchmarks: ((benchmarkResult.data ?? []) as Record<string, unknown>[]).map((row) => ({
      level: String(row.level ?? ""),
      tansPerBed: num(row.tans_per_bed),
      totalBeds: int(row.total_beds),
    })),
  };
}

// ---------------------------------------------------------- spa wellness ---

export interface SpaWellnessRead {
  readonly period: BedSpaPeriod;
  readonly windowCode: string;
  readonly provenance: BedSpaProvenance;
  readonly salons: readonly SpaWellnessSalonRow[];
  readonly equipmentTypes: readonly SpaEquipmentTypeRow[];
  readonly equipmentUse: readonly SpaEquipmentUseRow[];
  readonly benchmarks: readonly SpaEquipmentBenchmarkRow[];
  /** Equipment cells the source left blank or zero. Not installed, not idle. */
  readonly notInstalledCells: number | null;
}

export async function listSpaWellnessPeriods(
  company: string = AUTHORIZED_COMPANY,
): Promise<BedSpaPeriodOption[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("spa_wellness_current_salon_facts")
    .select("period_id, grain, period_start, period_end, period_label, ingested_at, salon_number")
    .eq("company", company);
  if (error || !data) return [];
  return groupPeriods(data as Record<string, unknown>[]);
}

export async function loadSpaWellness(
  periodId: string,
  company: string = AUTHORIZED_COMPANY,
): Promise<SpaWellnessRead | null> {
  const client = getSupabaseAdmin();

  const [salonResult, equipmentResult] = await Promise.all([
    client
      .from("spa_wellness_current_salon_facts")
      .select(
        "period_id, grain, period_start, period_end, period_label, window_code, source_sheet, source_salon_count, not_installed_cell_count, salon_number, store_name, district_label, region_label, total_sessions, equipment_pieces, equipment_types_used, first_use_date, newest_first_use_date, ingested_at, parser_key, parser_version, original_filename",
      )
      .eq("period_id", periodId)
      .eq("company", company),
    client
      .from("spa_wellness_current_equipment_facts")
      .select(
        "salon_number, store_name, equipment_code, equipment_label, equipment_short_label, is_comparable, display_order, sessions, first_use_date, last_use_date, chain_salon_count, chain_average_sessions, peer_salon_count, peer_average_sessions",
      )
      .eq("period_id", periodId)
      .eq("company", company),
  ]);

  const salonRows = (salonResult.data ?? []) as Record<string, unknown>[];
  if (salonResult.error || salonRows.length === 0) return null;

  const first = salonRows[0];
  const period: BedSpaPeriod = {
    grain: String(first.grain ?? "mtd") as BedSpaPeriod["grain"],
    periodStart: String(first.period_start ?? ""),
    periodEnd: String(first.period_end ?? ""),
    labelRaw: String(first.period_label ?? ""),
  };

  const equipmentRows = (equipmentResult.data ?? []) as Record<string, unknown>[];

  /*
   * The equipment TYPES and their BENCHMARKS are de-duplicated out of the use
   * rows rather than read separately. Every use row carries its type's labels
   * and its period's benchmark, so one query answers three questions and the
   * three cannot disagree about which types are in view.
   */
  const types = new Map<string, SpaEquipmentTypeRow>();
  const benchmarks = new Map<string, SpaEquipmentBenchmarkRow>();
  for (const row of equipmentRows) {
    const code = String(row.equipment_code ?? "");
    if (code.length === 0) continue;
    if (!types.has(code)) {
      types.set(code, {
        code,
        label: String(row.equipment_label ?? code),
        shortLabel: String(row.equipment_short_label ?? code),
        isComparable: row.is_comparable !== false,
        displayOrder: int(row.display_order) ?? 0,
      });
    }
    if (!benchmarks.has(code)) {
      benchmarks.set(code, {
        equipmentCode: code,
        chainSalonCount: int(row.chain_salon_count) ?? 0,
        chainAverageSessions: num(row.chain_average_sessions),
        peerSalonCount: int(row.peer_salon_count) ?? 0,
        peerAverageSessions: num(row.peer_average_sessions),
      });
    }
  }

  return {
    period,
    windowCode: String(first.window_code ?? period.grain),
    provenance: {
      period,
      ingestedAt: str(first.ingested_at),
      originalFilename: str(first.original_filename),
      parserKey: str(first.parser_key),
      parserVersion: int(first.parser_version),
      sourceSheetNames: [String(first.source_sheet ?? ""), "First Use Dates", "Last Use Dates"],
      salonCount: salonRows.length,
      sourceSalonCount: int(first.source_salon_count),
    },
    notInstalledCells: int(first.not_installed_cell_count),
    salons: salonRows.map((row) => ({
      salonNumber: str(row.salon_number),
      storeName: String(row.store_name ?? ""),
      districtLabel: str(row.district_label),
      regionLabel: str(row.region_label),
      totalSessions: num(row.total_sessions),
      equipmentPieces: int(row.equipment_pieces),
      equipmentTypesUsed: int(row.equipment_types_used) ?? 0,
      firstUseDate: str(row.first_use_date),
      newestFirstUseDate: str(row.newest_first_use_date),
    })),
    equipmentTypes: [...types.values()].sort((a, b) => a.displayOrder - b.displayOrder),
    equipmentUse: equipmentRows.map((row) => ({
      salonNumber: str(row.salon_number),
      storeName: String(row.store_name ?? ""),
      equipmentCode: String(row.equipment_code ?? ""),
      sessions: num(row.sessions) ?? 0,
      firstUseDate: str(row.first_use_date),
      lastUseDate: str(row.last_use_date),
    })),
    benchmarks: [...benchmarks.values()],
  };
}

// -------------------------------------------------------- spa engagement ---

export interface SpaEngagementRead {
  readonly period: BedSpaPeriod;
  readonly provenance: BedSpaProvenance;
  readonly salons: readonly SpaEngagementSalonRow[];
  /** How many salons the chain-wide ranking was computed over. */
  readonly rankPopulation: number | null;
  /** The weights the delivery carried, by rank-metric code. */
  readonly rankWeights: Readonly<Record<string, number>>;
}

export async function listSpaEngagementPeriods(
  company: string = AUTHORIZED_COMPANY,
): Promise<BedSpaPeriodOption[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("spa_engagement_current_salon_facts")
    .select("period_id, grain, period_start, period_end, period_label, ingested_at, salon_number")
    .eq("company", company);
  if (error || !data) return [];
  return groupPeriods(data as Record<string, unknown>[]);
}

export async function loadSpaEngagement(
  periodId: string,
  company: string = AUTHORIZED_COMPANY,
): Promise<SpaEngagementRead | null> {
  const { data, error } = await getSupabaseAdmin()
    .from("spa_engagement_current_salon_facts")
    .select(
      "period_id, grain, period_start, period_end, period_label, rank_population, rank_weights, source_salon_count, salon_number, store_name, district_label, region_label, ownership, spa_sessions, total_unique_tanners, unique_spa_tanners, spa_beds, reported_ranks, reported_overall_rank, ingested_at, parser_key, parser_version, original_filename",
    )
    .eq("period_id", periodId)
    .eq("company", company);

  const rows = (data ?? []) as Record<string, unknown>[];
  if (error || rows.length === 0) return null;

  const first = rows[0];
  const period: BedSpaPeriod = {
    grain: String(first.grain ?? "mtd") as BedSpaPeriod["grain"],
    periodStart: String(first.period_start ?? ""),
    periodEnd: String(first.period_end ?? ""),
    labelRaw: String(first.period_label ?? ""),
  };

  return {
    period,
    provenance: {
      period,
      ingestedAt: str(first.ingested_at),
      originalFilename: str(first.original_filename),
      parserKey: str(first.parser_key),
      parserVersion: int(first.parser_version),
      sourceSheetNames: ["All Summary", "Roster", "Equipment Counts", "Unique by Day"],
      salonCount: rows.length,
      sourceSalonCount: int(first.source_salon_count),
    },
    rankPopulation: int(first.rank_population),
    rankWeights: normalizeWeights(first.rank_weights),
    salons: rows.map((row) => ({
      salonNumber: str(row.salon_number),
      storeName: String(row.store_name ?? ""),
      districtLabel: str(row.district_label),
      regionLabel: str(row.region_label),
      ownership: str(row.ownership),
      spaSessions: num(row.spa_sessions),
      totalUniqueTanners: num(row.total_unique_tanners),
      uniqueSpaTanners: num(row.unique_spa_tanners),
      spaBeds: int(row.spa_beds),
      ranks: normalizeRanks(row.reported_ranks),
      overallRank: int(row.reported_overall_rank),
    })),
  };
}

/** The stored weights, defensively typed. An unreadable value is dropped. */
function normalizeWeights(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object") return {};
  const out: Record<string, number> = {};
  for (const [key, weight] of Object.entries(value as Record<string, unknown>)) {
    const parsed = num(weight);
    if (parsed !== null) out[key] = parsed;
  }
  return out;
}

/** The stored ranks, defensively typed. */
function normalizeRanks(value: unknown): Record<string, number | null> {
  if (!value || typeof value !== "object") return {};
  const out: Record<string, number | null> = {};
  for (const [key, rank] of Object.entries(value as Record<string, unknown>)) {
    out[key] = int(rank);
  }
  return out;
}
