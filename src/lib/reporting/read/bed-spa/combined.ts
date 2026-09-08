import { classifyVersusChain, type PerformanceBand } from "../../performance/classification";
import type { BedUsageSalonSummary } from "./bed-usage-analytics";
import { perBed } from "./bed-usage-analytics";
import {
  aggregateSpaConversion,
  computeSpaConversion,
  describePeriodMismatch,
  periodsMatch,
  type SpaConversion,
} from "./spa-conversion";
import {
  spaPerUniquePercent,
  uniqueSpaTannerPercent,
  type SpaEngagementSalonSummary,
} from "./spa-engagement-analytics";
import type { SpaWellnessSalonSummary } from "./spa-wellness-analytics";
import type { BedSpaPeriod } from "./types";

/**
 * ============================================================================
 * THE COMBINED OPERATIONAL VIEW
 * ============================================================================
 *
 * One row per salon, joining tanning traffic, spa sessions and spa engagement:
 *
 *     Salon | Total Tans | Spa Sessions | Spa Conversion | Spa Equipment
 *           | Peer Performance | Per Bed Usage | Spa Per Unique %
 *           | Unique Spa Tanner % | Status
 *
 * This is DECISION SUPPORT, and the boundary is worth stating in the module
 * that could most easily cross it. The approved rules describe where to favour
 * expansion and where to fix execution first, in words — high conversion,
 * equipment at or above peers, traffic that supports more capacity. They do NOT
 * define a threshold, a score or a ranking that says "approve this store". So
 * `status` below classifies a salon into one of a few plainly-named readings
 * and stops there. Nothing here computes an expansion recommendation, a capital
 * ranking, or a number that could be mistaken for an approval.
 *
 * THE JOIN IS ON CANONICAL SALON IDENTITY, and a salon that cannot be joined
 * appears WITH ITS REASON rather than being dropped. Three reports, three
 * populations: the bed usage report describes salons the spa report may not, and
 * the engagement report is a different delivery again. Every row therefore says
 * which of the three it drew on.
 */

/**
 * A plainly-named reading of one salon, from what the reports say.
 *
 * Each is a DESCRIPTION, not an instruction. `traffic_without_conversion` says
 * a salon has customers and is not converting them; it does not say whether the
 * answer is coaching, a different machine, or nothing at all.
 */
export type SalonStatus =
  /** Converting well and its equipment is at or above peers. */
  | "strong_execution"
  /** Converting well, but its installed equipment trails its peers. */
  | "converting_with_weak_equipment"
  /** Traffic is there and conversion is not. */
  | "traffic_without_conversion"
  /** Below the estate on both traffic and conversion. */
  | "low_traffic_and_conversion"
  /** Has spa equipment first used inside this period, so its window is short. */
  | "partial_period_equipment"
  /** Not enough of the three reports joined to say anything. */
  | "insufficient_data";

export const SALON_STATUS_TEXT: Readonly<Record<SalonStatus, { label: string; note: string }>> = {
  strong_execution: {
    label: "Strong execution",
    note: "Spa conversion is above this estate's rate and the salon's installed equipment is at or above its peers.",
  },
  converting_with_weak_equipment: {
    label: "Converting, equipment behind peers",
    note: "Spa conversion is above this estate's rate while at least one installed unit runs below the peers who have the same equipment.",
  },
  traffic_without_conversion: {
    label: "Traffic, weak conversion",
    note: "Tanning traffic is at or above this estate's average and spa conversion is below its rate.",
  },
  low_traffic_and_conversion: {
    label: "Below estate on both",
    note: "Both tanning traffic and spa conversion are below this estate's figures.",
  },
  partial_period_equipment: {
    label: "Equipment first used mid-period",
    note: "At least one spa unit was first used inside this reporting period, so its sessions cover less of the window than its peers'. Read the other figures with that in mind.",
  },
  insufficient_data: {
    label: "Not enough data",
    note: "The reports loaded for this period do not join for this salon, so no combined reading is available.",
  },
};

/** One salon in the combined table. */
export interface CombinedSalonRow {
  readonly salonNumber: string | null;
  readonly storeName: string;
  readonly districtLabel: string | null;
  readonly regionLabel: string | null;
  readonly totalTans: number | null;
  readonly bedCount: number | null;
  readonly perBedUsage: number | null;
  readonly spaSessions: number | null;
  /** Installed spa units. */
  readonly spaEquipmentPieces: number | null;
  readonly conversion: SpaConversion;
  /** The worst band among this salon's installed equipment, or null. */
  readonly peerPerformance: PerformanceBand | null;
  readonly spaPerUniquePercent: number | null;
  readonly uniqueSpaTannerPercent: number | null;
  readonly overallRank: number | null;
  readonly status: SalonStatus;
  /** Which of the three reports contributed to this row. */
  readonly sources: {
    readonly bedUsage: boolean;
    readonly spaWellness: boolean;
    readonly spaEngagement: boolean;
  };
}

