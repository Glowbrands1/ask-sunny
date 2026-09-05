import {
  SALES_TOTALS_MEASURES_BY_CODE,
  type SalesTotalsMeasure,
} from "../sales-totals/metric-map";
import { aggregateMeasure } from "../read/sales-totals-aggregate";
import type { SalesTotalsSubject } from "../read/sales-totals-read";

/**
 * ============================================================================
 * THE COMPARISONS THE SERVER MAKES, SO THE MODEL DOES NOT HAVE TO GUESS THEM
 * ============================================================================
 *
 * Live QA found the analysis layer eyeballing rows and narrating the result:
 * "start with the two ends of the ranking, then the PPTA column", "this is
 * where the row-to-row differences are widest", "a few salons show high tan
 * volume alongside low takings". Each of those sounds like analysis and none of
 * them had a defined basis. The last two were worse than vague — "widest
 * differences" was comparing a dollar range against a per-transaction dollar
 * range against a count range, which are three different units, and "high
 * volume alongside low takings" was a threshold nobody defined.
 *
 * THE FIX IS NOT A STERNER PROMPT. Asking a model not to eyeball a table while
 * handing it a table and a question about which rows matter is asking it to
 * decline the task. So the arithmetic moves here: rank, median, quartile,
 * deviation from median, who reported and who did not. Those are computable,
 * they are the same every time, and a test can pin them. What is left for the
 * model is what a model is actually for — saying what the signals mean, in
 * sentences a manager can act on, with the basis attached.
 *
 * WHAT THIS MODULE DELIBERATELY DOES NOT COMPUTE
 *
 *   NO CROSS-METRIC VARIABILITY RANKING. There is no "which metric has the
 *   widest spread", because a spread in dollars, a spread in dollars per
 *   transaction and a spread in session counts cannot be ordered against each
 *   other. A coefficient of variation would make them dimensionless and would
 *   still be the wrong question — a manager asking what to look at is not
 *   asking which column happens to be noisiest. If a normalised comparison is
 *   ever wanted it needs its own design and its own tests, not a range
 *   subtraction.
 *
 *   NO IQR FENCES, NO Z-SCORES, NO OUTLIER THRESHOLD. Any cutoff would be a
 *   number invented here and then quoted downstream as though the business had
 *   chosen it. Rank, quartile and distance from the median describe the same
 *   distribution without asserting where "unusual" begins.
 *
 *   NO PERCENTILE. With fifteen salons a percentile implies a precision the
 *   population cannot carry — the gap between the 71st and 78th percentile is
 *   one salon. Rank out of the reporting count says it exactly, and quartile
 *   says it coarsely; between them nothing is lost.
 *
 * ============================================================================
 * RANKING CONVENTION — COMPETITION RANKING ("1224")
 * ============================================================================
 *
 * Equal values receive EQUAL RANK, and the next distinct value skips the ranks
 * the tie consumed:
 *
 *     values   10   8   8   5
 *     ranks     1   2   2   4
 *
 * THE BUG THIS REPLACES: rank was `index + 1` off a sorted array, so two salons
 * reporting the same figure got different ranks — whichever the sort happened
 * to put first was "rank 3" and the other "rank 4". That is not a defensible
 * signal, and it was not theoretical: EFTs and New Customers are small counts
 * across fifteen salons, so ties are ordinary. Worse, a tie straddling a
 * quartile boundary put two identical numbers in two different analytical
 * bands.
 *
 * WHY COMPETITION AND NOT DENSE ("1223"). The rank is read aloud with its
 * denominator — "rank 4 of 15" — and competition ranking keeps that pair
 * honest: four salons ranked ahead of you means four salons ranked ahead of
 * you. Dense ranking would say "rank 3 of 15" for the same salon, which counts
 * distinct values rather than salons and makes the denominator a different
 * population from the numerator.
 *
 * QUARTILES FOLLOW FOR FREE, and that is the point of deriving them from rank
 * rather than from position. A band is a function of the rank, tied values now
 * share a rank, so tied values necessarily share a band — the boundary case
 * cannot split them because there is nothing left to split. A tie that
 * straddles a nominal boundary takes the band of its shared rank, which is the
 * better of the two; the alternative would be to break the tie, which is the
 * thing being fixed.
 *
 * DISPLAY ORDER AMONG TIES IS BY SALON NUMBER, so the same figures produce the
 * same text whatever order the database returned the rows in. It changes no
 * rank, quartile or deviation — only which tied line is printed first.
 *
 *   NO PERFORMANCE JUDGEMENT. Not "weak", not "underperforming", not "needs
 *   attention". This report has no target, no budget, no forecast and no prior
 *   period, so nothing here can distinguish a salon having a quiet Tuesday from
 *   a salon in trouble. Every signal is explicitly WITHIN THIS SELECTION ON
 *   THIS ONE DATE, and `baselineAvailable` below states that in the data rather
 *   than only in a comment.
 *
 * MISSING IS EXCLUDED, NEVER ZEROED. A blank cell is dropped from the sorted
 * array before the median is taken, from the rank list, and from the
 * denominator. `missingSalons` counts it instead, so "not reported" is a
 * visible fact rather than a silent zero dragging a median down.
 */

