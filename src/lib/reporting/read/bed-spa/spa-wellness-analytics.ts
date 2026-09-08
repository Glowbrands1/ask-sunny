import {
  classifyVersusPeers,
  percentDifference,
} from "../../performance/classification";
import type {
  ClassifiedMeasure,
  SpaEquipmentBenchmarkRow,
  SpaEquipmentTypeRow,
  SpaEquipmentUseRow,
  SpaWellnessSalonRow,
} from "./types";

/**
 * ============================================================================
 * SPA WELLNESS ANALYTICS
 * ============================================================================
 *
 * The installed-only rule is enforced twice: once at the parser, which writes
 * no fact for an absent unit, and once here, where every average is taken over
 * the rows that EXIST rather than over the salons that might have had one.
 * Enforcing it in both places is deliberate — the read layer can be handed rows
 * from a period ingested by an older parser version, and an average over a
 * denominator of "all salons" is the single easiest way to make a well-executed
 * estate look like a failing one.
 *
 * WHAT IS NOT COMPUTED HERE, and why:
 *
 *   NO ESTATE-WIDE "SPA PERFORMANCE" SCORE. Averaging the per-equipment deltas
 *   into one number weights a two-salon Ovation the same as a fifteen-salon
 *   Hydromassage. `averagePeerDelta` below is offered as a SESSION-WEIGHTED
 *   figure with its own caveat, because "average delta" is only meaningful when
 *   somebody has said what it is an average over.
 *
 *   NO RAMP THRESHOLD. There is no approved definition of "new equipment", so
 *   nothing here decides that ninety days is young and ninety-one is not. The
 *   first-use dates are surfaced, and `daysSinceFirstUse` computes an age
 *   against a caller-supplied reference date so a reader can judge. Inventing
 *   the rule would put a number in front of a capital decision that nobody
 *   approved.
 */

/** One equipment type, ours against its installed peers. */
export interface SpaEquipmentPerformance {
  readonly equipmentCode: string;
  readonly label: string;
  readonly shortLabel: string;
  /** Salons of ours that used it. Never a count of salons that might have. */
  readonly ourSalonCount: number;
  readonly ourSessions: number;
  readonly ourAverageSessions: number | null;
  readonly peerSalonCount: number;
  readonly peerAverageSessions: number | null;
  readonly chainSalonCount: number;
  readonly chainAverageSessions: number | null;
  readonly versusPeers: ClassifiedMeasure;
  /** False for the `Other` bucket, which is not the same machine anywhere. */
  readonly comparable: boolean;
  /** Earliest first use across our salons, where the source reported one. */
  readonly firstUseDate: string | null;
  /** Latest first use — when our newest unit of this type came online. */
  readonly newestFirstUseDate: string | null;
}

/**
 * Ours against the peer average, per equipment type.
 *
 * OUR AVERAGE IS OVER OUR INSTALLED SALONS, and the peer average over theirs.
 * Both denominators are counts of salons that actually used the equipment, so
 * the comparison is like-for-like on both sides — which is the rule, and is
 * also the only comparison that answers the question being asked.
 */
export function equipmentPerformance(
  types: readonly SpaEquipmentTypeRow[],
  use: readonly SpaEquipmentUseRow[],
  benchmarks: readonly SpaEquipmentBenchmarkRow[],
): SpaEquipmentPerformance[] {
  const benchmarkByCode = new Map(
    benchmarks.map((benchmark) => [benchmark.equipmentCode, benchmark]),
  );
  const typeByCode = new Map(types.map((type) => [type.code, type]));

  const grouped = new Map<string, SpaEquipmentUseRow[]>();
  for (const row of use) {
    // Defence in depth: the parser writes no zero rows, but a period ingested
    // by an older version could carry one and it must not join an average.
    if (row.sessions <= 0) continue;
    grouped.set(row.equipmentCode, [...(grouped.get(row.equipmentCode) ?? []), row]);
  }

  const out: SpaEquipmentPerformance[] = [];
  for (const [code, rows] of grouped) {
    const type = typeByCode.get(code);
    const benchmark = benchmarkByCode.get(code) ?? null;
    const ourSessions = rows.reduce((total, row) => total + row.sessions, 0);
    const ourAverage = ourSessions / rows.length;
    const peerAverage = benchmark?.peerAverageSessions ?? null;
    const comparable = type?.isComparable ?? true;

    /*
     * THE `Other` BUCKET IS NOT COMPARED. It aggregates whatever did not map to
     * a named type, so one salon's "Other" and another's are different
     * machines. Its sessions are still counted in the estate total; only the
     * comparison is withheld.
     */
    const delta = comparable ? percentDifference(ourAverage, peerAverage) : null;

    const dates = rows
      .map((row) => row.firstUseDate)
      .filter((date): date is string => date !== null)
      .sort();

    out.push({
      equipmentCode: code,
      label: type?.label ?? code,
      shortLabel: type?.shortLabel ?? code,
      ourSalonCount: rows.length,
      ourSessions,
      ourAverageSessions: ourAverage,
      peerSalonCount: benchmark?.peerSalonCount ?? 0,
      peerAverageSessions: peerAverage,
      chainSalonCount: benchmark?.chainSalonCount ?? 0,
      chainAverageSessions: benchmark?.chainAverageSessions ?? null,
      versusPeers: {
        value: ourAverage,
        benchmark: peerAverage,
        deltaPercent: delta,
        band: classifyVersusPeers(delta),
        // Nothing in the spa report is advisory-only; the FAST rule is a bed
        // usage rule about tanning equipment.
        reportableFinding: classifyVersusPeers(delta) !== null,
        unavailableReason: !comparable
          ? "The `Other` bucket aggregates unmapped equipment, so it is not the same machine between salons and is not compared."
          : peerAverage === null
            ? "No salon outside this company used this equipment in this period, so there is no peer average."
            : null,
      },
      comparable,
      firstUseDate: dates[0] ?? null,
      newestFirstUseDate: dates[dates.length - 1] ?? null,
    });
  }

  return out.sort((a, b) => {
    const orderA = typeByCode.get(a.equipmentCode)?.displayOrder ?? Number.MAX_SAFE_INTEGER;
    const orderB = typeByCode.get(b.equipmentCode)?.displayOrder ?? Number.MAX_SAFE_INTEGER;
    return orderA - orderB;
  });
}

