import "server-only";

import {
  CURRENT_BASIS_YEAR,
  DEFAULT_FILTERS,
  PREFERRED_BASELINE_YEAR,
  parseReportFilters,
  type RawSearchParams,
  type ReportFilters,
} from "./filters";
import { canonicalizeReportFilters, eligibleSalons, resolveWindow } from "./canonical";
import { ReportingReadRepository } from "./reporting-read-repository";
import type {
  FilterOptions,
  MetricDescriptor,
  PeriodOption,
  ReportScope,
  SalonPeriodDescriptors,
} from "./types";
import {
  isReportViewId,
  reportingGrainOptions,
  VIEWS_BY_ID,
  type ReportingGrainOption,
} from "./views";
import {
  defaultWindowForSheet,
  reportWindows,
  selectableMeasureCodes,
  windowAvailableFor,
  type PerformanceWindow,
} from "./windows";

/**
 * ONE RESOLUTION FOR EVERY REPORTING PAGE.
 *
 * The dashboard and the salon drill-down have to agree, exactly, about which
 * period is selected, which comparison window that implies, which workbook
 * sheet that window reads, which measures that sheet offers, and which salons
 * the filters admit. Six answers, in that dependency order.
 *
 * This module exists because the alternative is two copies. The drill-down is
 * reached from the dashboard carrying the dashboard's filters in its URL, so
 * any divergence shows up as the specific bug that is hardest to see: a detail
 * page that resolves the same link to a different sheet and shows figures that
 * disagree with the row that was clicked, both pages internally consistent.
 *
 * WHAT IS HERE is only the resolution — the part that must not drift. Each page
 * still runs its own final queries, because they want different facts: the
 * dashboard wants every admitted salon's figures for one measure, the drill-down
 * wants one salon's figures across every measure. Sharing those would mean
 * fetching one page's data on the other.
 *
 * NOTHING HERE IS SCOPED WIDER THAN THE SELECTED PERIOD. Every read below takes
 * `scope.periodId`, which is what lets this hold years of reports rather than
 * one: a new period brings its own salons, districts, measures and comparisons,
 * and nothing from another period can reach either page.
 */

export interface ReportContext {
  repository: ReportingReadRepository;
  scope: ReportScope;
  /** The sanitized filter set. Everything rendered reads from this. */
  filters: ReportFilters;
  /** Values a link carried that this report does not recognise. */
  ignored: string[];
  /** Filters that were adjusted to fit the data, phrased for a manager. */
  dropped: string[];
  /** True when the incoming URL was not already canonical. */
  changed: boolean;
  /** Every comparison the period offers, each naming its own sheet. */
  windows: PerformanceWindow[];
  /** The comparison the sanitized filters resolve to. */
  activeWindow: PerformanceWindow;
  /** The workbook sheet that comparison reads. */
  activeSheet: string | null;
  /** The whole period's catalogue, across every sheet. */
  catalogue: MetricDescriptor[];
  /** Only the active sheet's entries. */
  sheetCatalogue: MetricDescriptor[];
  /** Definitions for the measures the active sheet makes selectable. */
  measures: MetricDescriptor[];
  measureCodes: string[];
  /** The one measure driving the charts and the table. */
  selectedMetric: MetricDescriptor | null;
  options: FilterOptions;
  /** Every salon in the period, unfiltered — so a menu can always widen again. */
  allSalons: SalonPeriodDescriptors[];
  /** The salons the OTHER filters admit, which is what a salon menu offers. */
  eligible: SalonPeriodDescriptors[];
  periods: PeriodOption[];
  grains: ReportingGrainOption[];
  availableGrains: string[];
  /** Per window: whether the selected measure is reported for it. */
  windowAvailability: Record<string, boolean>;
}

/**
 * Why a page cannot render, when it cannot.
 *
 * A discriminated result rather than a thrown error or a nullable context: each
 * of these is a legitimate state with its own sentence to show a manager, and
 * making them cases forces every caller to handle all of them.
 *
 * Whether the RUNTIME has Supabase configured at all is checked by each page
 * before it calls here, because that answer is about the deployment rather than
 * about the report, and a page must not build a repository it cannot use.
 */
export type ReportContextResult =
  | { status: "ready"; context: ReportContext }
  /** Nothing has been ingested at all. */
  | { status: "no_report" }
  /** A period whose facts hold none of the workbook's comparison columns. */
  | { status: "no_comparisons"; scope: ReportScope };

