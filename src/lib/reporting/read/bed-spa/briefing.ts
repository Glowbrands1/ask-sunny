import {
  FAST_ADVISORY_NOTE,
  PERFORMANCE_BANDS_BY_ID,
  type PerformanceBand,
} from "../../performance/classification";
import { SPA_ENGAGEMENT_MEASURES_BY_CODE } from "../../spa-engagement/metric-map";
import type { BedUsageLevelSummary, BedUsageSalonSummary, BedUsageTotals } from "./bed-usage-analytics";
import type { CombinedView } from "./combined";
import type { SpaEngagementSalonSummary, SpaEngagementTotals } from "./spa-engagement-analytics";
import { UNIQUE_TANNER_SUM_NOTE } from "./spa-engagement-analytics";
import type {
  SpaEquipmentPerformance,
  SpaUnitReconciliation,
  SpaWellnessTotals,
} from "./spa-wellness-analytics";
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
  /** Installed units against salon-and-equipment rows. See `reconcileSpaUnits`. */
  readonly unitCounts: SpaUnitReconciliation | null;
}

export interface SpaEngagementBriefingInput {
  readonly period: BedSpaPeriod;
  readonly provenance: BedSpaProvenance;
  readonly totals: SpaEngagementTotals;
  readonly salons: readonly SpaEngagementSalonSummary[];
  /** How many salons the source ranked, so a rank can be read as "n of N". */
  readonly rankedPopulation: number | null;
  /**
   * The weights the delivery published above its Rank columns, by rank-metric
   * code. Carried so the briefing can state the Overall Rank methodology from
   * the source rather than from memory — an answer about how a rank is built
   * must not quote a weight the delivery in hand does not contain.
   */
  readonly rankWeights: Readonly<Record<string, number>>;
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
    `Across these salons: ${count(input.totals.salonCount)} salons, ${count(input.totals.totalTans)} tans, ` +
      `${count(input.totals.bedCount)} beds, ${fixed(input.totals.perBed, 1)} tans per bed.`,
  ];

  if (input.totals.salonsMissingTans > 0) {
    lines.push(
      `${input.totals.salonsMissingTans} salon(s) had no Total Tans reported and are excluded from the total across these salons.`,
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
    `Across these salons: ${count(input.totals.salonCount)} salons, ${count(input.totals.totalSessions)} spa sessions, ` +
      `${count(input.totals.equipmentPieces)} installed spa units, ${count(input.totals.equipmentTypes)} equipment types in use.`,
  ];

  /*
   * THE TWO COUNTS, EXPLAINED BEFORE THE MODEL IS ASKED ABOUT THEM. Installed
   * units and per-equipment rows are different granularities, and the gap
   * between them has exactly one innocent explanation and one forbidden one.
   * Stating which applies here is what stops the assistant reaching for "some
   * units recorded no sessions" — a sentence the presence rule rules out,
   * since a zero in this source means the machine is not installed at all.
   */
  if (input.unitCounts !== null && input.unitCounts.installedUnits !== null) {
    const counts = input.unitCounts;
    lines.push(
      `Unit counting: ${count(counts.installedUnits)} installed units are reported across ` +
        `${count(counts.equipmentRows)} salon-and-equipment rows. A zero in this source means the ` +
        `equipment is NOT INSTALLED, so no unit here is installed-but-idle and you must not say one is.`,
    );
    if (counts.multiUnitSalons.length > 0) {
      lines.push(
        `  The difference is salons holding more than one unit of a type: ` +
          counts.multiUnitSalons
            .map(
              (salon) =>
                `${salon.storeName} (${count(salon.units)} units, ${count(salon.typesUsed)} types)`,
            )
            .join("; ") +
          ".",
      );
    }
    if (counts.unexplainedUnits !== 0) {
      lines.push(
        `  ${count(Math.abs(counts.unexplainedUnits))} unit(s) are not accounted for by that. ` +
          `Say the counts do not reconcile and that it is a question for the delivery; do not explain it.`,
      );
    }
  }

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
      "The source leaves the cell BLANK for equipment a salon does not have, and a blank or a zero is stored as no fact rather than as no sessions. " +
      "So a salon missing an equipment type is not underperforming on it, and the peer average for that type is taken over the salons that do have it.",
  );

  return lines.join("\n");
}