/** The KPI figures at the top of the Spa Wellness tab. */
export interface SpaWellnessTotals {
  readonly salonCount: number;
  readonly totalSessions: number | null;
  /** Installed spa UNITS across the salons in view. */
  readonly equipmentPieces: number | null;
  /** Distinct equipment TYPES in use across the salons in view. */
  readonly equipmentTypes: number;
  /**
   * Session-weighted average shortfall against peers, across the comparable
   * types that HAVE a peer average.
   *
   * WEIGHTED BY SESSIONS ON PURPOSE, and labelled as such wherever it is
   * shown. An unweighted mean of the deltas would let a two-salon Ovation at
   * +86% cancel a fifteen-salon Hydromassage at -21% and report the estate as
   * healthy. Null when nothing in view has a peer average, because an average
   * over nothing is not zero.
   */
  readonly weightedPeerDeltaPercent: number | null;
  /** How many comparable types the weighted figure covers. */
  readonly comparedTypeCount: number;
}

export function spaWellnessTotals(
  salons: readonly SpaWellnessSalonRow[],
  performance: readonly SpaEquipmentPerformance[],
): SpaWellnessTotals {
  const withSessions = salons.filter((salon) => salon.totalSessions !== null);
  const withPieces = salons.filter((salon) => salon.equipmentPieces !== null);

  const compared = performance.filter(
    (entry) => entry.comparable && entry.versusPeers.deltaPercent !== null,
  );
  const weight = compared.reduce((total, entry) => total + entry.ourSessions, 0);

  return {
    salonCount: salons.length,
    totalSessions:
      withSessions.length === 0
        ? null
        : withSessions.reduce((total, salon) => total + (salon.totalSessions ?? 0), 0),
    equipmentPieces:
      withPieces.length === 0
        ? null
        : withPieces.reduce((total, salon) => total + (salon.equipmentPieces ?? 0), 0),
    equipmentTypes: performance.length,
    weightedPeerDeltaPercent:
      compared.length === 0 || weight === 0
        ? null
        : compared.reduce(
            (total, entry) => total + entry.versusPeers.deltaPercent! * entry.ourSessions,
            0,
          ) / weight,
    comparedTypeCount: compared.length,
  };
}

/** One salon's spa picture, for the ranked chart and the detail table. */
export interface SpaWellnessSalonSummary extends SpaWellnessSalonRow {
  /** Sessions by equipment code, for a stacked bar or a tooltip. */
  readonly sessionsByEquipment: Readonly<Record<string, number>>;
  /** Sessions per installed unit. Recomputed, never averaged. */
  readonly sessionsPerPiece: number | null;
}

export function summarizeSpaSalons(
  salons: readonly SpaWellnessSalonRow[],
  use: readonly SpaEquipmentUseRow[],
): SpaWellnessSalonSummary[] {
  const byStore = new Map<string, SpaEquipmentUseRow[]>();
  for (const row of use) {
    byStore.set(row.storeName, [...(byStore.get(row.storeName) ?? []), row]);
  }

  return salons.map((salon) => {
    const rows = byStore.get(salon.storeName) ?? [];
    const sessionsByEquipment: Record<string, number> = {};
    for (const row of rows) {
      sessionsByEquipment[row.equipmentCode] =
        (sessionsByEquipment[row.equipmentCode] ?? 0) + row.sessions;
    }
    return {
      ...salon,
      sessionsByEquipment,
      sessionsPerPiece:
        salon.totalSessions === null ||
        salon.equipmentPieces === null ||
        salon.equipmentPieces <= 0
          ? null
          : salon.totalSessions / salon.equipmentPieces,
    };
  });
}

/**
 * How many days a piece of equipment has been in use, as of a given date.
 *
 * A REFERENCE DATE IS REQUIRED, never `new Date()`: a figure on a report about
 * August must be computed as of the report's own period end, or it changes
 * every day the page is loaded and stops matching the report it came from.
 *
 * AND THERE IS NO "NEW EQUIPMENT" FLAG HERE. No approved rule defines one, so
 * this returns an age and the reader judges. If a threshold is approved later
 * it belongs next to the other business rules, not invented in a chart.
 */
export function daysSinceFirstUse(
  firstUseDate: string | null,
  asOf: string,
): number | null {
  if (!firstUseDate) return null;
  const start = Date.parse(`${firstUseDate}T00:00:00Z`);
  const end = Date.parse(`${asOf}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.round((end - start) / 86_400_000);
}

/**
 * Equipment whose first use falls inside the reporting period.
 *
 * A FACT ABOUT THE PERIOD, not a judgement about ramp: this equipment has not
 * been installed for the whole window it is being measured over, so its session
 * count covers less time than its peers'. That is worth flagging and it is not
 * the same as saying it is new, young, or should be excused.
 */
export function firstUsedWithinPeriod(
  use: readonly SpaEquipmentUseRow[],
  period: { periodStart: string; periodEnd: string },
): SpaEquipmentUseRow[] {
  return use.filter(
    (row) =>
      row.firstUseDate !== null &&
      row.firstUseDate >= period.periodStart &&
      row.firstUseDate <= period.periodEnd,
  );
}
