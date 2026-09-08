import type { PerformanceBand } from "../../performance/classification";

/**
 * ============================================================================
 * THE ROW SHAPES THE THREE NEW REPORTS ARE ANALYSED OVER
 * ============================================================================
 *
 * These are the boundary between "where the numbers came from" and "what the
 * numbers mean". Everything in the analytics modules next door is a pure
 * function of these types, which has two consequences worth stating:
 *
 *   THE SAME ARITHMETIC RUNS OVER A PARSED WORKBOOK AND OVER DATABASE ROWS.
 *   A parser produces these; the Supabase read layer produces these; a test
 *   builds them by hand. So a dashboard figure, a regression test and an
 *   ingestion-time validation are all computing the same thing, and there is no
 *   second implementation of Spa Conversion Rate to drift.
 *
 *   NOTHING HERE HOLDS A FIGURE FOR A SALON OUTSIDE THE AUTHORIZED SLICE.
 *   Peer and chain comparisons appear only as BENCHMARKS — an average and a
 *   count, with no salon, company or store name — because that is all a
 *   comparison needs and it is the whole of what may be shown.
 *
 * A note on `null`. Every measure is nullable and null means THE SOURCE DID NOT
 * REPORT IT. It is never coerced to zero anywhere in these modules: a salon
 * that reported nothing and a salon that did nothing are different facts, and
 * the second is a finding while the first is a gap.
 */

/** The report period a set of rows belongs to. */
export interface BedSpaPeriod {
  readonly grain: "mtd" | "ytd" | "ltm";
  readonly periodStart: string;
  readonly periodEnd: string;
  /** The period exactly as the source wrote it. */
  readonly labelRaw: string;
}

/** Where a figure came from, for the provenance line every tab carries. */
export interface BedSpaProvenance {
  readonly period: BedSpaPeriod;
  /** ISO instant the delivery was ingested. Null when not recorded. */
  readonly ingestedAt: string | null;
  readonly originalFilename: string | null;
  readonly parserKey: string | null;
  readonly parserVersion: number | null;
  readonly sourceSheetNames: readonly string[];
  /** How many salons this report covers, counted from the live facts. */
  readonly salonCount: number;
  /** How many salons the SOURCE delivery covered, before scoping. */
  readonly sourceSalonCount: number | null;
}

// ------------------------------------------------------------- bed usage ---

/** One salon's whole-salon bed usage figures. */
export interface BedUsageSalonRow {
  readonly salonNumber: string | null;
  readonly storeName: string;
  readonly districtLabel: string | null;
  readonly regionLabel: string | null;
  /** The source's `Salon Tans`, read once per salon. */
  readonly totalTans: number | null;
  readonly bedCount: number | null;
}

/** One salon's one equipment row. */
export interface BedUsageEquipmentRow {
  readonly salonNumber: string | null;
  readonly storeName: string;
  readonly districtLabel: string | null;
  readonly regionLabel: string | null;
  readonly level: string;
  readonly bedType: string;
  readonly qty: number | null;
  readonly clientTans: number | null;
  readonly perBed: number | null;
  /** A PERCENTAGE difference, already converted from the source's ratio. */
  readonly vChainPercent: number | null;
  readonly vBedTypePercent: number | null;
}

/** The chain benchmark for one equipment level. Names nobody. */
export interface BedUsageChainBenchmarkRow {
  readonly level: string;
  readonly tansPerBed: number | null;
  readonly totalBeds: number | null;
}

// ---------------------------------------------------------- spa wellness ---

export interface SpaEquipmentTypeRow {
  readonly code: string;
  readonly label: string;
  readonly shortLabel: string;
  /** False for the `Other` catch-all, which is not the same machine anywhere. */
  readonly isComparable: boolean;
  readonly displayOrder: number;
}

/** One salon's spa wellness row for one window. */
export interface SpaWellnessSalonRow {
  readonly salonNumber: string | null;
  readonly storeName: string;
  readonly districtLabel: string | null;
  readonly regionLabel: string | null;
  readonly totalSessions: number | null;
  /** Installed UNITS, from the source's own count. */
  readonly equipmentPieces: number | null;
  /** Distinct types with non-zero use. */
  readonly equipmentTypesUsed: number;
  readonly firstUseDate: string | null;
  readonly newestFirstUseDate: string | null;
}

/**
 * One salon's use of one equipment type.
 *
 * A ROW EXISTS ONLY WHERE THE EQUIPMENT IS INSTALLED AND USED. There is no
 * zero-valued row, because a zero in this source means the equipment is not
 * there — see `spa-wellness/metric-map.ts`.
 */
export interface SpaEquipmentUseRow {
  readonly salonNumber: string | null;
  readonly storeName: string;
  readonly equipmentCode: string;
  readonly sessions: number;
  readonly firstUseDate: string | null;
  readonly lastUseDate: string | null;
}

/** The peer benchmark for one equipment type. Names nobody. */
export interface SpaEquipmentBenchmarkRow {
  readonly equipmentCode: string;
  /** Salons across the whole chain that used this equipment. */
  readonly chainSalonCount: number;
  readonly chainAverageSessions: number | null;
  /** Salons OUTSIDE the authorized company that used this equipment. */
  readonly peerSalonCount: number;
  readonly peerAverageSessions: number | null;
}

// -------------------------------------------------------- spa engagement ---

export interface SpaEngagementSalonRow {
  readonly salonNumber: string | null;
  readonly storeName: string;
  readonly districtLabel: string | null;
  readonly regionLabel: string | null;
  readonly ownership: string | null;
  readonly spaSessions: number | null;
  readonly totalUniqueTanners: number | null;
  readonly uniqueSpaTanners: number | null;
  readonly spaBeds: number | null;
  /** The chain-wide rank the source published, by rank-metric code. */
  readonly ranks: Readonly<Record<string, number | null>>;
  readonly overallRank: number | null;
}

// ------------------------------------------------------- computed results ---

/** A measure with its classification, ready to render. */
export interface ClassifiedMeasure {
  readonly value: number | null;
  readonly benchmark: number | null;
  readonly deltaPercent: number | null;
  readonly band: PerformanceBand | null;
  /** False where the shortfall must not be raised — see the FAST rule. */
  readonly reportableFinding: boolean;
  /** Set when a figure is unavailable, saying why. */
  readonly unavailableReason: string | null;
}
