import type { ReportMetricUnit } from "../types";
import type { AggregationKind, MetricAggregate } from "./types";

/**
 * WHAT MAY BE DONE TO A NUMBER, BY UNIT.
 *
 * One table, consulted by every tile and chart, because the alternative is each
 * component deciding for itself and one of them eventually summing a
 * percentage.
 *
 * The approved rules, and why each is what it is:
 *
 *   currency / count / hours — SUM is valid arithmetic. It is still not a
 *     company total: see `companyWide` on MetricAggregate.
 *   percent — NEVER summed, and never averaged across salons either. A mean of
 *     per-salon percentage changes weights a tiny salon equally with a large
 *     one and produces a number that matches no salon and no total. The median
 *     is reported instead, as a description of the distribution.
 *   ratio — same reasoning. A mean of per-unit averages is not the per-unit
 *     average of the whole.
 *   rank — reported by the source against the entire chain. Aggregating or
 *     recomputing it from 15 salons would silently disagree with the source.
 *   years — a mean age is meaningful, a sum of ages is not.
 */

export interface UnitPolicy {
  allowed: readonly AggregationKind[];
  /** What a KPI tile shows by default. Null when no single figure is honest. */
  preferred: AggregationKind | null;
  /** Shown in place of a number when an aggregation is refused. */
  refusalNote: string;
}

const SUMMABLE: UnitPolicy = {
  allowed: ["sum", "mean", "median", "min", "max", "count"],
  preferred: "sum",
  refusalNote: "",
};

const DISTRIBUTION_ONLY: UnitPolicy = {
  allowed: ["median", "min", "max", "count"],
  preferred: "median",
  refusalNote:
    "This measure cannot be summed, and averaging it across salons would weight every salon equally. The median is shown instead.",
};

export const UNIT_POLICIES: Record<ReportMetricUnit, UnitPolicy> = {
  currency: SUMMABLE,
  count: SUMMABLE,
  hours: SUMMABLE,
  percent: DISTRIBUTION_ONLY,
  ratio: DISTRIBUTION_ONLY,
  years: {
    allowed: ["mean", "median", "min", "max", "count"],
    preferred: "mean",
    refusalNote: "Durations can be averaged but not summed.",
  },
  rank: {
    allowed: ["count"],
    preferred: null,
    refusalNote:
      "Ranks are reported by the source against the whole chain. They are never recomputed or aggregated from the salons in this report.",
  },
};

export function unitPolicy(unit: ReportMetricUnit): UnitPolicy {
  return UNIT_POLICIES[unit];
}

export function canAggregate(unit: ReportMetricUnit, kind: AggregationKind): boolean {
  return UNIT_POLICIES[unit].allowed.includes(kind);
}

/** True only for units where addition is meaningful. */
export function isSummable(unit: ReportMetricUnit): boolean {
  return canAggregate(unit, "sum");
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * Computes an aggregate, or refuses with a reason.
 *
 * Refusing is a first-class outcome rather than an error: a KPI tile for a
 * percentage metric is a legitimate thing to ask for, and the honest answer is
 * a median plus an explanation, not a thrown exception or a wrong sum.
 */
export function aggregate(input: {
  metricCode: string;
  basisYear: number | null;
  unit: ReportMetricUnit;
  values: number[];
  /** Distinct salons behind `values`. Required, never inferred from length. */
  salonCount: number;
  kind?: AggregationKind;
}): MetricAggregate {
  const policy = UNIT_POLICIES[input.unit];
  const kind = input.kind ?? policy.preferred;

  const base = {
    metricCode: input.metricCode,
    basisYear: input.basisYear,
    salonCount: input.salonCount,
    companyWide: false as const,
  };

  if (kind === null) {
    return {
      ...base,
      kind: "count",
      value: null,
      unavailableReason: policy.refusalNote,
    };
  }

  if (!policy.allowed.includes(kind)) {
    return { ...base, kind, value: null, unavailableReason: policy.refusalNote };
  }

  const values = input.values.filter((value) => Number.isFinite(value));
  if (values.length === 0 && kind !== "count") {
    return {
      ...base,
      kind,
      value: null,
      unavailableReason: "No values were reported for this measure.",
    };
  }

  switch (kind) {
    case "sum":
      return { ...base, kind, value: values.reduce((total, value) => total + value, 0) };
    case "mean":
      return { ...base, kind, value: values.reduce((t, v) => t + v, 0) / values.length };
    case "median":
      return { ...base, kind, value: median(values) };
    case "min":
      return { ...base, kind, value: Math.min(...values) };
    case "max":
      return { ...base, kind, value: Math.max(...values) };
    case "count":
      return { ...base, kind, value: values.length };
    default: {
      const exhaustive: never = kind;
      throw new Error(`Unhandled aggregation: ${String(exhaustive)}`);
    }
  }
}

/**
 * Formats a value for display.
 *
 * PERCENTAGES ARE STORED AS FRACTIONS — -0.0299 means -2.99% — so the ×100 has
 * to happen exactly once, here, rather than in whichever component remembers.
 */
export function formatMetricValue(
  value: number | null,
  unit: ReportMetricUnit,
  options: { compact?: boolean } = {},
): string {
  if (value === null || !Number.isFinite(value)) return "—";

  switch (unit) {
    case "currency":
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        notation: options.compact ? "compact" : "standard",
        maximumFractionDigits: options.compact ? 1 : 2,
      }).format(value);
    case "percent":
      return new Intl.NumberFormat("en-US", {
        style: "percent",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
        signDisplay: "exceptZero",
      }).format(value);
    case "count":
      return new Intl.NumberFormat("en-US", {
        notation: options.compact ? "compact" : "standard",
        maximumFractionDigits: 0,
      }).format(value);
    case "hours":
      return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value)} hrs`;
    case "years":
      return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value)} yrs`;
    case "rank":
      return `#${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value)}`;
    case "ratio":
      return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
    default: {
      const exhaustive: never = unit;
      throw new Error(`Unhandled unit: ${String(exhaustive)}`);
    }
  }
}

/**
 * Which direction is good, for colour and iconography.
 *
 * `null` means the business has not said, and a dashboard that guesses is
 * asserting something nobody agreed. Callers must render neutral.
 */
export type Sentiment = "good" | "bad" | "neutral";

export function sentimentFor(
  value: number | null,
  higherIsBetter: boolean | null,
): Sentiment {
  if (value === null || higherIsBetter === null || value === 0) return "neutral";
  const better = value > 0 ? higherIsBetter : !higherIsBetter;
  return better ? "good" : "bad";
}
