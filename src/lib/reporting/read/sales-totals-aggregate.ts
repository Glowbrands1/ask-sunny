import {
  SALES_TOTALS_MEASURES_BY_CODE,
  type SalesTotalsMeasure,
} from "../sales-totals/metric-map";
import type { SalesTotalsFigure, SalesTotalsSubject } from "./sales-totals-read";

/**
 * ============================================================================
 * COMBINING SALONS, AND KNOWING WHEN NOT TO
 * ============================================================================
 *
 * Pure functions, no database, so the arithmetic can be PROVEN by test rather
 * than eyeballed on a dashboard. That is the whole reason this is a separate
 * module: a screenshot is not evidence about money.
 *
 * TWO POPULATIONS, AND ONLY ONE OF THEM IS SUMMABLE.
 *
 *   1. THE SOURCE ESTATE SUMMARY — All Salons, STC Consolidated, STC
 *      Franchisees. Verified against both real reports: these are per-salon
 *      AVERAGES over the whole estate, not totals.
 *
 *          (98 x 734.50 + 151 x 872.94) / 249 = 818.4536
 *          All Salons reported                = 818.45      <- matches
 *          98 + 151 summed                    = 1,607.44    <- does not
 *
 *      Never summed, never combined, never derived from the salon rows. They
 *      are read straight from the report and labelled as averages.
 *
 *   2. THIS DELIVERY'S SALONS — the 15 individual salon rows. Real per-salon
 *      figures, and summing them is exactly what a manager means by "sales
 *      across these salons". Their sum is roughly 15x the estate AVERAGE, and
 *      is not comparable to it.
 *
 * PPTA IS THE EXCEPTION, and it is not a judgement call — it is arithmetic.
 * Per-person tanning average is money per TRANSACTION, so combining it needs
 * the transaction counts as weights. Checking whether the source weights by
 * salon count instead:
 *
 *      salon-count-weighted    Sep 1: 2.2802     Sep 2: 2.3266
 *      All Salons reported     Sep 1: 2.25       Sep 2: 2.30
 *
 * Neither matches, on either date. So the source uses a denominator this report
 * does not publish, and no combination available here reproduces it. A sum
 * would be nonsense; a plain mean of the salons' PPTAs would be a different
 * number that looks authoritative and is not the estate's. Both are refused,
 * and the card says why.
 */

/** How a combined figure was arrived at — or why there isn't one. */
export type AggregationBasis =
  /** One salon: its own reported figure, untouched. */
  | "reported"
  /** Several salons: the sum of their reported figures. */
  | "summed"
  /** Deliberately not combined. `reason` says why. */
  | "not_aggregatable";

export interface AggregatedFigure {
  readonly metricCode: string;
  readonly metricLabel: string;
  readonly unit: "currency" | "count";
  readonly value: number | null;
  readonly basis: AggregationBasis;
  /** How many of the selected salons actually reported this measure. */
  readonly reportingSalons: number;
  /** How many were selected. */
  readonly selectedSalons: number;
  /**
   * Secondary figure: the mean across the salons that reported, for measures
   * where a total is the headline but an average is a useful companion. Null
   * for anything not summable.
   */
  readonly meanPerSalon: number | null;
  /** Present only when `basis` is `not_aggregatable`. */
  readonly reason: string | null;
}

/** The label a figure should carry, given the population it describes. */
export function figureHeading(
  measure: SalesTotalsMeasure,
  scopeKind: "summary" | "salon",
  salonsSelected: number,
): string {
  if (scopeKind === "summary") {
    /*
     * The fix for the reported defect. "Grand Total $734.50" against a single
     * salon's $958.79 reads as arithmetically broken, because the first is an
     * average over 98 salons and the second is one salon's takings. The source
     * COLUMN is still called Grand Total — that name lives in the lineage
     * panel — but the card names what the value IS.
     */
    if (measure.summaryIsAverage) {
      return measure.code === "grand_total"
        ? "Average sales per salon"
        : `Average ${measure.label.toLowerCase()} per salon`;
    }
    return measure.label;
  }

  if (measure.aggregation === "average") return measure.label;
  if (salonsSelected > 1) {
    return measure.code === "grand_total" ? "Total sales" : `Total ${measure.label.toLowerCase()}`;
  }
  return measure.label;
}

/** One measure across a set of salon subjects. */
export function aggregateMeasure(
  salons: readonly SalesTotalsSubject[],
  metricCode: string,
): AggregatedFigure {
  const measure = SALES_TOTALS_MEASURES_BY_CODE[metricCode];
  if (!measure) throw new Error(`Unknown Sales Totals measure: ${metricCode}`);

  const figures = salons
    .map((salon) => salon.figures.find((figure) => figure.metricCode === metricCode))
    .filter((figure): figure is SalesTotalsFigure => figure !== undefined);

  // A blank cell is "not reported", which is not zero, so it is excluded from
  // both the sum and the count of contributors rather than dragging an average
  // down.
  const reported = figures.filter((figure) => figure.value !== null);

  const base = {
    metricCode,
    metricLabel: measure.label,
    unit: measure.unit,
    reportingSalons: reported.length,
    selectedSalons: salons.length,
  } as const;

  if (salons.length === 0) {
    return { ...base, value: null, basis: "reported", meanPerSalon: null, reason: null };
  }

  /*
   * ONE SALON is not an aggregation at all — it is that salon's reported
   * figure, and it is returned untouched for every measure including PPTA.
   */
  if (salons.length === 1) {
    return {
      ...base,
      value: reported[0]?.value ?? null,
      basis: "reported",
      meanPerSalon: null,
      reason: null,
    };
  }

  if (measure.aggregation === "average") {
    return {
      ...base,
      value: null,
      basis: "not_aggregatable",
      meanPerSalon: null,
      reason:
        `${measure.label} is money per transaction, so combining it needs each salon's ` +
        `transaction count as a weight. This report does not include those counts, and the ` +
        `source's own estate figure cannot be reproduced from what it publishes — so no ` +
        `combined ${measure.label} is shown. Select a single salon, or read the estate ` +
        `figure the report provides.`,
    };
  }

  if (reported.length === 0) {
    return { ...base, value: null, basis: "summed", meanPerSalon: null, reason: null };
  }

  const total = reported.reduce((sum, figure) => sum + (figure.value ?? 0), 0);
  return {
    ...base,
    // Currency is summed in cents to keep floating point from drifting: 0.1 +
    // 0.2 is not 0.3, and a total of fifteen dollar amounts should be exact.
    value: measure.unit === "currency" ? roundCurrency(total) : total,
    basis: "summed",
    meanPerSalon:
      measure.unit === "currency"
        ? roundCurrency(total / reported.length)
        : total / reported.length,
    reason: null,
  };
}

/** Every measure across a set of salons, in report order. */
export function aggregateSalons(
  salons: readonly SalesTotalsSubject[],
  metricCodes: readonly string[],
): AggregatedFigure[] {
  return metricCodes.map((code) => aggregateMeasure(salons, code));
}

/** Two decimal places, without binary-floating-point drift. */
function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** What the selected-salons section should be called. */
export function selectionHeading(
  salons: readonly SalesTotalsSubject[],
  totalAvailable: number,
): string {
  if (salons.length === 0) return "No salons selected";
  if (salons.length === 1) return salons[0].label;
  if (salons.length === totalAvailable) return `All ${totalAvailable} salons in this delivery`;
  return `${salons.length} salons selected`;
}
