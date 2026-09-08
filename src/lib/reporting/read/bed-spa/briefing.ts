import {
  FAST_ADVISORY_NOTE,
  PERFORMANCE_BANDS_BY_ID,
  type PerformanceBand,
} from "../../performance/classification";
import type { BedUsageLevelSummary, BedUsageSalonSummary, BedUsageTotals } from "./bed-usage-analytics";
import type { CombinedView } from "./combined";
import type { SpaEngagementSalonSummary, SpaEngagementTotals } from "./spa-engagement-analytics";
import { UNIQUE_TANNER_SUM_NOTE } from "./spa-engagement-analytics";
import type { SpaEquipmentPerformance, SpaWellnessTotals } from "./spa-wellness-analytics";
import type { BedSpaPeriod, BedSpaProvenance } from "./types";

/**
 * ============================================================================
 * GROUNDING THE ASSISTANT ON THE INGESTED REPORTS
 * ============================================================================
 *
 * Sunny already answers from the knowledge base: a question is embedded, chunks
 * are retrieved, and the answer cites them by marker. That path knows nothing
 * about the reports — it retrieves DOCUMENTS, and a monthly figure is not a
 * document. Asked "which salons have the lowest spa conversion?", Sunny before
 * this module said, correctly and uselessly, that the knowledge base does not
 * cover it, while the answer sat in three tables the dashboard renders.
 *
 * So this is the SECOND KIND OF GROUNDING on the SAME pipeline. Not a second
 * pipeline: `answerQuestion` builds one more context block and hands it to the
 * same model call, and every guarantee that path already makes still holds.
 *
 * WHAT THIS MODULE IS AND IS NOT
 *
 *   IT IS PURE. It renders text from structures the analytics modules already
 *   produce, so the briefing is a projection of the same figures the dashboard
 *   shows, computed by the same functions. There is no second implementation of
 *   Spa Conversion Rate here to drift from the first — this file does no
 *   arithmetic beyond ordering and truncating.
 *
 *   IT NEVER INTERPRETS. No thresholds are invented, no recommendation is
 *   phrased, no salon is called a problem. Bands come from the approved
 *   ladders; where a figure is unavailable the reason travels with it.
 *
 *   IT CARRIES ITS OWN PERIOD ON EVERY SECTION, because the three reports
 *   arrive on their own schedules and a figure without its window is not a
 *   fact. The rules block tells the model it may not combine them.
 *
 * WHAT IS DELIBERATELY ABSENT: any figure for a salon outside the authorized
 * company. The read layer this is fed from cannot return one, peer and chain
 * comparisons arrive as bare averages, and nothing below can reconstruct a
 * name — the same posture as the dashboards, one layer up.
 */

/** How many salon rows any one list contributes. See `capped` below. */
export const MAX_BRIEFING_ROWS = 30;

/**
 * The instruction block that travels with the figures.
 *
 * Kept beside the renderer rather than in the prompt module because every rule
 * here is a REPORTING rule — the FAST exemption, the two spa ratios, the
 * period bar — and it must change when the reports change, not when the
 * assistant's tone does.
 */
export const BED_SPA_BRIEFING_RULES = `HOW TO USE THE REPORT DATA

- These figures are DATA, not company policy. Do not attach a source marker to them; the markers belong to knowledge base documents only. Never call a figure below a policy, a target or a standard — no target has been set anywhere in this data.
- Quote only figures written below. Do not compute a new ratio, project a trend, or estimate a missing value. If a question needs a figure that is not here, say which report would carry it and stop.
- Always name the period a figure belongs to. Each section states its own, and they differ.
- Never combine or compare figures from two different periods. MTD, YTD and LTM through the same day cover one, eight and twelve months of the same salons.
- A zero in the spa data means the equipment is NOT INSTALLED, not that it performed badly. Salons with no row for a piece of equipment do not have it. Never describe a salon as underusing equipment it does not have.
- ${FAST_ADVISORY_NOTE} Never present a FAST shortfall as a failure or suggest that removing FAST units was a mistake.
- Spa Per Unique % and Spa Sessions per Unique Tanner per Spa Bed are DIFFERENT measures with different denominators. Use each by its full name and never treat one as the other.
- Where a figure reads N/A the reason is given. Report the reason; do not substitute a zero or an estimate.
- These reports describe what happened. They do not authorise equipment purchases, removals or disciplinary action. Where someone asks what to do, say what the reports show and leave the decision with them.`;

