import {
  classifyVersusChain,
  isAdvisoryOnlyLevel,
  isReportableFinding,
  percentDifference,
  type PerformanceBand,
} from "../../performance/classification";
import type {
  BedUsageChainBenchmarkRow,
  BedUsageEquipmentRow,
  BedUsageSalonRow,
  ClassifiedMeasure,
} from "./types";

/**
 * ============================================================================
 * BED USAGE ANALYTICS
 * ============================================================================
 *
 * Pure functions over the row shapes in `types.ts`. Two rules govern everything
 * here, and both exist because the obvious implementation of each is wrong:
 *
 * PER-BED USAGE IS RECOMPUTED, NEVER AVERAGED. Combining salons means summing
 * their tans, summing their beds, and dividing once. Averaging their per-bed
 * figures weights a 15-bed salon the same as a 29-bed one — for the fifteen
 * authorized salons in August 2026 the two differ by several tans a bed, and
 * the error grows with how uneven the estate is.
 *
 * A SALON TOTAL IS NEVER DERIVED FROM EQUIPMENT ROWS, AND EQUIPMENT ROWS ARE
 * NEVER DERIVED FROM A SALON TOTAL. The source reports both; they agree; and
 * asserting the agreement is a validation, not a shortcut. `reconcile` below
 * exists to check it and to report a disagreement rather than absorb it.
 */

/** A salon with its derived per-bed figure. */
export interface BedUsageSalonSummary {
  readonly salonNumber: string | null;
  readonly storeName: string;
  readonly districtLabel: string | null;
  readonly regionLabel: string | null
  readonly totalTans: number | null;
  readonly bedCount: number | null;
  /** Tans / beds. Null when either side is missing or beds is zero. */
  readonly perBed: number | null;
  /** How many equipment rows the source reported for this salon. */
  readonly equipmentRowCount: number;
  /** Equipment levels present, in the order the source listed them. */
  readonly levels: readonly string[];
}

export function summarizeSalons(
  salons: readonly BedUsageSalonRow[],
  equipment: readonly BedUsageEquipmentRow[],
): BedUsageSalonSummary[] {
  const byStore = new Map<string, BedUsageEquipmentRow[]>();
  for (const row of equipment) {
    byStore.set(row.storeName, [...(byStore.get(row.storeName) ?? []), row]);
  }

  return salons.map((salon) => {
    const rows = byStore.get(salon.storeName) ?? [];
    const levels: string[] = [];
    for (const row of rows) if (!levels.includes(row.level)) levels.push(row.level);
    return {
      salonNumber: salon.salonNumber,
      storeName: salon.storeName,
      districtLabel: salon.districtLabel,
      regionLabel: salon.regionLabel,
      totalTans: salon.totalTans,
      bedCount: salon.bedCount,
      perBed: perBed(salon.totalTans, salon.bedCount),
      equipmentRowCount: rows.length,
      levels,
    };
  });
}

/**
 * Tans over beds, or null.
 *
 * Zero beds gives null rather than infinity — a salon with no beds has no
 * per-bed usage, which is different from having a per-bed usage of zero.
 */
export function perBed(tans: number | null, beds: number | null): number | null {
  if (tans === null || beds === null) return null;
  if (!Number.isFinite(tans) || !Number.isFinite(beds) || beds <= 0) return null;
  return tans / beds;
}

/** The estate-level roll-up across whichever salons are in view. */
export interface BedUsageTotals {
  readonly salonCount: number;
  /** Sum of the salons' own Total Tans. Null when none reported one. */
  readonly totalTans: number | null;
  readonly bedCount: number | null;
  /** RECOMPUTED from the two sums, never averaged from the salons' figures. */
  readonly perBed: number | null;
  /** Salons whose Total Tans the source did not report. */
  readonly salonsMissingTans: number;
}

export function totalsFor(salons: readonly BedUsageSalonSummary[]): BedUsageTotals {
  const withTans = salons.filter((salon) => salon.totalTans !== null);
  const withBeds = salons.filter((salon) => salon.bedCount !== null);
  const totalTans = withTans.length === 0
    ? null
    : withTans.reduce((total, salon) => total + (salon.totalTans ?? 0), 0);
  const bedCount = withBeds.length === 0
    ? null
    : withBeds.reduce((total, salon) => total + (salon.bedCount ?? 0), 0);
  return {
    salonCount: salons.length,
    totalTans,
    bedCount,
    perBed: perBed(totalTans, bedCount),
    salonsMissingTans: salons.length - withTans.length,
  };
}

/** One equipment level rolled up across the salons in view. */
export interface BedUsageLevelSummary {
  readonly level: string;
  readonly salonCount: number;
  readonly units: number | null;
  readonly clientTans: number | null;
  /** RECOMPUTED: tans / units across the level. */
  readonly perBed: number | null;
  /** The chain's per-bed figure for this level, from the source's benchmark. */
  readonly chainPerBed: number | null;
  readonly versusChain: ClassifiedMeasure;
  /** True for FAST, where a shortfall is expected and is not a finding. */
  readonly advisoryOnly: boolean;
}

