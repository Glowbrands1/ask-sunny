import type { ReportMetricUnit } from "../types";
import type { ChangeSource, FactRow } from "./dashboard";
import type { MetricDescriptor, SalonPeriodDescriptors } from "./types";
import {
  windowAvailableFor,
  windowMetricCodes,
  type PerformanceWindow,
  type PerformanceWindowKind,
} from "./windows";

/**
 * ONE SALON'S VIEW MODEL.
 *
 * Pure functions over the fact rows the repository fetched for a single salon.
 * The dashboard's builders aggregate ACROSS salons; these read one salon's own
 * figures, which changes what is honest in three specific ways:
 *
 *   NOTHING IS AGGREGATED, so no aggregation can be refused. A single salon's
 *   Total Revenue is the figure the source reported for it — not a sum, not a
 *   median — so the unit policies that govern the KPI row (a percentage may not
 *   be summed, a rank may not be aggregated at all) simply do not apply here.
 *   That makes percentages, ratios and the reported rank displayable on this
 *   page in a way they are not on the dashboard.
 *
 *   A MISSING FIGURE IS STILL NEVER ZERO. The dashboard can lose a salon from
 *   an average and carry on; here the absence IS the answer, so every value is
 *   `number | null` and every null carries the reason it is null. `Unavailable`
 *   is a result, not an error state.
 *
 *   LINEAGE TRAVELS WITH THE FIGURE. Each value keeps the sheet and column it
 *   came from, because on this page a manager can reasonably ask "where did
 *   this number come from" about one number rather than about the report. The
 *   dashboard's aggregates cannot answer that — they span columns — so the
 *   question is answerable here and only here.
 *
 * WHAT IS NOT DONE, each for the same reason it is not done on the dashboard:
 * no rank or quintile is recomputed (both are reported chain-wide upstream); no
 * comparison is derived where the source states one; no figure from one sheet
 * is shown under another sheet's comparison; and no sequence of windows is
 * presented as a trend, because a trailing window is one number the source
 * calculated, not a path between stored periods.
 */

/** A single reported figure, with where it came from. */
export interface SalonFigure {
  /** The exact metric code the value was read from, windowed codes included. */
  metricCode: string;
  basisYear: number | null;
  value: number | null;
  /** Null when there is no fact, because there is then no column to name. */
  sourceSheet: string | null;
  sourceColumn: string | null;
}

/** A measure on this salon's page, resolved for the selected comparison. */
export interface SalonKpi {
  /** The BASE measure code a manager recognises, e.g. `total_revenue`. */
  metricCode: string;
  label: string;
  unit: ReportMetricUnit;
  /** Null where the business has not defined a direction. Never coloured. */
  higherIsBetter: boolean | null;
  current: SalonFigure;
  /** Null when the selected comparison has no second figure for this measure. */
  baseline: SalonFigure | null;
  change: {
    value: number | null;
    source: ChangeSource;
    /** User-facing, and says which of the two it is. */
    note: string;
  };
  currentLabel: string;
  baselineLabel: string | null;
  /**
   * False when the source does not report this measure for this comparison.
   *
   * The tile then says so in words rather than falling back to another window
   * or another measure: a figure under the wrong heading is worse than a gap.
   */
  supported: boolean;
  /** Set when `current.value` is null. What the tile shows instead of a number. */
  unavailableReason: string | null;
}

/**
 * Every figure the source reports for this salon, one row per fact.
 *
 * Deliberately built from the FACTS rather than from the catalogue: a row
 * exists because a value exists. Listing the catalogue instead would produce a
 * table of "Unavailable" for every measure the sheet defines but this salon was
 * not reported for, which reads as a data failure rather than as the report's
 * actual shape.
 */
export interface SalonMetricRow {
  metricCode: string;
  label: string;
  family: string;
  unit: ReportMetricUnit;
  basisYear: number | null;
  value: number;
  sourceSheet: string;
  sourceColumn: string;
  /** For a `% change` metric, the code it is a change in. Null otherwise. */
  comparisonOfCode: string | null;
  description: string;
}