/* --------------------------------------------------------------- rendering -- */

function count(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "not reported";
  return Number.isInteger(value)
    ? value.toLocaleString("en-US")
    : value.toLocaleString("en-US", { maximumFractionDigits: 1 });
}

function fixed(value: number | null | undefined, digits: number): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "not reported";
  return value.toFixed(digits);
}

/** A signed percentage difference, or `N/A`. Sign carried for the reason `formatDelta` gives. */
function delta(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "N/A";
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}

/** A stored FRACTION rendered as a percentage: `0.13159` -> `13.2%`. */
function rate(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "N/A";
  return `${(value * 100).toFixed(digits)}%`;
}

function band(value: PerformanceBand | null | undefined): string {
  return value ? PERFORMANCE_BANDS_BY_ID[value].label : "not classified";
}

/** A salon's name with its number, which is how the reports identify one. */
function salonLabel(row: { storeName: string; salonNumber: string | null }): string {
  return row.salonNumber ? `${row.storeName} (${row.salonNumber})` : row.storeName;
}

/**
 * Truncates a list and SAYS SO.
 *
 * A briefing has to fit in a prompt beside the retrieved chunks, and an estate
 * could grow past what belongs there. Silently dropping the tail would make the
 * model answer "which salons are lowest" from a list whose bottom was cut off —
 * so the note is not decoration, it is what stops a wrong answer.
 */
function capped<T>(rows: readonly T[], limit: number): { rows: readonly T[]; note: string | null } {
  if (rows.length <= limit) return { rows, note: null };
  return {
    rows: rows.slice(0, limit),
    note: `(${rows.length - limit} further salons are not listed here. Say so if a question needs the full list.)`,
  };
}

/**
 * The period, with the delivery's OWN title where one was recorded.
 *
 * `period.labelRaw` is deliberately not used: it belongs to the shared period
 * row, which three reports covering the same window all resolve to, and the
 * last delivery in writes it. Quoting it as "the source labels it" would put
 * the SPA Wellness workbook's title on the Bed Usage section — a wrong
 * attribution on a traceability field, which is the kind of thing that makes a
 * reader doubt the figures beside it.
 */
function periodSentence(period: BedSpaPeriod, sourceLabel?: string | null): string {
  const grain = period.grain.toUpperCase();
  const window = `${grain}, ${period.periodStart} to ${period.periodEnd}`;
  return sourceLabel && sourceLabel.trim().length > 0
    ? `${window} (this delivery is titled "${sourceLabel.trim()}")`
    : window;
}

function provenanceSentence(provenance: BedSpaProvenance): string {
  const parts = [`covers ${provenance.salonCount} of our salons`];
  if (provenance.sourceSalonCount !== null) {
    parts.push(`out of ${provenance.sourceSalonCount} in the delivery`);
  }
  if (provenance.ingestedAt) parts.push(`loaded ${provenance.ingestedAt}`);
  return parts.join(", ");
}

/* ------------------------------------------------------------------ input -- */

export interface BedUsageBriefingInput {
  readonly period: BedSpaPeriod;
  readonly provenance: BedSpaProvenance;
  readonly totals: BedUsageTotals;
  readonly levels: readonly BedUsageLevelSummary[];
  /** Salons in the order they should be read — highest traffic first. */
  readonly salons: readonly BedUsageSalonSummary[];
}

export interface SpaWellnessBriefingInput {
  readonly period: BedSpaPeriod;
  readonly provenance: BedSpaProvenance;
  readonly totals: SpaWellnessTotals;
  readonly equipment: readonly SpaEquipmentPerformance[];
}

export interface SpaEngagementBriefingInput {
  readonly period: BedSpaPeriod;
  readonly provenance: BedSpaProvenance;
  readonly totals: SpaEngagementTotals;
  readonly salons: readonly SpaEngagementSalonSummary[];
  /** How many salons the source ranked, so a rank can be read as "n of N". */
  readonly rankedPopulation: number | null;
}