/** Which quarter of the reporting population a salon's value falls in. */
export type QuartileBand =
  | "top"
  | "upper_middle"
  | "lower_middle"
  | "bottom";

export const QUARTILE_LABELS: Record<QuartileBand, string> = {
  top: "top quartile",
  upper_middle: "upper-middle quartile",
  lower_middle: "lower-middle quartile",
  bottom: "bottom quartile",
};

/**
 * Fewer than four reporting salons cannot be divided into quarters.
 *
 * Reported as `null` rather than fudged: with three salons a "quartile" is a
 * label with no population behind it, and the rank already says everything the
 * quartile would have.
 */
export const MIN_SALONS_FOR_QUARTILES = 4;

/** One salon's position within the reporting population for one measure. */
export interface SalonMetricSignal {
  readonly salonNumber: string;
  readonly storeName: string;
  readonly value: number;
  /**
   * COMPETITION RANK. 1 is the highest reported value, and equal values share
   * a rank. See `RANKING CONVENTION` above.
   */
  readonly rank: number;
  /** How many salons reported this measure. The rank's denominator. */
  readonly outOf: number;
  /** Null when there are too few reporting salons to divide into quarters. */
  readonly quartile: QuartileBand | null;
  /** Signed distance from the median of the reporting salons. */
  readonly deviationFromMedian: number;
  /**
   * The SIGNED PERCENTAGE DIFFERENCE from the median, rounded to whole percent.
   *
   * +67 means the value is 67% ABOVE the median. It does NOT mean the value is
   * 67% OF the median — a value 67% above a median of 600 is 1000, which is
   * 167% of it. The old name for this field was `percentVsMedian`, and that
   * ambiguity is exactly how the grounding text came to render it as "+67% of
   * the median", which is a different and wrong claim. The name now says which
   * quantity it is.
   *
   * Null when the median is zero, because the ratio is undefined — not
   * Infinity, and certainly not 0.
   */
  readonly percentDifferenceFromMedian: number | null;
}