/** One measure compared across one of the report's comparison windows. */
export interface SalonWindowComparison {
  windowId: string;
  windowLabel: string;
  windowShortLabel: string;
  kind: PerformanceWindowKind;
  /** Which workbook sheet this window's figures come from. */
  sourceSheet: string;
  current: SalonFigure;
  baseline: SalonFigure | null;
  change: number | null;
  changeSource: ChangeSource;
  currentLabel: string;
  baselineLabel: string | null;
  /** False when the source does not report this measure for this window. */
  supported: boolean;
}

/** Indexes one salon's facts by `metricCode|basisYear`. */
function indexFigures(facts: FactRow[]): Map<string, FactRow> {
  const index = new Map<string, FactRow>();
  for (const fact of facts) {
    index.set(`${fact.metricCode}|${fact.basisYear ?? "none"}`, fact);
  }
  return index;
}

/** Reads one figure, keeping its lineage, or an explicit absence. */
function figureFor(
  index: Map<string, FactRow>,
  metricCode: string,
  basisYear: number | null,
): SalonFigure {
  const fact = index.get(`${metricCode}|${basisYear ?? "none"}`);
  return {
    metricCode,
    basisYear,
    value: fact?.value ?? null,
    sourceSheet: fact?.sourceSheet ?? null,
    sourceColumn: fact?.sourceColumn ?? null,
  };
}

/**
 * Resolves one measure for one salon under one comparison window.
 *
 * The change follows the dashboard's rule exactly, and for the same reason: a
 * change the SOURCE reported beats one derived here, because the source
 * sometimes computes against figures this copy does not contain. Where no
 * reported change exists and both figures do, the derived one is labelled as
 * derived so the two are never confused.
 */
function resolveMeasure(input: {
  metric: MetricDescriptor;
  index: Map<string, FactRow>;
  window: PerformanceWindow;
  currentYear: number;
  supported: boolean;
}): Omit<SalonKpi, "metricCode" | "label" | "unit" | "higherIsBetter"> {
  const { metric, index, window, currentYear, supported } = input;
  const codes = windowMetricCodes(metric.code, window, currentYear);

  const current = figureFor(index, codes.currentCode, codes.currentBasisYear);
  const baselineFigure = codes.baselineCode
    ? figureFor(index, codes.baselineCode, codes.baselineBasisYear)
    : null;
  // Absent, not zero. No baseline figure means no baseline side at all.
  const baseline = baselineFigure?.value === null ? null : baselineFigure;

  const reported = codes.changeCode
    ? figureFor(index, codes.changeCode, codes.changeBasisYear).value
    : null;

  let change: SalonKpi["change"];
  if (window.kind === "current") {
    change = {
      value: null,
      source: "unavailable",
      note: "No comparison window is selected.",
    };
  } else if (reported !== null) {
    change = {
      value: reported,
      source: "reported",
      note: "As reported by the source for this salon.",
    };
  } else if (
    current.value !== null &&
    baseline !== null &&
    baseline.value !== null &&
    baseline.value !== 0
  ) {
    change = {
      value: (current.value - baseline.value) / baseline.value,
      source: "derived",
      note: `Computed from this salon's ${codes.currentLabel} and ${codes.baselineLabel} figures.`,
    };
  } else {
    change = {
      value: null,
      source: "unavailable",
      note: supported
        ? `No ${codes.baselineLabel ?? window.shortLabel} figure is reported for this salon, so no comparison is available.`
        : `The source report does not carry ${metric.label} for ${window.label}.`,
    };
  }

  return {
    current,
    baseline,
    change,
    currentLabel: codes.currentLabel,
    baselineLabel: codes.baselineLabel,
    supported,
    unavailableReason:
      current.value !== null
        ? null
        : supported
          ? `This salon has no ${codes.currentLabel} figure for ${metric.label} in this report.`
          : `The source report does not carry ${metric.label} for ${window.label}.`,
  };
}