export interface CombinedBriefingInput {
  readonly view: CombinedView;
  /** The window both halves of the conversion metric cover, when one exists. */
  readonly period: BedSpaPeriod | null;
}

export interface BedSpaBriefingInput {
  readonly company: string;
  readonly bedUsage: BedUsageBriefingInput | null;
  readonly spaWellness: SpaWellnessBriefingInput | null;
  readonly spaEngagement: SpaEngagementBriefingInput | null;
  readonly combined: CombinedBriefingInput | null;
}

/* --------------------------------------------------------------- sections -- */

function bedUsageSection(input: BedUsageBriefingInput): string {
  const lines: string[] = [
    `BED USAGE — ${periodSentence(input.period, input.provenance.sourcePeriodLabel)}`,
    `Report ${provenanceSentence(input.provenance)}.`,
    `Estate: ${count(input.totals.salonCount)} salons, ${count(input.totals.totalTans)} tans, ` +
      `${count(input.totals.bedCount)} beds, ${fixed(input.totals.perBed, 1)} tans per bed.`,
  ];

  if (input.totals.salonsMissingTans > 0) {
    lines.push(
      `${input.totals.salonsMissingTans} salon(s) had no Total Tans reported and are excluded from the estate total.`,
    );
  }

  if (input.levels.length > 0) {
    lines.push("");
    lines.push("By equipment level — level, units, tans, tans per bed, chain tans per bed, vs chain, classification:");
    for (const level of input.levels) {
      const suffix = level.advisoryOnly
        ? " [ADVISORY ONLY — FAST: intentional reduction, not a shortfall]"
        : level.versusChain.reportableFinding
          ? ""
          : " [not classified]";
      lines.push(
        `  ${level.level}: ${count(level.units)} units, ${count(level.clientTans)} tans, ` +
          `${fixed(level.perBed, 1)} per bed, chain ${fixed(level.chainPerBed, 1)} per bed, ` +
          `${delta(level.versusChain.deltaPercent)} vs chain, ${band(level.versusChain.band)}` +
          `${suffix}`,
      );
    }
  }

  const { rows, note } = capped(input.salons, MAX_BRIEFING_ROWS);
  if (rows.length > 0) {
    lines.push("");
    lines.push("By salon, highest tans first — salon, tans, beds, tans per bed, levels installed:");
    for (const salon of rows) {
      lines.push(
        `  ${salonLabel(salon)}: ${count(salon.totalTans)} tans, ${count(salon.bedCount)} beds, ` +
          `${fixed(salon.perBed, 1)} per bed, levels ${salon.levels.join("/") || "none reported"}`,
      );
    }
    if (note) lines.push(`  ${note}`);
  }

  return lines.join("\n");
}

function spaWellnessSection(input: SpaWellnessBriefingInput): string {
  const lines: string[] = [
    `SPA WELLNESS — ${periodSentence(input.period, input.provenance.sourcePeriodLabel)}`,
    `Report ${provenanceSentence(input.provenance)}.`,
    `Estate: ${count(input.totals.salonCount)} salons, ${count(input.totals.totalSessions)} spa sessions, ` +
      `${count(input.totals.equipmentPieces)} installed spa units, ${count(input.totals.equipmentTypes)} equipment types in use.`,
  ];

  if (input.totals.weightedPeerDeltaPercent !== null) {
    lines.push(
      `Across the ${input.totals.comparedTypeCount} comparable type(s) that have a peer average, ` +
        `the session-weighted difference against peers is ${delta(input.totals.weightedPeerDeltaPercent)}. ` +
        `That figure is weighted by sessions, not an average of the per-type differences.`,
    );
  }

  if (input.equipment.length > 0) {
    lines.push("");
    lines.push(
      "By equipment type — type, our salons with it installed, our sessions, our average per installed salon, " +
        "peer salons with it installed, peer average, difference, classification:",
    );
    for (const entry of input.equipment) {
      const comparison = entry.versusPeers.unavailableReason
        ? `no comparison — ${entry.versusPeers.unavailableReason}`
        : `${delta(entry.versusPeers.deltaPercent)} vs peers, ${band(entry.versusPeers.band)}`;
      lines.push(
        `  ${entry.label}: installed in ${count(entry.ourSalonCount)} of our salons, ` +
          `${count(entry.ourSessions)} sessions, our average ${fixed(entry.ourAverageSessions, 1)} per installed salon; ` +
          `${count(entry.peerSalonCount)} peer salons, peer average ${fixed(entry.peerAverageSessions, 1)}; ${comparison}`,
      );
      if (entry.newestFirstUseDate) {
        lines.push(
          `    First use across our salons: earliest ${entry.firstUseDate ?? "not reported"}, latest ${entry.newestFirstUseDate}.`,
        );
      }
    }
  }

  lines.push("");
  lines.push(
    "Equipment absent from this list, or absent from a salon's row, is NOT INSTALLED there. " +
      "The source writes a zero for equipment a salon does not have, and zeroes are not stored as sessions.",
  );

  return lines.join("\n");
}

