import type { ReportMetricUnit } from "../types";
import { aggregate, isSummable } from "./aggregation";
import type {
  MetricAggregate,
  MetricDescriptor,
  SalonMetricValue,
  SalonPeriodDescriptors,
} from "./types";

/**
 * THE DASHBOARD VIEW MODEL.
 *
 * Pure functions over rows the repository fetched. Keeping the arithmetic here,
 * away from React, is what makes "2026 vs 2024 reconciles with the source
 * facts" a testable claim rather than something inspected by eye in a browser.
 *
 * Two rules run through all of it:
 *
 *   A MISSING BASELINE IS NEVER ZERO. `spa_sessions` has no 2019 figures, and a
 *   salon can be absent from a measure entirely. Those render as unavailable;
 *   substituting 0 would show a 100% collapse that never happened.
 *
 *   A REPORTED CHANGE BEATS A DERIVED ONE. The workbook computes its own
 *   percentage changes, sometimes against figures this copy does not contain
 *   (chain-wide baselines, trailing windows). Where the source states a change
 *   we use it; only otherwise do we derive one, and the output says which.
 */

/** One value for one salon, keyed for lookup. */
export interface FactRow {
  salonNumber: string;
  storeName: string;
  metricCode: string;
  basisYear: number | null;
  value: number;
  sourceSheet: string;
  sourceColumn: string;
}

export type ChangeSource = "reported" | "derived" | "unavailable";

export interface DashboardKpi {
  metricCode: string;
  label: string;
  unit: ReportMetricUnit;
  /** Null means the business has not defined a direction. Never coloured. */
  higherIsBetter: boolean | null;
  current: MetricAggregate;
  /** Null when the selected baseline year has no facts for this metric. */
  baseline: MetricAggregate | null;
  change: {
    value: number | null;
    source: ChangeSource;
    /** User-facing explanation of how the figure was arrived at. */
    note: string;
  };
  salonCount: number;
}

export interface SalonRankingRow {
  salonNumber: string;
  storeName: string;
  current: number | null;
  baseline: number | null;
  change: number | null;
  changeSource: ChangeSource;
  /** Reported by the source against the whole chain. Never recomputed. */
  revenueRank: number | null;
  quintileGroup: string | null;
  districtLabel: string | null;
  regionLabel: string | null;
}

/** Indexes facts by `metricCode|basisYear|salonNumber` for O(1) lookup. */
function indexFacts(facts: FactRow[]): Map<string, number> {
  const index = new Map<string, number>();
  for (const fact of facts) {
    index.set(`${fact.metricCode}|${fact.basisYear ?? "none"}|${fact.salonNumber}`, fact.value);
  }
  return index;
}

function valuesFor(facts: FactRow[], metricCode: string, basisYear: number): number[] {
  return facts
    .filter((fact) => fact.metricCode === metricCode && fact.basisYear === basisYear)
    .map((fact) => fact.value);
}

function salonsWith(facts: FactRow[], metricCode: string, basisYear: number): number {
  return new Set(
    facts
      .filter((fact) => fact.metricCode === metricCode && fact.basisYear === basisYear)
      .map((fact) => fact.salonNumber),
  ).size;
}

/** The `% change` metric a base metric owns, by naming convention in the catalogue. */
export function changeMetricCodeFor(metricCode: string): string {
  return `${metricCode}_pct_change`;
}

/**
 * Builds the KPI row.
 *
 * For a summable measure the headline is the slice total and the change is
 * computed from the two totals — valid arithmetic on the salons in view, and
 * explicitly not a chain figure.
 *
 * For anything not summable there is no honest single total, so the headline is
 * the median and the change is the MEDIAN OF THE REPORTED per-salon changes.
 * Never their mean: averaging percentages across salons weights a small salon
 * equally with a large one.
 */
export function buildKpiCards(input: {
  metricCodes: string[];
  catalogue: MetricDescriptor[];
  facts: FactRow[];
  currentYear: number;
  baselineYear: number;
}): DashboardKpi[] {
  const { metricCodes, catalogue, facts, currentYear, baselineYear } = input;
  const cards: DashboardKpi[] = [];

  for (const code of metricCodes) {
    const metric = catalogue.find((entry) => entry.code === code);
    if (!metric) continue;

    const summable = isSummable(metric.unit);
    const kind = summable ? "sum" : "median";

    const currentValues = valuesFor(facts, code, currentYear);
    const baselineValues = valuesFor(facts, code, baselineYear);

    const current = aggregate({
      metricCode: code,
      basisYear: currentYear,
      unit: metric.unit,
      values: currentValues,
      salonCount: salonsWith(facts, code, currentYear),
      kind,
    });

    // Absent, not zero. A metric with no facts for the selected baseline has no
    // baseline card at all.
    const baseline =
      baselineValues.length > 0
        ? aggregate({
            metricCode: code,
            basisYear: baselineYear,
            unit: metric.unit,
            values: baselineValues,
            salonCount: salonsWith(facts, code, baselineYear),
            kind,
          })
        : null;

    let change: DashboardKpi["change"] = {
      value: null,
      source: "unavailable",
      note: `No ${baselineYear} figures are reported for this measure, so no comparison is available.`,
    };

    if (summable && baseline?.value !== null && baseline !== null && baseline.value !== 0) {
      change = {
        value: ((current.value ?? 0) - baseline.value) / baseline.value,
        source: "derived",
        note: `Computed from the ${currentYear} and ${baselineYear} totals of the salons in view.`,
      };
    } else if (!summable) {
      // Fall back to what the source itself reported, per salon.
      const reported = valuesFor(facts, changeMetricCodeFor(code), baselineYear);
      if (reported.length > 0) {
        const median = aggregate({
          metricCode: changeMetricCodeFor(code),
          basisYear: baselineYear,
          unit: "percent",
          values: reported,
          salonCount: reported.length,
          kind: "median",
        });
        change = {
          value: median.value,
          source: "reported",
          note: `Median of the per-salon changes reported by the source. Percentages are not averaged across salons.`,
        };
      }
    }

    cards.push({
      metricCode: code,
      label: metric.label,
      unit: metric.unit,
      higherIsBetter: metric.higherIsBetter,
      current,
      baseline,
      change,
      salonCount: current.salonCount,
    });
  }

  return cards;
}