/**
 * The headline measures for one salon under the selected comparison.
 *
 * A measure with no definition is SKIPPED rather than rendered from its code:
 * a tile headed `unique_tanners` is a leaked identifier, and a tile headed with
 * a guessed label is worse.
 */
export function buildSalonKpis(input: {
  metricCodes: readonly string[];
  catalogue: MetricDescriptor[];
  facts: FactRow[];
  window: PerformanceWindow;
  currentYear: number;
}): SalonKpi[] {
  const { metricCodes, catalogue, facts, window, currentYear } = input;
  const index = indexFigures(facts);
  const kpis: SalonKpi[] = [];

  for (const code of metricCodes) {
    const metric = catalogue.find((entry) => entry.code === code);
    if (!metric) continue;

    kpis.push({
      metricCode: code,
      label: metric.label,
      unit: metric.unit,
      higherIsBetter: metric.higherIsBetter,
      ...resolveMeasure({
        metric,
        index,
        window,
        currentYear,
        supported: windowAvailableFor(catalogue, code, window, currentYear),
      }),
    });
  }

  return kpis;
}

/**
 * Every figure the source reports for this salon, ordered for reading.
 *
 * Grouped by family and then by label so related measures sit together, with
 * the current basis year ahead of its comparisons — the order a manager reads
 * in, rather than the order the database returned.
 */
export function buildSalonMetricRows(input: {
  catalogue: MetricDescriptor[];
  facts: FactRow[];
  currentYear: number;
}): SalonMetricRow[] {
  const { catalogue, facts, currentYear } = input;
  const byCode = new Map(catalogue.map((metric) => [metric.code, metric]));

  return facts
    .flatMap((fact) => {
      const metric = byCode.get(fact.metricCode);
      // No definition means no approved label, unit or description — so there
      // is no honest way to render the row. Omitted rather than guessed at.
      if (!metric) return [];
      return [
        {
          metricCode: fact.metricCode,
          label: metric.label,
          family: metric.family,
          unit: metric.unit,
          basisYear: fact.basisYear,
          value: fact.value,
          sourceSheet: fact.sourceSheet,
          sourceColumn: fact.sourceColumn,
          comparisonOfCode: metric.comparisonOfCode,
          description: metric.description,
        } satisfies SalonMetricRow,
      ];
    })
    .sort((a, b) => {
      if (a.family !== b.family) return a.family.localeCompare(b.family);
      if (a.label !== b.label) return a.label.localeCompare(b.label);
      // The current year first, then older comparisons, then unbasis'd rows.
      const rank = (year: number | null) =>
        year === null ? 2 : year === currentYear ? 0 : 1;
      if (rank(a.basisYear) !== rank(b.basisYear)) return rank(a.basisYear) - rank(b.basisYear);
      return (b.basisYear ?? 0) - (a.basisYear ?? 0);
    });
}

/**
 * One measure across every comparison the report offers for this period.
 *
 * THIS IS THE ONE PLACE THAT READS ACROSS SHEETS, and it is safe for one
 * reason: each window names its own sheet, and each row is fetched with that
 * window's codes and labelled with that window's heading. `vs 2024` shows the
 * year-comparison sheet's figures; `Last 3 Months` shows the rolling sheet's.
 * Neither ever appears under the other's label.
 *
 * It reads across sheets and never across PERIODS: the windows passed in are
 * discovered from one period's catalogue, so a month-to-date period offers only
 * month-to-date comparisons and a year-to-date period only year-to-date ones.
 * There is no code path here that could put an MTD figure beside a YTD one.
 *
 * NOT A TREND. Four trailing windows side by side look like four points in
 * time and are not: each is a single figure the source computed over its own
 * span, and the spans overlap. The caller says so where it is drawn.
 */
