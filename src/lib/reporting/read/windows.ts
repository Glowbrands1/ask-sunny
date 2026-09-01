import type { MetricDescriptor } from "./types";

/**
 * PERFORMANCE WINDOWS — WHAT A FIGURE IS BEING COMPARED AGAINST.
 *
 * A window is not a time grain and this file exists to keep those two ideas
 * apart, because conflating them is how a dashboard ends up drawing a trend it
 * does not have.
 *
 *   A WINDOW is a comparison the SOURCE WORKBOOK computed and handed us in a
 *   column: "TY vs 2024 % Change", "Last 3 Months % Change". It is a single
 *   number per salon, already calculated upstream, describing a relationship
 *   between two periods we may never have seen.
 *
 *   A GRAIN (weekly / monthly / yearly) needs several ingested reports. We have
 *   one. Selecting "Last 12 Months" therefore reads ONE stored figure; it does
 *   not give us twelve months of history, and nothing here may be used to draw
 *   a multi-point line.
 *
 * WINDOWS ARE DISCOVERED, NOT DECLARED. `reportWindows` reads the live metric
 * catalogue: a basis-year window exists because facts carry that year, and a
 * rolling window exists because a metric code for it carries facts. Nothing is
 * hardcoded, so the day the rolling-window columns are ingested the options
 * appear with no change here, and until then they honestly do not appear.
 *
 * The rolling naming convention is mechanical, mirroring the existing
 * `<measure>_pct_change`:
 *
 *   <measure>_last_<n>m_current      the current-year figure for the window
 *   <measure>_last_<n>m_prior        the prior-year figure for the same window
 *   <measure>_last_<n>m_pct_change   the source's own signed change
 */

/** The year the report treats as current. Also exported from `./filters`. */
const CURRENT_YEAR_TOKEN = "current";

export type PerformanceWindowKind = "current" | "basis_year" | "rolling";

export interface PerformanceWindow {
  /**
   * The URL token, and the window's identity.
   *
   * `current` | a four-digit year | `last_<n>m`. A year token keeps every link
   * shared before windows existed working unchanged.
   */
  id: string;
  /** Full label, carrying any caveat the window must never be shown without. */
  label: string;
  /** Short label for a control that has little room. */
  shortLabel: string;
  kind: PerformanceWindowKind;
  /** The year being compared against. Null unless `kind` is `basis_year`. */
  basisYear: number | null;
  /** Metric-code infix, e.g. `last_3m`. Null unless `kind` is `rolling`. */
  windowKey: string | null;
  /** Months covered by a rolling window, for ordering. Null otherwise. */
  months: number | null;
  /** Wording that must travel with the window wherever it is displayed. */
  caveat: string | null;
}

/** Matches a rolling-window change metric, e.g. `total_revenue_last_3m_pct_change`. */
const ROLLING_CHANGE = /^(.+)_last_(\d{1,2})m_pct_change$/;

/** Matches a window token in a URL. */
const WINDOW_TOKEN = /^(current|\d{4}|last_\d{1,2}m)$/;

export function isWindowToken(value: string): boolean {
  return WINDOW_TOKEN.test(value);
}

/**
 * Caveats attached to a specific comparison.
 *
 * 2019 is here because its comparison population has never been confirmed: the
 * figures are real and reported, but which salons they describe is unknown, so
 * the label says so every single time the window is named.
 */
const WINDOW_CAVEATS: Record<number, string> = {
  2019: "comparison population unconfirmed",
};

export function basisYearWindow(year: number): PerformanceWindow {
  const caveat = WINDOW_CAVEATS[year] ?? null;
  return {
    id: String(year),
    label: caveat ? `${year} baseline — ${caveat}` : `vs ${year}`,
    shortLabel: `vs ${year}`,
    kind: "basis_year",
    basisYear: year,
    windowKey: null,
    months: null,
    caveat,
  };
}

export function rollingWindow(months: number): PerformanceWindow {
  const label = `Last ${months} Months`;
  return {
    id: `last_${months}m`,
    label,
    shortLabel: label,
    kind: "rolling",
    basisYear: null,
    windowKey: `last_${months}m`,
    months,
    caveat: null,
  };
}