/** The distribution of one measure across the selected salons. */
export interface MetricDistribution {
  readonly metricCode: string;
  readonly metricLabel: string;
  readonly unit: "currency" | "count";
  /** `average` measures are never summed — PPTA is the only one. */
  readonly summable: boolean;
  readonly selectedSalons: number;
  readonly reportingSalons: number;
  /** Selected salons whose cell was blank. Excluded from every figure here. */
  readonly missingSalons: number;
  /** Names of the salons that did not report, so they can be listed. */
  readonly missingSalonNames: readonly string[];
  /**
   * EVERY salon sharing the last rank, not the first one that happened to sort
   * there. Empty when nothing reported.
   *
   * An array because a tie is common — EFTs and New Customers are small counts
   * across fifteen salons — and naming one of three tied salons as "the lowest"
   * is a false claim about the other two.
   */
  readonly lowest: readonly SalonMetricSignal[];
  /** Every salon sharing rank 1. Empty when nothing reported. */
  readonly highest: readonly SalonMetricSignal[];
  /**
   * True when every reporting salon reported the same value.
   *
   * Then `highest` and `lowest` are the same set, and describing them as two
   * ends would invent a spread the data does not have.
   */
  readonly allValuesEqual: boolean;
  readonly median: number | null;
  /**
   * The sum of the reported figures, for summable measures only.
   *
   * Taken from `aggregateMeasure` rather than added up here, so there is
   * exactly one implementation of "the total of these salons" in the codebase
   * and the dashboard's total and the analyser's cannot drift.
   */
  readonly populationTotal: number | null;
  /** Why there is no total, when there is none. The aggregate layer's words. */
  readonly noTotalReason: string | null;
  /** Every reporting salon, highest first. */
  readonly rows: readonly SalonMetricSignal[];
}

/** Everything the analysis layer computed, and what it could not. */
export interface SalesTotalsSignals {
  /** The measure the manager has selected. The primary analysis. */
  readonly selected: MetricDistribution;
  /** The others, for follow-up questions. Descriptive, not prioritised. */
  readonly others: readonly MetricDistribution[];
  /**
   * Whether any performance baseline exists in this context.
   *
   * Always false today, and present as a FIELD rather than a comment so the
   * grounding text states it as data. One snapshot, no target, no budget, no
   * prior period: rank and median can say where results differ, and nothing
   * here can say what is underperforming.
   */
  readonly baselineAvailable: false;
}