export interface CombinedViewInput {
  readonly bedUsage: readonly BedUsageSalonSummary[];
  readonly bedUsagePeriod: BedSpaPeriod | null;
  readonly spaWellness: readonly SpaWellnessSalonSummary[];
  readonly spaWellnessPeriod: BedSpaPeriod | null;
  readonly spaEngagement: readonly SpaEngagementSalonSummary[];
  readonly spaEngagementPeriod: BedSpaPeriod | null;
  /** The worst peer band per salon, from the equipment-level comparison. */
  readonly peerBandBySalon?: Readonly<Record<string, PerformanceBand | null>>;
  /** Store names with equipment first used inside the spa period. */
  readonly partialPeriodSalons?: readonly string[];
}

export interface CombinedView {
  readonly rows: readonly CombinedSalonRow[];
  /** The estate roll-up, computed from the parts. */
  readonly totals: {
    readonly salonCount: number;
    readonly totalTans: number | null;
    readonly spaSessions: number | null;
    readonly conversion: SpaConversion;
    readonly perBedUsage: number | null;
  };
  /** True when the two periods allow a conversion rate at all. */
  readonly conversionAvailable: boolean;
  /** Set when they do not, saying which periods are loaded. */
  readonly periodMismatchNote: string | null;
  /** Store names that appeared in one report and not another. */
  readonly unjoined: {
    readonly missingFromBedUsage: readonly string[];
    readonly missingFromSpaWellness: readonly string[];
    readonly missingFromSpaEngagement: readonly string[];
  };
}

/** The join key: the canonical salon number, or the store name when there is none. */
function joinKey(row: { salonNumber: string | null; storeName: string }): string {
  return row.salonNumber ?? `name:${row.storeName}`;
}

export function buildCombinedView(input: CombinedViewInput): CombinedView {
  const bedByKey = new Map(input.bedUsage.map((row) => [joinKey(row), row]));
  const spaByKey = new Map(input.spaWellness.map((row) => [joinKey(row), row]));
  const engagementByKey = new Map(input.spaEngagement.map((row) => [joinKey(row), row]));

  /*
   * THE ROW SET IS THE UNION, not the intersection. An intersection would hide
   * exactly the salons somebody needs to know about — one present in the spa
   * report and absent from bed usage is an ingestion gap, and a table that
   * silently omits it reports a smaller, tidier estate than exists.
   */
  const keys = [
    ...new Set([...bedByKey.keys(), ...spaByKey.keys(), ...engagementByKey.keys()]),
  ];

  const conversionPossible = periodsMatch(input.bedUsagePeriod, input.spaWellnessPeriod);

  // The estate averages the status readings are judged against. Computed from
  // the salons in view, so "above this estate" means what it says.
  const estateTans = input.bedUsage
    .map((row) => row.totalTans)
    .filter((value): value is number => value !== null);
  const estateAverageTans =
    estateTans.length === 0
      ? null
      : estateTans.reduce((total, value) => total + value, 0) / estateTans.length;

  const rows: CombinedSalonRow[] = keys.map((key) => {
    const bed = bedByKey.get(key) ?? null;
    const spa = spaByKey.get(key) ?? null;
    const engagement = engagementByKey.get(key) ?? null;
    const storeName = bed?.storeName ?? spa?.storeName ?? engagement?.storeName ?? key;
    const salonNumber = bed?.salonNumber ?? spa?.salonNumber ?? engagement?.salonNumber ?? null;

    const conversion = computeSpaConversion({
      salonNumber,
      spaSessions: spa?.totalSessions ?? null,
      totalTans: bed?.totalTans ?? null,
      trafficPeriod: input.bedUsagePeriod,
      spaPeriod: input.spaWellnessPeriod,
    });

    return {
      salonNumber,
      storeName,
      districtLabel: bed?.districtLabel ?? spa?.districtLabel ?? engagement?.districtLabel ?? null,
      regionLabel: bed?.regionLabel ?? spa?.regionLabel ?? engagement?.regionLabel ?? null,
      totalTans: bed?.totalTans ?? null,
      bedCount: bed?.bedCount ?? null,
      perBedUsage: bed?.perBed ?? null,
      spaSessions: spa?.totalSessions ?? null,
      spaEquipmentPieces: spa?.equipmentPieces ?? engagement?.spaBeds ?? null,
      conversion,
      peerPerformance: input.peerBandBySalon?.[storeName] ?? null,
      spaPerUniquePercent: engagement
        ? spaPerUniquePercent(engagement.spaSessions, engagement.totalUniqueTanners)
        : null,
      uniqueSpaTannerPercent: engagement
        ? uniqueSpaTannerPercent(engagement.uniqueSpaTanners, engagement.totalUniqueTanners)
        : null,
      overallRank: engagement?.overallRank ?? null,
      status: "insufficient_data",
      sources: {
        bedUsage: bed !== null,
        spaWellness: spa !== null,
        spaEngagement: engagement !== null,
      },
    };
  });

  const totals = {
    salonCount: rows.length,
    totalTans: sumOrNull(rows.map((row) => row.totalTans)),
    spaSessions: sumOrNull(rows.map((row) => row.spaSessions)),
    conversion: aggregateSpaConversion(rows.map((row) => row.conversion)),
    perBedUsage: perBed(
      sumOrNull(rows.map((row) => row.totalTans)),
      sumOrNull(rows.map((row) => row.bedCount)),
    ),
  };

  /*
   * The estate conversion rate every salon's status is judged against — the
   * roll-up, not an average of rates. Null when the periods do not match, which
   * is what makes every status fall back to `insufficient_data` rather than
   * being computed against nothing.
   */
  const estateConversion = totals.conversion.available ? totals.conversion.rate : null;
  const partial = new Set(input.partialPeriodSalons ?? []);

  const withStatus = rows.map((row) => ({
    ...row,
    status: statusFor(row, {
      estateConversion,
      estateAverageTans,
      partialPeriodEquipment: partial.has(row.storeName),
    }),
  }));

  return {
    rows: withStatus,
    totals,
    conversionAvailable: conversionPossible,
    periodMismatchNote: conversionPossible
      ? null
      : describePeriodMismatch(input.bedUsagePeriod, input.spaWellnessPeriod),
    unjoined: {
      missingFromBedUsage: withStatus
        .filter((row) => !row.sources.bedUsage)
        .map((row) => row.storeName),
      missingFromSpaWellness: withStatus
        .filter((row) => !row.sources.spaWellness)
        .map((row) => row.storeName),
      missingFromSpaEngagement: withStatus
        .filter((row) => !row.sources.spaEngagement)
        .map((row) => row.storeName),
    },
  };
}

