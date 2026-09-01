import type { MetricDescriptor } from "./types";
import { REPORT_VIEWS } from "./views";

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
 *
 * A WINDOW ALSO NAMES ITS SHEET, and that is what makes it the only control a
 * manager needs. Each comparison exists in exactly one part of the workbook:
 * `vs 2024` and `vs 2019` are columns of the year-comparison sheet, the
 * trailing windows are columns of the rolling sheet. Choosing the comparison
 * therefore chooses the sheet, so there is no second control asking a manager
 * which spreadsheet tab their question lives on — a question they have no way
 * to answer and no reason to be asked.
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
  /**
   * The workbook sheet this comparison is a column of.
   *
   * Selecting the window selects the sheet. Never shown on the dashboard — a
   * manager should not need to know a tab name — but carried so the read layer
   * can scope every query to it and the source & quality panel can name it.
   */
  sourceSheet: string;
}

/** Matches a rolling-window change metric, e.g. `total_revenue_last_3m_pct_change`. */
const ROLLING_CHANGE = /^(.+)_last_(\d{1,2})m_pct_change$/;

/** Matches any side of a rolling metric, so its base measure can be recovered. */
const ROLLING_ANY_SIDE = /^(.+)_last_(\d{1,2})m_(current|prior|pct_change)$/;

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

export function basisYearWindow(year: number, sourceSheet = ""): PerformanceWindow {
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
    sourceSheet,
  };
}

export function rollingWindow(months: number, sourceSheet = ""): PerformanceWindow {
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
    sourceSheet,
  };
}

/** The no-comparison window: the current period's own figures. */
export function currentWindow(grainLabel = "MTD", sourceSheet = ""): PerformanceWindow {
  return {
    id: CURRENT_YEAR_TOKEN,
    label: `Current ${grainLabel}`,
    shortLabel: `Current ${grainLabel}`,
    kind: "current",
    basisYear: null,
    windowKey: null,
    months: null,
    caveat: null,
    sourceSheet,
  };
}

/**
 * The order sheets are considered in, for the rare case two of them could
 * offer the same comparison.
 *
 * Taken from the declared view order rather than invented here, so there is one
 * place that says what reading order means. A sheet nobody declared sorts last,
 * by name — deterministic, which is the only property that matters.
 */
function sheetRank(sheet: string): number {
  const index = REPORT_VIEWS.findIndex((view) => view.sourceSheet === sheet);
  return index === -1 ? REPORT_VIEWS.length : index;
}

/**
 * Every window this report can offer, in reading order.
 *
 * DISCOVERED PER SHEET, then merged. Both month-to-date sheets describe the
 * same period, so a single pass over the whole catalogue would produce a set of
 * windows with no idea which part of the workbook each came from — and the
 * dashboard would then have to ask the manager. Grouping first means every
 * window knows its own sheet, and the sheet stops being a question.
 *
 * A year comparison exists because facts carry that year. A rolling window
 * exists because a metric code for it carries facts. The CURRENT window exists
 * only where a sheet holds an uncompared figure for the current year — the
 * rolling sheet does not, and that omission is the whole fix for a dashboard
 * that used to offer `Current MTD` on a sheet whose every column is a
 * comparison, then correctly reported it as unavailable.
 *
 * Ordering puts the current period first, then year comparisons newest first,
 * then rolling windows shortest first: the order a manager reads them in, not
 * the order they were found.
 */
export function reportWindows(
  catalogue: MetricDescriptor[],
  options: { currentYear: number; grainLabel?: string } = { currentYear: 2026 },
): PerformanceWindow[] {
  const sheets = [...new Set(catalogue.map((metric) => metric.sourceSheet))].sort(
    (a, b) => sheetRank(a) - sheetRank(b) || a.localeCompare(b),
  );

  const grainLabel = options.grainLabel ?? "MTD";
  const current: PerformanceWindow[] = [];
  const years: PerformanceWindow[] = [];
  const rolling: PerformanceWindow[] = [];

  for (const sheet of sheets) {
    const metrics = catalogue.filter((metric) => metric.sourceSheet === sheet);
    const sheetYears = new Set<number>();
    const sheetMonths = new Set<number>();
    let hasCurrent = false;

    for (const metric of metrics) {
      const isRolling = ROLLING_ANY_SIDE.test(metric.code);
      for (const year of metric.availableBasisYears) {
        if (year === options.currentYear) {
          // A `% change` metric carrying the current year would not make the
          // current period selectable on its own: the window shows a figure,
          // and a change is not one.
          if (!isRolling && metric.comparisonOfCode === null) hasCurrent = true;
        } else {
          sheetYears.add(year);
        }
      }
      const match = ROLLING_CHANGE.exec(metric.code);
      if (match) sheetMonths.add(Number(match[2]));
    }

    if (hasCurrent) current.push(currentWindow(grainLabel, sheet));
    for (const year of sheetYears) years.push(basisYearWindow(year, sheet));
    for (const months of sheetMonths) rolling.push(rollingWindow(months, sheet));
  }

  const merged = [
    ...current,
    ...years.sort((a, b) => (b.basisYear ?? 0) - (a.basisYear ?? 0)),
    ...rolling.sort((a, b) => (a.months ?? 0) - (b.months ?? 0)),
  ];

  // One entry per window. Sheets were walked in reading order, so where two
  // could offer the same comparison the earlier sheet wins — deterministically,
  // rather than depending on which was ingested first.
  const byId = new Map<string, PerformanceWindow>();
  for (const window of merged) {
    if (!byId.has(window.id)) byId.set(window.id, window);
  }
  return [...byId.values()];
}

/** The windows belonging to one sheet, preserving reading order. */
export function windowsForSheet(
  windows: PerformanceWindow[],
  sourceSheet: string,
): PerformanceWindow[] {
  return windows.filter((window) => window.sourceSheet === sourceSheet);
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
 * assuming it. The fallback order below is the fix for a specific reported bug:
 * on a sheet holding only trailing windows, the old version found no 2024, no
 * other year, and fell through to `windows[0]` — which was unconditionally
 * `Current MTD`, a comparison that sheet does not carry. The dashboard then
 * opened on a window guaranteed to read "Unavailable".
 *
 * So a set with no year comparison now prefers the SHORTEST TRAILING WINDOW,
 * which is a comparison such a sheet does carry, and only then anything at all.
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

  const shortestRolling = windows
    .filter((window) => window.kind === "rolling")
    .sort((a, b) => (a.months ?? 0) - (b.months ?? 0))[0];
  if (shortestRolling) return shortestRolling;

  return windows[0] ?? currentWindow();
}

/**
 * The window a sheet opens on.
 *
 * Used to translate a link that named a workbook sheet — from when the
 * dashboard asked managers to pick one — into the comparison that sheet
 * actually offers. `?view=mtd_rolling` becomes `Last 3 Months` rather than
 * resolving to a year comparison that sheet has never held.
 */
export function defaultWindowForSheet(
  windows: PerformanceWindow[],
  sourceSheet: string,
  preferredYear = 2024,
): PerformanceWindow | null {
  const scoped = windowsForSheet(windows, sourceSheet);
  if (scoped.length === 0) return null;
  return defaultWindow(scoped, preferredYear);
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