function spaEngagementSection(input: SpaEngagementBriefingInput): string {
  const population = input.rankedPopulation;
  const lines: string[] = [
    `SPA ENGAGEMENT — ${periodSentence(input.period, input.provenance.sourcePeriodLabel)}`,
    `Report ${provenanceSentence(input.provenance)}.`,
    `Across these salons: ${count(input.totals.salonCount)} salons, ${count(input.totals.spaSessions)} spa sessions, ` +
      `${count(input.totals.totalUniqueTanners)} unique tanners, ${count(input.totals.uniqueSpaTanners)} unique spa tanners, ` +
      `${count(input.totals.spaBeds)} spa beds.`,
    `Across these salons, Spa Per Unique % (spa sessions / total unique tanners) = ${rate(input.totals.spaPerUniquePercent)}.`,
    /*
     * NO COMBINED FIGURE FOR THE BED-NORMALIZED MEASURE. `engagementTotals`
     * returns null for any multi-salon selection because the source publishes
     * none — so the briefing says that in words rather than printing a number
     * the model would then quote back as a company figure.
     */
    input.totals.spaSessionsPerUniquePerBed === null
      ? `Spa Sessions per Unique Tanner per Spa Bed (spa sessions / total unique tanners / spa beds) has NO approved combined total across salons — the source leaves that cell blank. Compare the salon-level figures below instead, and never sum or average them into one.`
      : `For this salon, Spa Sessions per Unique Tanner per Spa Bed (spa sessions / total unique tanners / spa beds) = ` +
        `${fixed(input.totals.spaSessionsPerUniquePerBed, 4)}.`,
    `Across these salons, Spa Sessions per Spa Bed = ${fixed(input.totals.spaSessionsPerBed, 2)}.`,
    `Across these salons, Unique Spa Tanner % (unique spa tanners / total unique tanners) = ${rate(input.totals.uniqueSpaTannerPercent)}.`,
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

  lines.push("");
  lines.push(...overallRankMethod(input));

  return lines.join("\n");
}

/**
 * HOW OVERALL RANK IS BUILT, said in the answer rather than left to be guessed.
 *
 * The figure travels well and the method does not: "rank 144 of 248" reads as a
 * verdict on the salon, and a manager asked to improve it cannot without being
 * told what moves it. Three things here are load bearing:
 *
 *   THE WEIGHTS COME FROM THE DELIVERY. They are published above the Rank
 *   columns and this text repeats whatever the ingested file carried. A briefing
 *   that quoted 25/25/50 from memory would keep saying so after the business
 *   changed them, which is the failure that matters: the number would still be
 *   right and the explanation of it wrong.
 *
 *   IT IS NOT SPA CONVERSION RATE. Spa Conversion Rate — spa sessions / total
 *   tans — is the documented store-execution metric and the lead KPI on the
 *   page, and it is not an input to this rank at all. The two are adjacent
 *   enough in conversation that the answer says so outright.
 *
 *   THE POPULATION IS THE CHAIN. A rank improves by out-ranking salons this
 *   company does not operate, so the denominator is named every time.
 */
function overallRankMethod(input: SpaEngagementBriefingInput): string[] {
  const weights = Object.entries(input.rankWeights);
  if (weights.length === 0) {
    return [
      "OVERALL RANK: this delivery published no ranking weights, so how its Overall Rank was built cannot be stated from it.",
    ];
  }

  const lines = [
    "HOW OVERALL RANK IS BUILT — the source's own method, reproduced from this delivery:",
    "  1. Three measures are each ranked across the chain, best first, Excel RANK.EQ style: tied salons share a rank and the next rank is skipped. The weights the delivery published above those rank columns are:",
  ];

  for (const [code, weight] of weights) {
    const measure = SPA_ENGAGEMENT_MEASURES_BY_CODE[code.replace(/^rank_/, "")];
    lines.push(
      measure
        ? `     ${measure.label} (${measure.formula}), weight ${weight}`
        : `     ${code}, weight ${weight}`,
    );
  }

  lines.push(
    "  2. A salon's score is the sum of weight x rank across those three, so a LOWER score is better, because rank 1 is the best rank.",
    "  3. Overall Rank is the position of that score, lowest score first, again RANK.EQ, so salons on the same score share an Overall Rank.",
  );

  lines.push(
    input.rankedPopulation
      ? `  The population is all ${count(input.rankedPopulation)} salons the source ranked, which includes salons this company does not operate — so "7" means 7th of ${count(input.rankedPopulation)} and a lower number is better.`
      : "  A lower number is better, and the population includes salons this company does not operate.",
  );

  lines.push(
    "  Overall Rank is NOT Spa Conversion Rate. Spa Conversion Rate is spa sessions / total tans and is not one of the three measures above, so a salon can rank well on one and poorly on the other.",
  );

  return lines;
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
      ? `Across these salons: ${count(totals.salonCount)} salons, ${count(totals.spaSessions)} spa sessions over ` +
        `${count(totals.totalTans)} tans = ${rate(totals.conversion.rate)}.`
      : `Conversion across these salons is N/A — ${totals.conversion.reasonText}`,
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