function sumOrNull(values: readonly (number | null)[]): number | null {
  const present = values.filter((value): value is number => value !== null);
  return present.length === 0 ? null : present.reduce((total, value) => total + value, 0);
}

/**
 * The reading for one salon.
 *
 * ORDER MATTERS AND IS DELIBERATE:
 *
 *   1. NOT ENOUGH DATA comes first. A salon whose conversion could not be
 *      computed cannot be called a weak converter, and calling it one is the
 *      specific mistake that sends somebody to the wrong store.
 *   2. MID-PERIOD EQUIPMENT comes next, because it changes how every other
 *      figure on the row should be read. It is a fact about the period, not an
 *      excuse: the approved rules say a recently deployed unit has not had time
 *      to ramp, and they do not say what allowance to make.
 *   3. Then conversion against the estate, and equipment against peers.
 *
 * "Above this estate" is measured against the salons in view, never against an
 * invented target. No threshold here is a business rule — they are comparisons
 * with the report's own middle, which is why the labels say "below estate" and
 * not "underperforming".
 */
function statusFor(
  row: CombinedSalonRow,
  context: {
    estateConversion: number | null;
    estateAverageTans: number | null;
    partialPeriodEquipment: boolean;
  },
): SalonStatus {
  if (!row.conversion.available || context.estateConversion === null) return "insufficient_data";
  if (context.partialPeriodEquipment) return "partial_period_equipment";

  const converting = row.conversion.rate >= context.estateConversion;
  const equipmentBehind =
    row.peerPerformance === "below_market" ||
    row.peerPerformance === "significantly_underperforming";

  if (converting) {
    return equipmentBehind ? "converting_with_weak_equipment" : "strong_execution";
  }

  const trafficAtOrAbove =
    context.estateAverageTans !== null &&
    row.totalTans !== null &&
    row.totalTans >= context.estateAverageTans;

  return trafficAtOrAbove ? "traffic_without_conversion" : "low_traffic_and_conversion";
}

/**
 * The band a salon's weakest installed equipment falls into.
 *
 * The WORST rather than an average, because a single unit running far below its
 * peers is the finding — averaging it against three healthy ones hides exactly
 * what the comparison is for. Advisory rows are excluded, so the FAST rule
 * cannot reach this through a side door.
 */
export function worstPeerBandBySalon(
  entries: readonly {
    storeName: string;
    band: PerformanceBand | null;
    reportableFinding: boolean;
  }[],
): Record<string, PerformanceBand | null> {
  const order: PerformanceBand[] = [
    "outperforming",
    "at_market",
    "below_market",
    "significantly_underperforming",
  ];
  const out: Record<string, PerformanceBand | null> = {};
  for (const entry of entries) {
    if (entry.band === null || !entry.reportableFinding) {
      if (!(entry.storeName in out)) out[entry.storeName] = null;
      continue;
    }
    const current = out[entry.storeName] ?? null;
    if (current === null || order.indexOf(entry.band) > order.indexOf(current)) {
      out[entry.storeName] = entry.band;
    }
  }
  return out;
}

/**
 * A salon-level `v Chain` reading, for the combined table's Per Bed column.
 *
 * The salon's own per-bed usage against the estate's, which is a DIFFERENT
 * comparison from the per-level `v Chain` and is labelled as such wherever it
 * appears. It answers "is this salon's equipment busier than its siblings'",
 * which the per-level figure cannot.
 */
export function perBedVersusEstate(
  salon: number | null,
  estate: number | null,
): { deltaPercent: number | null; band: PerformanceBand | null } {
  if (salon === null || estate === null || estate === 0) {
    return { deltaPercent: null, band: null };
  }
  const delta = (salon / estate - 1) * 100;
  return { deltaPercent: delta, band: classifyVersusChain(delta) };
}
