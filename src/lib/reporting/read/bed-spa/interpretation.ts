import { isAdvisoryOnlyLevel, type PerformanceBand } from "../../performance/classification";
import type { BedUsageLevelSummary, BedUsageTotals, FastMigrationView } from "./bed-usage-analytics";
import type { CombinedView } from "./combined";
import type { SpaEngagementTotals } from "./spa-engagement-analytics";
import {
  isSmallPeerSample,
  type SpaEquipmentPerformance,
  type SpaUnitReconciliation,
  type SpaWellnessTotals,
} from "./spa-wellness-analytics";

/**
 * ============================================================================
 * THE PLAIN-LANGUAGE READING AT THE TOP OF A REPORT
 * ============================================================================
 *
 * THE REVIEW asked each report to land on four headline metrics, one chart, one
 * plain-language interpretation and the detail behind a disclosure. This module
 * is the interpretation, and it is a LIBRARY rather than a component so the
 * sentences a manager reads can be asserted in a test instead of inspected in a
 * browser.
 *
 * THE FRAMEWORK IS THE APPROVED ONE, from `docs/bed-usage-spa-metrics.md`:
 * traffic + utilization + conversion + peer performance, read for operating and
 * capital decisions rather than recited as a list of figures. Each report gets
 * the parts of that framework its own data supports and no more — bed usage has
 * traffic, utilization and peer performance and no conversion; spa wellness has
 * utilization and peer performance; only the combined engagement view has all
 * four, which is why it is the only one that speaks about capital.
 *
 * ============================================================================
 * THE FOUR RULES THAT KEEP THIS FROM BECOMING FICTION
 * ============================================================================
 *
 *   1. EVERY SENTENCE CARRIES ITS OWN FIGURE. Not "utilization is strong" but
 *      "24.1 tans per bed against the chain's 23.0". A reader who disagrees can
 *      check it, and a sentence with a number in it cannot drift away from the
 *      data the way an adjective can.
 *
 *   2. A NULL PRODUCES NO SENTENCE. Where a figure is missing the point is
 *      omitted, never softened into a guess and never rendered as a zero. If
 *      nothing can be said, `unavailableReason` says why and `points` is empty.
 *
 *   3. FAST NEVER ENTERS AN UNDERPERFORMANCE SENTENCE. "FAST removals are
 *      intentional and are not treated as a negative KPI." It gets a CAPACITY
 *      sentence of its own about whether the premium levels are absorbing the
 *      demand, which is what the approved rules say FAST is monitored for.
 *      `isReportableFinding` already enforces this downstream; stating it again
 *      here is deliberate, because a summary is exactly where a level that is
 *      -28% against the chain would otherwise be named as the worst thing on
 *      the page.
 *
 *   4. NO RECOMMENDATION IS ISSUED. The approved capital framework has two
 *      named sides — "Favor Expansion Where" and "Fix Before Expanding Where" —
 *      and the engagement reading places salons on them BY THEIR OWN FIGURES,
 *      using the criteria the document lists. It does not decide to buy
 *      anything. The distinction is the same one `SalonStatus` already draws:
 *      a description a manager acts on, not an instruction.
 */

/** One report's reading: a headline, its supporting points, or a reason. */
export interface ReportInterpretation {
  /** One sentence naming what the period shows. Empty when unavailable. */
  readonly headline: string;
  /** Supporting sentences, each derived from a figure in the view. */
  readonly points: readonly string[];
  /** Why nothing could be said. Null when the reading is available. */
  readonly unavailableReason: string | null;
}

/* -------------------------------------------------------------- helpers -- */

const NOTHING_TO_READ: ReportInterpretation = {
  headline: "",
  points: [],
  unavailableReason: "This period has no figures to read.",
};

function count(value: number | null | undefined): string | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return Math.round(value).toLocaleString("en-US");
}

function ratio(value: number | null | undefined, digits = 1): string | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return value.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function rate(value: number | null | undefined, digits = 1): string | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return `${(value * 100).toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}%`;
}

function signed(percent: number | null | undefined, digits = 1): string | null {
  if (percent === null || percent === undefined || !Number.isFinite(percent)) return null;
  const body = Math.abs(percent).toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  return `${percent < 0 ? "-" : "+"}${body}%`;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return n === 1 ? one : many;
}