export function buildSalonWindowComparisons(input: {
  metricCode: string;
  /** Every window the period offers. Each carries its own sheet. */
  windows: PerformanceWindow[];
  /** The full period catalogue, so each window is judged on its own sheet. */
  catalogue: MetricDescriptor[];
  /** This salon's facts across every sheet in the period. */
  facts: FactRow[];
  currentYear: number;
}): SalonWindowComparison[] {
  const { metricCode, windows, catalogue, facts, currentYear } = input;

  return windows.map((window) => {
    /*
     * Judged and read on the WINDOW'S OWN SHEET.
     *
     * Both month-to-date sheets describe the same period and carry
     * same-named codes, so an unscoped lookup would let the rolling sheet's
     * `total_revenue_last_3m` satisfy a year comparison, or the
     * year-comparison sheet's figures appear under `Last 3 Months`. Scoping
     * both the availability check and the fact lookup to the sheet the window
     * came from is what makes this section trustworthy.
     */
    const sheetCatalogue = catalogue.filter(
      (metric) => metric.sourceSheet === window.sourceSheet,
    );
    const sheetFacts = facts.filter((fact) => fact.sourceSheet === window.sourceSheet);
    const index = indexFigures(sheetFacts);
    const codes = windowMetricCodes(metricCode, window, currentYear);

    const current = figureFor(index, codes.currentCode, codes.currentBasisYear);
    const baselineFigure = codes.baselineCode
      ? figureFor(index, codes.baselineCode, codes.baselineBasisYear)
      : null;
    const baseline = baselineFigure?.value === null ? null : baselineFigure;

    const reported = codes.changeCode
      ? figureFor(index, codes.changeCode, codes.changeBasisYear).value
      : null;

    let change: number | null = null;
    let changeSource: ChangeSource = "unavailable";
    if (reported !== null) {
      change = reported;
      changeSource = "reported";
    } else if (
      current.value !== null &&
      baseline !== null &&
      baseline.value !== null &&
      baseline.value !== 0
    ) {
      change = (current.value - baseline.value) / baseline.value;
      changeSource = "derived";
    }

    return {
      windowId: window.id,
      windowLabel: window.label,
      windowShortLabel: window.shortLabel,
      kind: window.kind,
      sourceSheet: window.sourceSheet,
      current,
      baseline,
      change,
      changeSource,
      currentLabel: codes.currentLabel,
      baselineLabel: codes.baselineLabel,
      supported: windowAvailableFor(sheetCatalogue, metricCode, window, currentYear),
    };
  });
}

/** Comparisons with something to show. Keeps an empty section from rendering. */
export function reportedComparisons(
  comparisons: SalonWindowComparison[],
): SalonWindowComparison[] {
  return comparisons.filter(
    (comparison) => comparison.supported && comparison.current.value !== null,
  );
}

/**
 * The descriptors worth printing above the figures, in reading order.
 *
 * Every one is OPTIONAL in the source, so each is dropped when it was not
 * reported rather than printed as an empty field or a dash — a header of
 * half-empty labels tells a manager nothing and implies the data is broken.
 *
 * District and region hold MANAGER NAMES in this source, which is descriptive
 * history rather than an identity claim; the labels say "district" because that
 * is the column, and the caller does not present them as people.
 */
export function salonDescriptorEntries(
  salon: SalonPeriodDescriptors,
): { label: string; value: string }[] {
  const entries: { label: string; value: string }[] = [];
  const push = (label: string, value: string | null | undefined) => {
    if (value !== null && value !== undefined && String(value).trim() !== "") {
      entries.push({ label, value: String(value) });
    }
  };

  push("District", salon.districtLabel);
  push("Region", salon.regionLabel);
  push("Ownership group", salon.ownershipGroup);
  push("DMA", salon.dma);
  push("Company", salon.company);
  push("Pricing plan", salon.pricingPlan);

  return entries;
}
