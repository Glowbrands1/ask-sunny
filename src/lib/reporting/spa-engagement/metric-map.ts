/**
 * ============================================================================
 * SPA ENGAGEMENT — FOUR METRICS THAT LOOK ALIKE AND ARE NOT
 * ============================================================================
 *
 * The single most important thing in this module is that two of these metrics
 * have similar names, similar magnitudes in some stores, and completely
 * different business meanings. They were supplied by different people for
 * different questions and conflating them changes an approved definition:
 *
 *   SPA PER UNIQUE %          Spa Sessions ÷ Total Unique Tanners
 *                             "how often does the tanning customer base use
 *                             spa services?" — Madeline's formula. A store
 *                             measure. NOT divided by beds.
 *
 *   SPA SESSIONS PER UNIQUE   Spa Sessions ÷ Total Unique Tanners ÷ Spa Beds
 *   TANNER PER SPA BED        the workbook's own bed-normalized figure, and
 *                             what the file is named after. An EQUIPMENT
 *                             productivity measure: it asks how hard each
 *                             installed bed works per customer, so a store
 *                             that adds a fifth bed can see its value fall
 *                             while Spa Per Unique % rises.
 *
 * For NE Grand Island on 1 September 2026: 33 sessions, 74 unique tanners, 4
 * beds. Spa Per Unique % = 44.6%. Spa Sessions per Unique Tanner per Spa Bed =
 * 0.1115. Presenting the second under the first's name would report a store
 * converting 45% of its customers as converting 11% — and the ranking built on
 * it would be a different ranking. They are separate codes, separate labels and
 * separate columns everywhere, and the labels below are the only ones either
 * may be shown under.
 *
 * The other two:
 *
 *   SPA SESSIONS PER BED      Spa Sessions ÷ Spa Beds. Raw equipment
 *                             throughput, not normalized for store size.
 *   UNIQUE SPA TANNER %       Unique Spa Tanners ÷ Total Unique Tanners. What
 *                             share of the customer base touched spa at all —
 *                             a REACH measure, where Spa Per Unique % is a
 *                             FREQUENCY measure. A store where a few devotees
 *                             use spa daily has high frequency and low reach.
 *
 * All four were verified against the workbook's own columns for all 248 salons
 * with zero mismatches, which is what `formulas` records below.
 */

export interface SpaEngagementMeasure {
  readonly code: string;
  readonly label: string;
  /** The formula, as it is shown to a reader. */
  readonly formula: string;
  readonly unit: "count" | "percent" | "ratio";
  readonly higherIsBetter: boolean | null;
  /** Whether recombining across salons requires recomputation from its parts. */
  readonly aggregation: "sum" | "derived";
  readonly note: string;
}

/**
 * THE MEASURES. Codes are stable; labels are the approved wording.
 *
 * `derived` measures are RECOMPUTED from their numerator and denominator when
 * salons are combined, never averaged. Averaging fifteen ratios weights a
 * 42-customer salon the same as a 212-customer one.
 */
export const SPA_ENGAGEMENT_MEASURES: readonly SpaEngagementMeasure[] = [
  {
    code: "spa_sessions",
    label: "Spa Sessions",
    formula: "Reported by the source",
    unit: "count",
    higherIsBetter: true,
    aggregation: "sum",
    note: "Spa sessions taken in the period.",
  },
  {
    code: "total_unique_tanners",
    label: "Total Unique Tanners",
    formula: "Reported by the source",
    unit: "count",
    higherIsBetter: true,
    aggregation: "sum",
    note: "Distinct customers who visited in the period, spa or not. The denominator of both percentage measures.",
  },
  {
    code: "unique_spa_tanners",
    label: "Unique Spa Tanners",
    formula: "Reported by the source",
    unit: "count",
    higherIsBetter: true,
    aggregation: "sum",
    note: "Distinct customers who took at least one spa session.",
  },
  {
    code: "spa_beds",
    label: "Spa Beds",
    formula: "Reported by the source",
    unit: "count",
    higherIsBetter: null,
    aggregation: "sum",
    note: "Installed spa units. More beds is neither good nor bad on its own — it is the denominator that says whether they are being used.",
  },
  {
    code: "spa_per_unique_pct",
    label: "Spa Per Unique %",
    formula: "Spa Sessions ÷ Total Unique Tanners",
    unit: "percent",
    higherIsBetter: true,
    aggregation: "derived",
    note: "How frequently the tanning customer base uses spa services. NOT divided by beds — that is a different metric with a different name.",
  },
  {
    code: "spa_sessions_per_bed",
    label: "Spa Sessions per Bed",
    formula: "Spa Sessions ÷ Spa Beds",
    unit: "ratio",
    higherIsBetter: true,
    aggregation: "derived",
    note: "Raw throughput per installed unit, not adjusted for how many customers the store has.",
  },
  {
    code: "spa_sessions_per_unique_per_bed",
    label: "Spa Sessions per Unique Tanner per Spa Bed",
    formula: "Spa Sessions ÷ Total Unique Tanners ÷ Spa Beds",
    unit: "ratio",
    higherIsBetter: true,
    aggregation: "derived",
    note: "The workbook's bed-normalized productivity figure, and the report's own title measure. It is NOT Spa Per Unique % and must never be labelled as it.",
  },
  {
    code: "unique_spa_tanner_pct",
    label: "Unique Spa Tanner %",
    formula: "Unique Spa Tanners ÷ Total Unique Tanners",
    unit: "percent",
    higherIsBetter: true,
    aggregation: "derived",
    note: "What share of the customer base touched spa at all. Reach, where Spa Per Unique % is frequency.",
  },
];