function spaEngagementSection(input: SpaEngagementBriefingInput): string {
  const population = input.rankedPopulation;
  const lines: string[] = [
    `SPA ENGAGEMENT — ${periodSentence(input.period, input.provenance.sourcePeriodLabel)}`,
    `Report ${provenanceSentence(input.provenance)}.`,
    `Estate: ${count(input.totals.salonCount)} salons, ${count(input.totals.spaSessions)} spa sessions, ` +
      `${count(input.totals.totalUniqueTanners)} unique tanners, ${count(input.totals.uniqueSpaTanners)} unique spa tanners, ` +
      `${count(input.totals.spaBeds)} spa beds.`,
    `Estate Spa Per Unique % (spa sessions / total unique tanners) = ${rate(input.totals.spaPerUniquePercent)}.`,
    `Estate Spa Sessions per Unique Tanner per Spa Bed (spa sessions / total unique tanners / spa beds) = ` +
      `${fixed(input.totals.spaSessionsPerUniquePerBed, 4)}.`,
    `Estate Spa Sessions per Spa Bed = ${fixed(input.totals.spaSessionsPerBed, 2)}.`,
    `Estate Unique Spa Tanner % (unique spa tanners / total unique tanners) = ${rate(input.totals.uniqueSpaTannerPercent)}.`,
    UNIQUE_TANNER_SUM_NOTE,
  ];

  const { rows, note } = capped(input.salons, MAX_BRIEFING_ROWS);
  if (rows.length > 0) {
    lines.push("");
    lines.push(
      "By salon — salon, spa sessions, total unique tanners, unique spa tanners, spa beds, " +
        "Spa Per Unique %, Spa Sessions per Unique Tanner per Spa Bed, chain-wide Overall Rank:",
    );
    for (const salon of rows) {
      const rank =
        salon.overallRank === null
          ? "not ranked"
          : population
            ? `${salon.overallRank} of ${count(population)}`
            : String(salon.overallRank);
      lines.push(
        `  ${salonLabel(salon)}: ${count(salon.spaSessions)} sessions, ` +
          `${count(salon.totalUniqueTanners)} unique tanners, ${count(salon.uniqueSpaTanners)} unique spa tanners, ` +
          `${count(salon.spaBeds)} spa beds, Spa Per Unique % ${rate(salon.spaPerUniquePercent)}, ` +
          `per Unique per Bed ${fixed(salon.spaSessionsPerUniquePerBed, 4)}, rank ${rank}`,
      );
    }
    if (note) lines.push(`  ${note}`);
    lines.push(
      "  The rank is the source's own chain-wide rank, so a low number is better and the population includes salons outside this company.",
    );
  }

  return lines.join("\n");
}