/** The no-comparison window: the current period's own figures. */
export function currentWindow(grainLabel = "MTD"): PerformanceWindow {
  return {
    id: CURRENT_YEAR_TOKEN,
    label: `Current ${grainLabel}`,
    shortLabel: `Current ${grainLabel}`,
    kind: "current",
    basisYear: null,
    windowKey: null,
    months: null,
    caveat: null,
  };
}

/**
 * Every window this report can offer, in reading order.
 *
 * Derived from the catalogue, so the list is a description of the data rather
 * than a menu somebody has to remember to update. Ordering puts the current
 * period first, then year comparisons newest first, then rolling windows
 * shortest first — the order a manager reads them in, not the order they were
 * found.
 */
export function reportWindows(
  catalogue: MetricDescriptor[],
  options: { currentYear: number; grainLabel?: string } = { currentYear: 2026 },
): PerformanceWindow[] {
  const years = new Set<number>();
  const months = new Set<number>();

  for (const metric of catalogue) {
    for (const year of metric.availableBasisYears) {
      if (year !== options.currentYear) years.add(year);
    }
    const rolling = ROLLING_CHANGE.exec(metric.code);
    if (rolling) months.add(Number(rolling[2]));
  }

  return [
    currentWindow(options.grainLabel ?? "MTD"),
    ...[...years].sort((a, b) => b - a).map(basisYearWindow),
    ...[...months].sort((a, b) => a - b).map(rollingWindow),
  ];
}

/** Resolves a URL token against the windows the report actually offers. */
export function findWindow(
  windows: PerformanceWindow[],
  token: string | null,
): PerformanceWindow | null {
  if (!token) return null;
  return windows.find((window) => window.id === token) ?? null;
}

/**
 * The window a report opens on.
 *
 * The approved default is 2024, and it is chosen by LOOKING FOR IT rather than
 * assuming it: a report that does not carry 2024 falls back to the newest year
 * comparison it does carry, and one with no comparison at all opens on the
 * current period instead of on an option that would show nothing.
 *
 * 2019 is never a default, whatever else is missing — its population is
 * unconfirmed, so it is only ever an explicit choice.
 */
export function defaultWindow(
  windows: PerformanceWindow[],
  preferredYear = 2024,
): PerformanceWindow {
  const preferred = windows.find(
    (window) => window.kind === "basis_year" && window.basisYear === preferredYear,
  );
  if (preferred) return preferred;

  const newestYear = windows
    .filter((window) => window.kind === "basis_year" && window.caveat === null)
    .sort((a, b) => (b.basisYear ?? 0) - (a.basisYear ?? 0))[0];
  if (newestYear) return newestYear;

  return windows[0] ?? currentWindow();
}

/**
 * The metric codes a (measure, window) pair reads.
 *
 * This is the single place that decides which stored fact a chart is showing,
 * which is what makes "the graph reacts to the window" a property of the data
 * layer instead of a promise made in three components.
 */
export interface WindowMetricCodes {
  /** The figure shown as "current". */
  currentCode: string;
  currentBasisYear: number | null;
  /** The figure compared against. Null when the window has no comparison. */
  baselineCode: string | null;
  baselineBasisYear: number | null;
  /** The source's OWN signed change. Null when the source states none. */
  changeCode: string | null;
  changeBasisYear: number | null;
  /** Labels for the two sides, for axis and column headings. */
  currentLabel: string;
  baselineLabel: string | null;
}

export function windowMetricCodes(
  metricCode: string,
  window: PerformanceWindow,
  currentYear: number,
): WindowMetricCodes {
  if (window.kind === "rolling") {
    const key = window.windowKey as string;
    return {
      // Rolling figures are stored with the window in the code, so they carry
      // no basis year at all — the window IS the period.
      currentCode: `${metricCode}_${key}_current`,
      currentBasisYear: null,
      baselineCode: `${metricCode}_${key}_prior`,
      baselineBasisYear: null,
      changeCode: `${metricCode}_${key}_pct_change`,
      changeBasisYear: null,
      currentLabel: `Current year, ${window.label.toLowerCase()}`,
      baselineLabel: `Prior year, ${window.label.toLowerCase()}`,
    };
  }

  if (window.kind === "basis_year") {
    const year = window.basisYear as number;
    return {
      currentCode: metricCode,
      currentBasisYear: currentYear,
      baselineCode: metricCode,
      baselineBasisYear: year,
      changeCode: `${metricCode}_pct_change`,
      changeBasisYear: year,
      currentLabel: String(currentYear),
      baselineLabel: String(year),
    };
  }

  return {
    currentCode: metricCode,
    currentBasisYear: currentYear,
    baselineCode: null,
    baselineBasisYear: null,
    changeCode: null,
    changeBasisYear: null,
    currentLabel: String(currentYear),
    baselineLabel: null,
  };
}