/**
 * Rolls the equipment rows up by level and compares each with the chain.
 *
 * THE COMPARISON IS RECOMPUTED FROM THE LEVEL'S OWN TOTALS, not averaged from
 * the rows' `v Chain` values. Averaging them weights a one-unit row like a
 * four-unit one, which is exactly the distortion `Per Bed` exists to remove.
 *
 * A level with no chain benchmark gets an UNCLASSIFIED comparison rather than a
 * zero: no benchmark is not a benchmark of nothing.
 */
export function summarizeLevels(
  equipment: readonly BedUsageEquipmentRow[],
  benchmarks: readonly BedUsageChainBenchmarkRow[],
): BedUsageLevelSummary[] {
  const chain = new Map(
    benchmarks.map((benchmark) => [benchmark.level.toUpperCase(), benchmark.tansPerBed]),
  );

  const grouped = new Map<
    string,
    { units: number; tans: number; salons: Set<string>; hasUnits: boolean; hasTans: boolean }
  >();
  for (const row of equipment) {
    const key = row.level.toUpperCase();
    const bucket =
      grouped.get(key) ??
      { units: 0, tans: 0, salons: new Set<string>(), hasUnits: false, hasTans: false };
    if (row.qty !== null) {
      bucket.units += row.qty;
      bucket.hasUnits = true;
    }
    if (row.clientTans !== null) {
      bucket.tans += row.clientTans;
      bucket.hasTans = true;
    }
    bucket.salons.add(row.storeName);
    grouped.set(key, bucket);
  }

  return [...grouped.entries()]
    .map(([level, bucket]) => {
      const units = bucket.hasUnits ? bucket.units : null;
      const tans = bucket.hasTans ? bucket.tans : null;
      const ours = perBed(tans, units);
      const chainPerBed = chain.get(level) ?? null;
      const delta = percentDifference(ours, chainPerBed);
      const band = classifyVersusChain(delta);
      return {
        level,
        salonCount: bucket.salons.size,
        units,
        clientTans: tans,
        perBed: ours,
        chainPerBed,
        versusChain: classified(ours, chainPerBed, delta, band, level),
        advisoryOnly: isAdvisoryOnlyLevel(level),
      };
    })
    .sort((a, b) => a.level.localeCompare(b.level));
}

/** Assembles a `ClassifiedMeasure`, with the reason when it is unavailable. */
function classified(
  value: number | null,
  benchmark: number | null,
  delta: number | null,
  band: PerformanceBand | null,
  level: string | null,
): ClassifiedMeasure {
  let reason: string | null = null;
  if (value === null) reason = "The source did not report enough to compute per-bed usage here.";
  else if (benchmark === null) reason = "This report carries no chain benchmark for this level.";
  else if (benchmark === 0) reason = "The chain reported no usage at this level, so there is nothing to compare against.";
  return {
    value,
    benchmark,
    deltaPercent: delta,
    band,
    reportableFinding: isReportableFinding(level, band),
    unavailableReason: reason,
  };
}

/** One equipment row with its comparison attached, for the detail table. */
export interface BedUsageEquipmentDetail extends BedUsageEquipmentRow {
  readonly versusChain: ClassifiedMeasure;
  readonly advisoryOnly: boolean;
  /** This row's share of its salon's tans, recomputed from the salon total. */
  readonly shareOfSalonTans: number | null;
}

export function detailRows(
  equipment: readonly BedUsageEquipmentRow[],
  salons: readonly BedUsageSalonRow[],
  benchmarks: readonly BedUsageChainBenchmarkRow[],
): BedUsageEquipmentDetail[] {
  const chain = new Map(
    benchmarks.map((benchmark) => [benchmark.level.toUpperCase(), benchmark.tansPerBed]),
  );
  const salonTans = new Map(salons.map((salon) => [salon.storeName, salon.totalTans]));

  return equipment.map((row) => {
    const chainPerBed = chain.get(row.level.toUpperCase()) ?? null;
    /*
     * The source's own `v Chain` is preferred where it exists, because it is
     * what the report published and a manager may be holding a printout of it.
     * The recomputed figure is the fallback for a delivery whose column was
     * absent — the two agree to floating-point noise on all 2,907 rows of the
     * August 2026 report.
     */
    const delta = row.vChainPercent ?? percentDifference(row.perBed, chainPerBed);
    const band = classifyVersusChain(delta);
    const total = salonTans.get(row.storeName) ?? null;
    return {
      ...row,
      versusChain: classified(row.perBed, chainPerBed, delta, band, row.level),
      advisoryOnly: isAdvisoryOnlyLevel(row.level),
      shareOfSalonTans:
        row.clientTans === null || total === null || total === 0 ? null : row.clientTans / total,
    };
  });
}