export async function loadReportContext(
  params: RawSearchParams,
  repository: ReportingReadRepository = new ReportingReadRepository(),
): Promise<ReportContextResult> {
  const { filters, ignored } = parseReportFilters(params);

  const scope = await repository.getScope(filters.periodEnd, filters.periodGrain);
  if (!scope) return { status: "no_report" };

  /*
   * The catalogue is deliberately UNSCOPED here. It is the input to window
   * discovery, and windows are what choose the sheet — reading a sheet-scoped
   * catalogue first would mean knowing the sheet before the thing that decides
   * it.
   */
  const [options, catalogue, allSalons, periods] = await Promise.all([
    repository.getFilterOptions(scope.periodId),
    repository.getMetricCatalogue(scope.periodId),
    repository.listSalons(scope.periodId, DEFAULT_FILTERS),
    repository.listPeriods(),
  ]);

  /*
   * Reporting history, which is NOT the performance window. Weekly / Monthly /
   * Yearly need several ingested periods; a window is one figure the source
   * computed inside a single report.
   */
  const grains = reportingGrainOptions(periods);
  const availableGrains = grains.filter((grain) => grain.available).map((grain) => grain.id);

  const windows = reportWindows(catalogue, {
    currentYear: CURRENT_BASIS_YEAR,
    grainLabel: scope.grain.toUpperCase(),
  });

  /*
   * A link from when the dashboard DID ask for a sheet. `?view=mtd_rolling` is
   * translated to that sheet's own default comparison rather than dropped, so
   * an old bookmark lands where its author meant.
   */
  const retiredViewSheet =
    filters.view !== null && isReportViewId(filters.view)
      ? (VIEWS_BY_ID.get(filters.view)?.sourceSheet ?? null)
      : null;
  const namedWindow = windows.find((window) => window.id === filters.window) ?? null;
  const requested: ReportFilters =
    retiredViewSheet && namedWindow?.sourceSheet !== retiredViewSheet
      ? {
          ...filters,
          window:
            defaultWindowForSheet(windows, retiredViewSheet, PREFERRED_BASELINE_YEAR)?.id ??
            filters.window,
        }
      : filters;

  const provisionalWindow = resolveWindow(windows, requested.window, PREFERRED_BASELINE_YEAR);
  const activeSheet = provisionalWindow?.sourceSheet ?? null;

  /*
   * Selectable measures are the BASE ones the CHOSEN SHEET offers. The
   * definitions are fetched separately because a rolling sheet holds no
   * `total_revenue` facts of its own, so its base measure has no catalogue row
   * there; its label and unit come from the reviewed vocabulary instead of
   * being reconstructed from a rolling metric's label.
   */
  const sheetCatalogue = activeSheet
    ? catalogue.filter((metric) => metric.sourceSheet === activeSheet)
    : catalogue;
  const measureCodes = selectableMeasureCodes(sheetCatalogue);
  const fromCatalogue = sheetCatalogue.filter((metric) => measureCodes.includes(metric.code));
  const missingDefinitions = measureCodes.filter(
    (code) => !fromCatalogue.some((metric) => metric.code === code),
  );
  const measures = [
    ...fromCatalogue,
    ...(await repository.getMetricDefinitions(missingDefinitions)),
  ].sort((a, b) => a.family.localeCompare(b.family) || a.code.localeCompare(b.code));

  /*
   * ONE SANITIZING PASS OVER THE WHOLE FILTER SET, not per control. Resolving
   * each independently is what let a valid window, a valid measure and a valid
   * district add up to a combination the report cannot answer.
   */
  const canonical = canonicalizeReportFilters(
    {
      filters: requested,
      windows,
      selectableMetricCodes: measureCodes,
      facetOptions: options,
      salons: allSalons,
      periods: periods.map((period) => ({ grain: period.grain, periodEnd: period.periodEnd })),
      availableGrains,
    },
    { preferredYear: PREFERRED_BASELINE_YEAR },
  );

  const active = canonical.filters;
  const activeWindow = canonical.window ?? provisionalWindow;
  if (!activeWindow) return { status: "no_comparisons", scope };

  const selectedMetric =
    measures.find((metric) => metric.code === active.metricCodes[0]) ?? measures[0] ?? null;

  const windowAvailability = Object.fromEntries(
    windows.map((window) => [
      window.id,
      selectedMetric
        ? windowAvailableFor(
            // Availability is judged against the window's OWN sheet, not the
            // one on screen.
            catalogue.filter((metric) => metric.sourceSheet === window.sourceSheet),
            selectedMetric.code,
            window,
            CURRENT_BASIS_YEAR,
          )
        : false,
    ]),
  );

  return {
    status: "ready",
    context: {
      repository,
      scope,
      filters: active,
      ignored,
      dropped: canonical.dropped,
      changed: canonical.changed,
      windows,
      activeWindow,
      activeSheet,
      catalogue,
      sheetCatalogue,
      measures,
      measureCodes,
      selectedMetric,
      options,
      allSalons,
      eligible: eligibleSalons(allSalons, active),
      periods,
      grains,
      availableGrains,
      windowAvailability,
    },
  };
}