/**
 * Builds one row per salon for the ranking chart, comparison chart and table.
 *
 * Every salon matching the filters appears, including one with no figure for the
 * selected measure — it ranks last with an unavailable value rather than
 * vanishing, because a salon silently missing from a ranking is indistinguishable
 * from a salon that does not exist.
 */
export function buildSalonRows(input: {
  metricCode: string;
  salons: SalonPeriodDescriptors[];
  facts: FactRow[];
  currentYear: number;
  baselineYear: number;
}): SalonRankingRow[] {
  const { metricCode, salons, facts, currentYear, baselineYear } = input;
  const index = indexFacts(facts);
  const changeCode = changeMetricCodeFor(metricCode);

  return salons.map((salon) => {
    const current = index.get(`${metricCode}|${currentYear}|${salon.salonNumber}`) ?? null;
    const baseline = index.get(`${metricCode}|${baselineYear}|${salon.salonNumber}`) ?? null;

    // The source's own figure first.
    const reported = index.get(`${changeCode}|${baselineYear}|${salon.salonNumber}`);
    let change: number | null = null;
    let changeSource: ChangeSource = "unavailable";

    if (reported !== undefined) {
      change = reported;
      changeSource = "reported";
    } else if (current !== null && baseline !== null && baseline !== 0) {
      change = (current - baseline) / baseline;
      changeSource = "derived";
    }

    return {
      salonNumber: salon.salonNumber,
      storeName: salon.storeName,
      current,
      baseline,
      change,
      changeSource,
      revenueRank: salon.revenueRank,
      quintileGroup: salon.quintileGroup,
      districtLabel: salon.districtLabel,
      regionLabel: salon.regionLabel,
    };
  });
}

export type RankingSortField = "value" | "change" | "salon";

/**
 * Orders rows for display.
 *
 * Rows with no value always sink to the bottom whatever the direction, so an
 * ascending sort does not open with a column of blanks.
 */
export function sortSalonRows(
  rows: SalonRankingRow[],
  field: RankingSortField,
  direction: "asc" | "desc",
): SalonRankingRow[] {
  const sign = direction === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (field === "salon") return a.salonNumber.localeCompare(b.salonNumber) * sign;
    const left = field === "value" ? a.current : a.change;
    const right = field === "value" ? b.current : b.change;
    if (left === null && right === null) return a.salonNumber.localeCompare(b.salonNumber);
    if (left === null) return 1;
    if (right === null) return -1;
    if (left === right) return a.salonNumber.localeCompare(b.salonNumber);
    return (left - right) * sign;
  });
}

export interface Movers {
  /** Largest increases against the baseline, strongest first. */
  gainers: SalonRankingRow[];
  /** Largest decreases, steepest first. */
  decliners: SalonRankingRow[];
  /** True when the selected measure supports a comparison at all. */
  comparable: boolean;
  /** How the changes were obtained, for the caption. */
  changeSource: ChangeSource;
}

/**
 * Splits rows into the strongest and weakest movements against the baseline.
 *
 * Deliberately NOT described as sentiment. Whether an increase is good depends
 * on `higher_is_better`, which the caller carries and which may be null; this
 * function only reports magnitude and direction.
 */
export function buildMovers(rows: SalonRankingRow[], limit = 5): Movers {
  const comparable = rows.filter((row) => row.change !== null);
  if (comparable.length === 0) {
    return { gainers: [], decliners: [], comparable: false, changeSource: "unavailable" };
  }

  const ordered = [...comparable].sort((a, b) => (b.change ?? 0) - (a.change ?? 0));
  const gainers = ordered.filter((row) => (row.change ?? 0) > 0).slice(0, limit);
  const decliners = ordered
    .filter((row) => (row.change ?? 0) < 0)
    .reverse()
    .slice(0, limit);

  // If any change came from the source, say reported: it is the weaker claim.
  const changeSource: ChangeSource = comparable.some((row) => row.changeSource === "reported")
    ? "reported"
    : "derived";

  return { gainers, decliners, comparable: true, changeSource };
}

/** Rows that actually hold a value for the selected measure, for chart plotting. */
export function plottableRows(rows: SalonRankingRow[]): SalonRankingRow[] {
  return rows.filter((row) => row.current !== null);
}

/** True when at least one salon has a baseline figure to compare against. */
export function hasBaseline(rows: SalonRankingRow[]): boolean {
  return rows.some((row) => row.baseline !== null);
}

/** Converts repository fact rows into the shape the builders expect. */
export function toFactRows(values: SalonMetricValue[], metricCode: string): FactRow[] {
  return values.map((value) => ({
    salonNumber: value.salonNumber,
    storeName: value.storeName,
    metricCode,
    basisYear: value.basisYear,
    value: value.value,
    sourceSheet: value.sourceSheet,
    sourceColumn: value.sourceColumn,
  }));
}