/**
 * Top and bottom performers by a salon-level measure.
 *
 * Salons with no value for the measure are EXCLUDED rather than ranked last: a
 * salon that did not report is not the worst performer, and putting it at the
 * bottom of a "needs attention" list sends somebody to the wrong store.
 */
export function rankSalons<T>(
  rows: readonly T[],
  valueOf: (row: T) => number | null,
  options: { direction?: "desc" | "asc"; limit?: number } = {},
): T[] {
  const direction = options.direction ?? "desc";
  const ranked = rows
    .filter((row) => valueOf(row) !== null)
    .sort((a, b) => {
      const left = valueOf(a)!;
      const right = valueOf(b)!;
      return direction === "desc" ? right - left : left - right;
    });
  return options.limit === undefined ? ranked : ranked.slice(0, options.limit);
}

/**
 * Whether the salon totals and the equipment rows agree.
 *
 * The identity that holds in the source: a salon's `Salon Tans` equals the sum
 * of its equipment rows' client tans. Verified for all fifteen authorized
 * salons in the August 2026 report, to the unit.
 *
 * Returned as a list of DISAGREEMENTS rather than a boolean, so the source and
 * quality panel can name the salon. A disagreement means one of the two columns
 * was read wrongly, which is a parse defect and not a data quirk.
 */
export function reconcile(
  salons: readonly BedUsageSalonRow[],
  equipment: readonly BedUsageEquipmentRow[],
): { storeName: string; reported: number; summed: number }[] {
  const problems: { storeName: string; reported: number; summed: number }[] = [];
  for (const salon of salons) {
    if (salon.totalTans === null) continue;
    const rows = equipment.filter((row) => row.storeName === salon.storeName);
    if (rows.length === 0) continue;
    if (rows.some((row) => row.clientTans === null)) continue;
    const summed = rows.reduce((total, row) => total + (row.clientTans ?? 0), 0);
    if (Math.abs(summed - salon.totalTans) > 1e-6) {
      problems.push({ storeName: salon.storeName, reported: salon.totalTans, summed });
    }
  }
  return problems;
}

/**
 * The FAST capacity picture, which is what FAST is monitored for.
 *
 * Not a performance judgement. The approved rules say FAST removals are
 * intentional and that FAST is tracked for capacity, volume migration, and
 * whether FASTER, FASTEST and INSTANT are absorbing the demand it carried. So
 * this returns the FAST footprint alongside the premium footprint and says
 * nothing about whether either is good.
 */
export interface FastMigrationView {
  readonly fastUnits: number | null;
  readonly fastTans: number | null;
  readonly fastPerBed: number | null;
  /** FASTER, FASTEST and INSTANT together. */
  readonly premiumUnits: number | null;
  readonly premiumTans: number | null;
  readonly premiumPerBed: number | null;
  /** FAST's share of the salons' beds, as a fraction. */
  readonly fastShareOfBeds: number | null;
  /** FAST's share of the salons' tans, as a fraction. */
  readonly fastShareOfTans: number | null;
  readonly salonsWithFast: number;
  readonly note: string;
}

export const PREMIUM_LEVELS: readonly string[] = ["FASTER", "FASTEST", "INSTANT"];

export function fastMigrationView(levels: readonly BedUsageLevelSummary[]): FastMigrationView {
  const fast = levels.find((level) => isAdvisoryOnlyLevel(level.level)) ?? null;
  const premium = levels.filter((level) => PREMIUM_LEVELS.includes(level.level));

  const sum = (values: (number | null)[]): number | null => {
    const present = values.filter((value): value is number => value !== null);
    return present.length === 0 ? null : present.reduce((total, value) => total + value, 0);
  };

  const premiumUnits = sum(premium.map((level) => level.units));
  const premiumTans = sum(premium.map((level) => level.clientTans));
  const allUnits = sum(levels.map((level) => level.units));
  const allTans = sum(levels.map((level) => level.clientTans));

  return {
    fastUnits: fast?.units ?? null,
    fastTans: fast?.clientTans ?? null,
    fastPerBed: fast?.perBed ?? null,
    premiumUnits,
    premiumTans,
    premiumPerBed: perBed(premiumTans, premiumUnits),
    fastShareOfBeds:
      fast?.units === null || fast?.units === undefined || allUnits === null || allUnits === 0
        ? null
        : fast.units / allUnits,
    fastShareOfTans:
      fast?.clientTans === null || fast?.clientTans === undefined || allTans === null || allTans === 0
        ? null
        : fast.clientTans / allTans,
    salonsWithFast: fast?.salonCount ?? 0,
    note: "FAST is tracked for capacity and volume migration, not as a performance KPI. A falling FAST footprint is the intended result of a decision already taken; what matters is whether FASTER, FASTEST and INSTANT absorb the demand.",
  };
}