function combinedSection(input: CombinedBriefingInput): string {
  const view = input.view;
  const lines: string[] = [
    input.period
      ? `SPA CONVERSION RATE — ${periodSentence(input.period)}`
      : "SPA CONVERSION RATE — no period is available",
    "Spa Conversion Rate = monthly spa sessions / monthly total tans, over one matching period.",
  ];

  if (!view.conversionAvailable) {
    lines.push(
      `No conversion rate can be computed for this view. ${view.periodMismatchNote ?? ""}`.trim(),
    );
    lines.push(
      "Do not divide the spa sessions above by the tans above to produce one. Say that the two reports loaded cover different periods.",
    );
    return lines.join("\n");
  }

  const totals = view.totals;
  lines.push(
    totals.conversion.available
      ? `Estate: ${count(totals.salonCount)} salons, ${count(totals.spaSessions)} spa sessions over ` +
        `${count(totals.totalTans)} tans = ${rate(totals.conversion.rate)}.`
      : `Estate conversion is N/A — ${totals.conversion.reasonText}`,
  );

  /*
   * ORDERED LOWEST CONVERSION FIRST, which is the question this metric exists
   * to answer. Salons WITHOUT a rate sort last and keep their reason, so
   * "lowest conversion" cannot be answered with a salon that simply has no
   * figure — the commonest way a ranking like this misleads.
   */
  const ordered = [...view.rows].sort((a, b) => {
    const left = a.conversion.available ? a.conversion.rate : Number.POSITIVE_INFINITY;
    const right = b.conversion.available ? b.conversion.rate : Number.POSITIVE_INFINITY;
    return left - right || a.storeName.localeCompare(b.storeName);
  });

  const { rows, note } = capped(ordered, MAX_BRIEFING_ROWS);
  if (rows.length > 0) {
    lines.push("");
    lines.push(
      "By salon, LOWEST conversion first — salon, spa sessions, total tans, Spa Conversion Rate, " +
        "tans per bed, worst band among its installed spa equipment, reading:",
    );
    for (const row of rows) {
      const conversion = row.conversion.available
        ? rate(row.conversion.rate)
        : `N/A (${row.conversion.reasonText})`;
      const sources = [
        row.sources.bedUsage ? null : "no Bed Usage row",
        row.sources.spaWellness ? null : "no Spa Wellness row",
      ].filter((value): value is string => value !== null);
      lines.push(
        `  ${salonLabel(row)}: ${count(row.spaSessions)} sessions, ${count(row.totalTans)} tans, ` +
          `conversion ${conversion}, ${fixed(row.perBedUsage, 1)} tans per bed, ` +
          `equipment ${band(row.peerPerformance)}, reading "${row.status}"` +
          (sources.length > 0 ? ` [${sources.join("; ")}]` : ""),
      );
    }
    if (note) lines.push(`  ${note}`);
  }

  const unjoined = [
    view.unjoined.missingFromBedUsage.length > 0
      ? `absent from Bed Usage: ${view.unjoined.missingFromBedUsage.join(", ")}`
      : null,
    view.unjoined.missingFromSpaWellness.length > 0
      ? `absent from Spa Wellness: ${view.unjoined.missingFromSpaWellness.join(", ")}`
      : null,
  ].filter((value): value is string => value !== null);
  if (unjoined.length > 0) {
    lines.push("");
    lines.push(`Salons the two reports do not both cover — ${unjoined.join("; ")}.`);
  }

  return lines.join("\n");
}

/* ---------------------------------------------------------------- assembly -- */

/**
 * The whole briefing, or null when no report has loaded.
 *
 * NULL RATHER THAN AN EMPTY HEADING. A block that announces report data and
 * then lists none invites the model to fill the gap; no block at all leaves the
 * existing "the knowledge base does not cover this" path to answer, which is
 * the honest response when nothing has been ingested.
 */
export function buildBedSpaBriefing(input: BedSpaBriefingInput): string | null {
  const sections = [
    input.bedUsage ? bedUsageSection(input.bedUsage) : null,
    input.spaWellness ? spaWellnessSection(input.spaWellness) : null,
    input.spaEngagement ? spaEngagementSection(input.spaEngagement) : null,
    input.combined ? combinedSection(input.combined) : null,
  ].filter((section): section is string => section !== null);

  if (sections.length === 0) return null;

  return [
    `REPORT DATA — ${input.company}`,
    "",
    `Every figure below is for ${input.company} only. No other company's salon figures are available to you, and peer and chain comparisons are averages that name nobody.`,
    "",
    BED_SPA_BRIEFING_RULES,
    "",
    sections.join("\n\n"),
  ].join("\n");
}