/** Ascending median. Even counts average the two middles. */
function medianOf(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * Which quarter a rank falls in, counting from the highest value.
 *
 * Rank-derived rather than value-interpolated on purpose. An interpolated Q1
 * boundary would require choosing between several quantile conventions that
 * disagree on small samples, and the choice would then be quoted as a threshold
 * the business set. Dividing the ranks in four needs no convention: with 14
 * reporting salons the top quartile is ranks 1 to 3, which is what
 * `ceil(rank / 14 * 4)` gives.
 */
export function quartileForRank(rank: number, outOf: number): QuartileBand | null {
  if (outOf < MIN_SALONS_FOR_QUARTILES) return null;
  const quarter = Math.min(4, Math.max(1, Math.ceil((rank / outOf) * 4)));
  return (["top", "upper_middle", "lower_middle", "bottom"] as const)[quarter - 1];
}

/** Two decimal places, without binary-floating-point drift. */
function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** The distribution of one measure across one set of salons. */
export function describeMetric(
  salons: readonly SalesTotalsSubject[],
  metricCode: string,
): MetricDistribution {
  const measure: SalesTotalsMeasure | undefined = SALES_TOTALS_MEASURES_BY_CODE[metricCode];
  if (!measure) throw new Error(`Unknown Sales Totals measure: ${metricCode}`);

  const reported: { salon: SalesTotalsSubject; value: number }[] = [];
  const missing: string[] = [];

  for (const salon of salons) {
    const value = salon.figures.find((entry) => entry.metricCode === metricCode)?.value ?? null;
    // A BLANK CELL LEAVES THE POPULATION ENTIRELY. Not zeroed, not ranked, not
    // in the denominator — counted, named, and excluded.
    if (value === null) missing.push(`${salon.label} (#${salon.salonNumber ?? salon.key})`);
    else reported.push({ salon, value });
  }

  const values = reported.map((entry) => entry.value);
  const rawMedian = medianOf(values);
  const median =
    rawMedian === null ? null : measure.unit === "currency" ? roundCurrency(rawMedian) : rawMedian;

  /*
   * COMPARED AT DISPLAY PRECISION FOR CURRENCY. Two salons that both show
   * $500.50 must tie, and they would not if one carried a fraction of a cent
   * from upstream. The rounding decides only whether values are EQUAL; the
   * value reported is still the one that was read.
   */
  const comparable = (value: number) =>
    measure.unit === "currency" ? roundCurrency(value) : value;

  /*
   * Highest first, then by salon number among equals — so the same figures
   * produce the same text whatever order the rows arrived in. The tiebreak
   * affects print order only; every tied salon gets the same rank below.
   */
  const ordered = [...reported].sort(
    (left, right) =>
      comparable(right.value) - comparable(left.value) ||
      (left.salon.salonNumber ?? left.salon.key).localeCompare(
        right.salon.salonNumber ?? right.salon.key,
      ),
  );
  const outOf = ordered.length;

  /*
   * COMPETITION RANKING. A new rank is taken only when the value CHANGES, and
   * when it does it jumps to the position in the ordering — so 10, 8, 8, 5
   * ranks 1, 2, 2, 4.
   */
  const ranks: number[] = [];
  let currentRank = 1;
  for (let index = 0; index < ordered.length; index += 1) {
    if (index > 0 && comparable(ordered[index].value) !== comparable(ordered[index - 1].value)) {
      currentRank = index + 1;
    }
    ranks.push(currentRank);
  }

  const rows: SalonMetricSignal[] = ordered.map((entry, index) => {
    const rank = ranks[index];
    const deviation = median === null ? 0 : entry.value - median;
    return {
      salonNumber: entry.salon.salonNumber ?? entry.salon.key,
      storeName: entry.salon.label,
      value: entry.value,
      rank,
      outOf,
      // Derived from the tie-aware rank, so equal values cannot land in
      // different bands.
      quartile: quartileForRank(rank, outOf),
      deviationFromMedian:
        measure.unit === "currency" ? roundCurrency(deviation) : deviation,
      percentDifferenceFromMedian:
        median === null || median === 0 ? null : Math.round((deviation / median) * 100),
    };
  });

  // Every salon at each end, not the one that sorted there first.
  const worstRank = rows.length > 0 ? rows[rows.length - 1].rank : 0;
  const highest = rows.filter((row) => row.rank === 1);
  const lowest = rows.filter((row) => row.rank === worstRank);

  /*
   * The total comes from the aggregate layer, which already knows that PPTA
   * cannot be combined and why. Re-deriving it here would put a second
   * summation in the codebase and a second chance to sum something that must
   * not be summed.
   */
  const aggregate = aggregateMeasure(salons, metricCode);
  const summable = measure.aggregation === "sum";

  return {
    metricCode,
    metricLabel: measure.label,
    unit: measure.unit,
    summable,
    selectedSalons: salons.length,
    reportingSalons: outOf,
    missingSalons: missing.length,
    missingSalonNames: missing,
    lowest,
    highest,
    // One distinct value across the whole reporting population: everybody is
    // rank 1, so there are no two ends to describe.
    allValuesEqual: rows.length > 0 && highest.length === rows.length,
    median,
    populationTotal: summable && aggregate.basis !== "not_aggregatable" ? aggregate.value : null,
    noTotalReason: aggregate.basis === "not_aggregatable" ? aggregate.reason : null,
    rows,
  };
}

/**
 * Every measure's distribution, with the selected one separated out.
 *
 * THE SEPARATION IS THE POINT, and it is what RULE 1 of this remediation is
 * about. Handing the model six equally-presented distributions is how a
 * question about Grand Total got answered with a paragraph about PPTA: nothing
 * in the context said which measure the manager was actually looking at, so the
 * most interesting-looking column won. The selected measure is now structurally
 * first and the rest are labelled as available for follow-ups.
 */
export function computeSalesTotalsSignals(
  salons: readonly SalesTotalsSubject[],
  selectedMetricCode: string,
  allMetricCodes: readonly string[],
): SalesTotalsSignals {
  return {
    selected: describeMetric(salons, selectedMetricCode),
    others: allMetricCodes
      .filter((code) => code !== selectedMetricCode)
      .map((code) => describeMetric(salons, code)),
    baselineAvailable: false,
  };
}