/**
 * Every metric code a (measure, window) pair needs fetched.
 *
 * Used to build one query per page load rather than one per chart.
 */
export function windowMetricCodeList(
  metricCode: string,
  window: PerformanceWindow,
  currentYear: number,
): string[] {
  const codes = windowMetricCodes(metricCode, window, currentYear);
  return [...new Set([codes.currentCode, codes.baselineCode, codes.changeCode]
    .filter((code): code is string => Boolean(code)))];
}

/**
 * Whether the report holds the figures this pair needs.
 *
 * A false here is the ONLY correct reason to show "Unavailable" for a
 * combination, and it is deliberately the caller's cue to say so rather than to
 * quietly select a different measure or a different window. `Metric: EFT
 * Revenue` with `Last 3 Months` has no column in the source workbook and never
 * will unless the source adds one; showing Total Revenue's figure there instead
 * would be a fabrication that looks exactly like data.
 */
export function windowAvailableFor(
  catalogue: MetricDescriptor[],
  metricCode: string,
  window: PerformanceWindow,
  currentYear: number,
): boolean {
  const byCode = new Map(catalogue.map((metric) => [metric.code, metric]));
  const codes = windowMetricCodes(metricCode, window, currentYear);

  const holds = (code: string | null, basisYear: number | null): boolean => {
    if (!code) return true;
    const metric = byCode.get(code);
    if (!metric) return false;
    if (basisYear === null) return metric.factCount > 0;
    return metric.availableBasisYears.includes(basisYear);
  };

  // The current side must exist. A window whose comparison side is missing is
  // still selectable — the view reports the gap per salon.
  if (!holds(codes.currentCode, codes.currentBasisYear)) return false;

  if (window.kind === "current") return true;

  return (
    holds(codes.baselineCode, codes.baselineBasisYear) ||
    holds(codes.changeCode, codes.changeBasisYear)
  );
}

/** Matches any side of a rolling metric, so its base measure can be recovered. */
const ROLLING_ANY_SIDE = /^(.+)_last_(\d{1,2})m_(current|prior|pct_change)$/;

/**
 * The BASE measures a catalogue makes selectable.
 *
 * On a year-comparison sheet this is simply the metrics that are not a
 * `% change` of something else. On a rolling sheet it is nothing so direct: the
 * catalogue contains `total_revenue_last_3m_current` and its siblings, and none
 * of them is a measure a manager would choose. What they choose is Total
 * Revenue, and the WINDOW decides which of the twenty-four codes is read.
 *
 * So a rolling code contributes its STEM, and the stem is what the picker
 * offers. Without this the Metric control on the rolling view would list
 * "Total Revenue, current year last 3 months" twelve times over — every
 * combination the window selector already expresses.
 */
export function selectableMeasureCodes(catalogue: MetricDescriptor[]): string[] {
  const codes = new Set<string>();
  for (const metric of catalogue) {
    const rolling = ROLLING_ANY_SIDE.exec(metric.code);
    if (rolling) {
      codes.add(rolling[1]);
      continue;
    }
    // A `% change` metric is expressed by the window, never picked directly.
    if (metric.comparisonOfCode === null) codes.add(metric.code);
  }
  return [...codes].sort();
}

/** A window's caveat as a sentence, or null. Kept in one place so it cannot drift. */
export function windowCaveatSentence(window: PerformanceWindow): string | null {
  if (!window.caveat) return null;
  return `${window.basisYear ?? window.label} baseline — ${window.caveat}. Figures are as reported; which salons they cover has not been confirmed.`;
}