/** `a, b and c`, for a list a person reads rather than scans. */
function list(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/* ------------------------------------------------------------ bed usage -- */

export interface BedUsageInterpretationInput {
  readonly totals: BedUsageTotals;
  readonly levels: readonly BedUsageLevelSummary[];
  readonly fast: FastMigrationView;
}

/**
 * TRAFFIC, UTILIZATION AND PEER PERFORMANCE. No conversion: this report has no
 * spa sessions in it, and the approved formula needs both halves.
 */
export function interpretBedUsage(input: BedUsageInterpretationInput): ReportInterpretation {
  const { totals, levels, fast } = input;
  if (totals.salonCount === 0) return NOTHING_TO_READ;

  const points: string[] = [];

  /* TRAFFIC, and the utilization it produces per installed bed. */
  const tans = count(totals.totalTans);
  const beds = count(totals.bedCount);
  const perBed = ratio(totals.perBed);
  const headline =
    tans && beds && perBed
      ? `${tans} tans across ${totals.salonCount} ${plural(totals.salonCount, "salon")} and ${beds} beds — ${perBed} tans per bed.`
      : `${totals.salonCount} ${plural(totals.salonCount, "salon")} in view.`;

  if (totals.salonsMissingTans > 0) {
    points.push(
      `${totals.salonsMissingTans} ${plural(totals.salonsMissingTans, "salon")} reported no Total Tans, so ${
        totals.salonsMissingTans === 1 ? "it is" : "they are"
      } outside the traffic figure above.`,
    );
  }

  /*
   * PEER PERFORMANCE BY LEVEL, and FAST is excluded from this pass entirely —
   * rule 3. `classified` is the set of levels whose shortfall or lead is a
   * finding somebody should act on.
   */
  const classified = levels.filter(
    (level) => !level.advisoryOnly && level.versusChain.band !== null,
  );

  const ahead = classified.filter((level) => level.versusChain.band === "outperforming");
  const behind = classified.filter(
    (level) =>
      level.versusChain.band === "below_market" ||
      level.versusChain.band === "significantly_underperforming",
  );

  if (classified.length > 0) {
    points.push(
      `Against the chain, ${ahead.length} of ${classified.length} compared ${plural(
        classified.length,
        "level",
      )} ${ahead.length === 1 ? "is" : "are"} outperforming and ${behind.length} ${
        behind.length === 1 ? "is" : "are"
      } behind.`,
    );
  }

  const worst = [...behind].sort(
    (a, b) => (a.versusChain.deltaPercent ?? 0) - (b.versusChain.deltaPercent ?? 0),
  )[0];
  if (worst) {
    const delta = signed(worst.versusChain.deltaPercent);
    const levelPerBed = ratio(worst.perBed);
    const chainPerBed = ratio(worst.chainPerBed);
    points.push(
      levelPerBed && chainPerBed
        ? `${worst.level} is furthest behind at ${delta} — ${levelPerBed} tans per bed against the chain's ${chainPerBed}.`
        : `${worst.level} is furthest behind at ${delta} against the chain.`,
    );
  }

  const best = [...ahead].sort(
    (a, b) => (b.versusChain.deltaPercent ?? 0) - (a.versusChain.deltaPercent ?? 0),
  )[0];
  if (best) {
    points.push(`${best.level} leads the chain by ${signed(best.versusChain.deltaPercent)}.`);
  }

  /*
   * FAST AS CAPACITY, never as a shortfall. The question the approved rules ask
   * is whether FASTER, FASTEST and INSTANT are absorbing the demand FAST used
   * to carry, so the sentence compares the two per-bed figures and says nothing
   * about whether FAST is behind the chain.
   */
  if (fast.fastUnits !== null && fast.fastUnits > 0) {
    const share = rate(fast.fastShareOfTans);
    const fastPerBed = ratio(fast.fastPerBed);
    const premiumPerBed = ratio(fast.premiumPerBed);
    const capacity =
      fastPerBed && premiumPerBed
        ? `FAST is a planned reduction, not a shortfall: ${count(fast.fastUnits)} ${plural(
            fast.fastUnits,
            "unit",
          )} left${
            share ? ` carrying ${share} of tans` : ""
          }, at ${fastPerBed} per bed against ${premiumPerBed} on FASTER, FASTEST and INSTANT.`
        : `FAST is a planned reduction, not a shortfall: ${count(fast.fastUnits)} ${plural(
            fast.fastUnits,
            "unit",
          )} remain${share ? `, carrying ${share} of tans` : ""}.`;
    points.push(capacity);
  }

  return { headline, points, unavailableReason: null };
}

/* --------------------------------------------------------- spa wellness -- */

export interface SpaWellnessInterpretationInput {
  readonly totals: SpaWellnessTotals;
  readonly equipment: readonly SpaEquipmentPerformance[];
  readonly unitCounts: SpaUnitReconciliation;
}

/**
 * UTILIZATION AND PEER PERFORMANCE. No traffic and no conversion: neither is in
 * this delivery, and borrowing them from another one is what `spa-conversion`
 * refuses to do without a matching period.
 */
export function interpretSpaWellness(
  input: SpaWellnessInterpretationInput,
): ReportInterpretation {
  const { totals, equipment, unitCounts } = input;
  if (totals.salonCount === 0) return NOTHING_TO_READ;

  const points: string[] = [];

  const sessions = count(totals.totalSessions);
  const units = count(unitCounts.installedUnits);
  const headline =
    sessions && units
      ? `${sessions} spa sessions across ${totals.salonCount} ${plural(
          totals.salonCount,
          "salon",
        )} and ${units} installed ${plural(unitCounts.installedUnits ?? 0, "unit")}.`
      : `${totals.salonCount} ${plural(totals.salonCount, "salon")} in view.`;

  /*
   * THE PRESENCE RULE, SAID OUT LOUD. "Zero usage means the equipment is NOT
   * installed", so every unit in view is a used unit and the reading must not
   * invite a reader to hunt for idle machines. Where the two counts differ the
   * sentence names the salons holding duplicates — see `reconcileSpaUnits`.
   */
  if (unitCounts.multiUnitSalons.length > 0) {
    points.push(
      `Every installed unit recorded sessions. The ${count(
        unitCounts.installedUnits,
      )} units appear as ${count(unitCounts.equipmentRows)} salon-and-equipment rows because ${list(
        unitCounts.multiUnitSalons.map((salon) => salon.storeName),
      )} ${unitCounts.multiUnitSalons.length === 1 ? "holds" : "hold"} more than one unit of a type.`,
    );
  }

  const compared = equipment.filter(
    (entry) => entry.comparable && entry.versusPeers.deltaPercent !== null,
  );

  if (compared.length === 0) {
    points.push(
      "No equipment type in view has a peer average, so there is no like-for-like comparison this period.",
    );
    return { headline, points, unavailableReason: null };
  }

  const ahead = compared.filter((entry) => entry.versusPeers.band === "outperforming");
  const behind = compared.filter(
    (entry) =>
      entry.versusPeers.band === "below_market" ||
      entry.versusPeers.band === "significantly_underperforming",
  );

  points.push(
    `Of ${compared.length} ${plural(compared.length, "equipment type")} with an installed-peer average, ${
      ahead.length
    } ${ahead.length === 1 ? "is" : "are"} outperforming and ${behind.length} ${
      behind.length === 1 ? "is" : "are"
    } behind.`,
  );

  const worst = [...behind].sort(
    (a, b) => (a.versusPeers.deltaPercent ?? 0) - (b.versusPeers.deltaPercent ?? 0),
  )[0];
  if (worst) {
    const ours = ratio(worst.ourAverageSessions, 0);
    const theirs = ratio(worst.peerAverageSessions, 0);
    points.push(
      `${worst.label} is furthest behind at ${signed(worst.versusPeers.deltaPercent)} — ${ours} sessions per installed salon against the peers' ${theirs}${
        isSmallPeerSample(worst.peerSalonCount)
          ? `, drawn from ${worst.peerSalonCount} peer ${plural(worst.peerSalonCount, "salon")}, so read it as a pointer rather than a market`
          : ""
      }.`,
    );
  }

  const best = [...ahead].sort(
    (a, b) => (b.versusPeers.deltaPercent ?? 0) - (a.versusPeers.deltaPercent ?? 0),
  )[0];
  if (best) {
    points.push(
      `${best.label} leads its installed peers by ${signed(best.versusPeers.deltaPercent)}${
        isSmallPeerSample(best.peerSalonCount)
          ? `, on a benchmark of ${best.peerSalonCount} peer ${plural(best.peerSalonCount, "salon")}`
          : ""
      }.`,
    );
  }

  if (totals.weightedPeerDeltaPercent !== null) {
    points.push(
      `Weighted by sessions, your salons run ${signed(
        totals.weightedPeerDeltaPercent,
      )} against installed peers across those types.`,
    );
  }

  return { headline, points, unavailableReason: null };
}

/* ------------------------------------------------------- spa engagement -- */

export interface SpaEngagementInterpretationInput {
  readonly totals: SpaEngagementTotals;
  readonly combined: CombinedView;
}

/**
 * THE ONLY READING WITH ALL FOUR PARTS, and therefore the only one that speaks
 * about capital. Traffic and conversion come from the combined view; peer
 * performance from each salon's worst installed unit; utilization from the
 * engagement counts.
 *
 * THE TWO SIDES ARE THE DOCUMENT'S OWN. "Favor Expansion Where" wants high
 * conversion and equipment at or above peers; "Fix Before Expanding Where"
 * wants traffic present and conversion low, or equipment below peers. Those map
 * onto `SalonStatus` exactly, which is why this counts statuses rather than
 * inventing a second classifier beside the one the table already shows.
 */
export function interpretSpaEngagement(
  input: SpaEngagementInterpretationInput,
): ReportInterpretation {
  const { totals, combined } = input;
  if (totals.salonCount === 0) return NOTHING_TO_READ;

  const points: string[] = [];

  const conversion = combined.totals.conversion;
  const sessions = count(totals.spaSessions);

  const headline = conversion.available
    ? `${rate(conversion.rate)} spa conversion — ${count(conversion.spaSessions)} spa sessions on ${count(
        conversion.totalTans,
      )} tans across ${totals.salonCount} ${plural(totals.salonCount, "salon")}.`
    : `${sessions ?? "No"} spa sessions across ${totals.salonCount} ${plural(
        totals.salonCount,
        "salon",
      )}. Spa Conversion Rate is not available for this view.`;

  if (!conversion.available) {
    points.push(conversion.reasonText);
  }

  if (totals.uniqueSpaTannerPercent !== null && totals.spaPerUniquePercent !== null) {
    points.push(
      `Reach and frequency are different questions: ${rate(
        totals.uniqueSpaTannerPercent,
      )} of tanning customers used the spa at all, and spa sessions run at ${rate(
        totals.spaPerUniquePercent,
      )} of unique tanners.`,
    );
  }

  /*
   * THE CAPITAL FRAMEWORK, counted from the statuses the table already shows.
   * Salons are placed on the document's two sides by their own figures; no
   * purchase is proposed and no salon is told what to do.
   */
  const rows = combined.rows;
  const withReading = rows.filter((row) => row.status !== "insufficient_data");

  if (withReading.length > 0) {
    const favor = withReading.filter((row) => row.status === "strong_execution");
    const fixFirst = withReading.filter(
      (row) =>
        row.status === "traffic_without_conversion" ||
        row.status === "converting_with_weak_equipment",
    );
    const trafficFirst = withReading.filter((row) => row.status === "low_traffic_and_conversion");
    const tooEarly = withReading.filter((row) => row.status === "partial_period_equipment");

    if (favor.length > 0) {
      points.push(
        `${favor.length} ${plural(favor.length, "salon")} converts above your average with equipment at or above peers — ${list(
          favor.map((row) => row.storeName),
        )}. That is the profile the approved rules favour for more equipment.`,
      );
    }
    if (fixFirst.length > 0) {
      points.push(
        `${fixFirst.length} ${plural(fixFirst.length, "salon")} ${
          fixFirst.length === 1 ? "has" : "have"
        } traffic or conversion working against weak equipment or weak execution — ${list(
          fixFirst.map((row) => row.storeName),
        )}. The approved rules put these on the fix-before-expanding side.`,
      );
    }
    if (trafficFirst.length > 0) {
      points.push(
        `${trafficFirst.length} ${plural(trafficFirst.length, "salon")} ${
          trafficFirst.length === 1 ? "is" : "are"
        } below your average on BOTH traffic and conversion — ${list(
          trafficFirst.map((row) => row.storeName),
        )}. That is a traffic question before it is a spa one.`,
      );
    }
    if (tooEarly.length > 0) {
      points.push(
        `${tooEarly.length} ${plural(tooEarly.length, "salon")} had spa equipment first used inside this period, so ${
          tooEarly.length === 1 ? "its figure covers" : "their figures cover"
        } less of the window than ${tooEarly.length === 1 ? "its" : "their"} peers'.`,
      );
    }
  }

  const unread = rows.length - withReading.length;
  if (unread > 0) {
    points.push(
      `${unread} ${plural(unread, "salon")} could not be read: the reports loaded for this period do not join for ${
        unread === 1 ? "it" : "them"
      }.`,
    );
  }

  return { headline, points, unavailableReason: null };
}

/**
 * The band a reader is most likely to ask about, for a caption.
 *
 * Exported because three surfaces want the same "worst thing here" and each
 * writing its own sort is how they end up disagreeing.
 */
export function worstBand(bands: readonly (PerformanceBand | null)[]): PerformanceBand | null {
  const order: PerformanceBand[] = [
    "significantly_underperforming",
    "below_market",
    "at_market",
    "outperforming",
  ];
  for (const band of order) if (bands.includes(band)) return band;
  return null;
}

/** True for a level whose shortfall must never be named as a finding. */
export const interpretationExcludesLevel = isAdvisoryOnlyLevel;