export const SPA_ENGAGEMENT_MEASURES_BY_CODE: Readonly<Record<string, SpaEngagementMeasure>> =
  Object.fromEntries(SPA_ENGAGEMENT_MEASURES.map((measure) => [measure.code, measure]));

/**
 * ============================================================================
 * THE WORKBOOK'S RANKING, REPRODUCED RATHER THAN REINVENTED
 * ============================================================================
 *
 * The `All Summary` and `All DM Ranking` sheets both carry three per-metric
 * Rank columns, an Overall Rank, and a row of WEIGHTS above the Rank columns.
 * The weights are read from the sheet, never assumed — see `parser.ts`. In the
 * 1 September 2026 report they are:
 *
 *     Spa Sessions per Bed                          0.25
 *     Spa Sessions per Unique Tanner per Spa Bed    0.25
 *     Unique Spa Tanner % of Total Unique           0.50
 *
 * The methodology, established by reproducing the workbook's own published
 * values across all 248 salons and all 55 district managers:
 *
 *   1. Each of the three metrics is ranked DESCENDING, Excel `RANK.EQ` style:
 *      a value's rank is one plus the number of values strictly greater than
 *      it. Ties therefore SHARE a rank and the next rank is skipped, which is
 *      why a positional index does not reproduce the sheet (it agrees on only
 *      107 of 248 rows for Spa Sessions per Bed, where ties are common).
 *   2. The weighted score is the sum of weight x rank. LOWER IS BETTER, since
 *      rank 1 is the best.
 *   3. Overall Rank is `RANK.EQ` ASCENDING on that score: one plus the number
 *      of scores strictly less than it.
 *
 * Verified: 248/248 salons and 55/55 district managers reproduce the
 * workbook's own Rank and Overall Rank columns exactly. `spa-engagement`'s
 * regression suite pins this against the real file.
 *
 * THE RANKING POPULATION IS THE WHOLE CHAIN, and that is a property of the
 * metric rather than a data-scoping decision: "rank 7 of 248" is what the
 * source published and what a manager is being measured on. So the ranks are
 * computed over every row, and only the AUTHORIZED company's rows — carrying
 * their chain-wide rank and the population size — are kept. No other company's
 * salon, figure or name is retained.
 */
export const SPA_ENGAGEMENT_RANK_METRICS: readonly {
  readonly code: string;
  /** The measure that is ranked. */
  readonly measureCode: string;
  /** The header the workbook writes above its Rank column. */
  readonly sourceHeader: string;
}[] = [
  {
    code: "rank_spa_sessions_per_bed",
    measureCode: "spa_sessions_per_bed",
    sourceHeader: "spa sessions per bed",
  },
  {
    code: "rank_spa_sessions_per_unique_per_bed",
    measureCode: "spa_sessions_per_unique_per_bed",
    sourceHeader: "spa sessions per unique tanner per spa bed",
  },
  {
    code: "rank_unique_spa_tanner_pct",
    measureCode: "unique_spa_tanner_pct",
    sourceHeader: "unique spa tanner % of total unique",
  },
];

/**
 * Excel `RANK.EQ` over a list, descending: 1 + the count of strictly greater.
 *
 * Ties share a rank and the following rank is skipped — 1, 2, 2, 4 — which is
 * what the workbook does and what a sort-position index does not.
 */
export function rankDescending(values: readonly number[], value: number): number {
  let greater = 0;
  for (const other of values) if (other > value) greater += 1;
  return greater + 1;
}

/** The same, ascending: 1 + the count of strictly less. Used for the score. */
export function rankAscending(values: readonly number[], value: number): number {
  let less = 0;
  for (const other of values) if (other < value) less += 1;
  return less + 1;
}
