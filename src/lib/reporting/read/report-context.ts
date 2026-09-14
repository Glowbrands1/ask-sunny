import "server-only";

import {
  DEFAULT_FILTERS,
  PREFERRED_BASELINE_YEAR,
  parseReportFilters,
  type RawSearchParams,
  type ReportFilters,
} from "./filters";
import { canonicalizeReportFilters, eligibleSalons, resolveWindow } from "./canonical";
import {
  narrowSalonSelection,
  reportingScopeOf,
  type ReportingScope,
} from "../scope/authorized-salons";
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
  currentBasisYear,
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
  /**
   * The year THIS period files its current figures under.
   *
   * On the context rather than imported as a constant by each caller, so the
   * dashboard, the drill-down and the chat briefing cannot disagree about it.
   * See `currentBasisYear` in `./windows` for why it is derived.
   */
  currentYear: number;
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
  | { status: "no_comparisons"; scope: ReportScope }
  /**
   * The caller's assignment resolves to no salon, so there is nothing they may
   * be shown. DISTINCT FROM `no_report`: the data exists and this person is not
   * entitled to it, which is a different sentence and a different fix.
   */
  | { status: "out_of_scope" };

export async function loadReportContext(
  params: RawSearchParams,
  repository: ReportingReadRepository = new ReportingReadRepository(),
  /**
   * ============================================================================
   * THE CALLER'S AUTHORIZED SALONS, APPLIED BEFORE ANY ROW IS READ
   * ============================================================================
   *
   * THE DEFECT THIS CLOSES. The 14 September review put a restricted account
   * scoped to one salon beside an administrator's session and found Salon
   * Performance "identical line for line" — every salon's revenue, chain rank,
   * quintile and director. The scope existed on the identity and this resolver
   * never asked for it.
   *
   * IT IS A PARAMETER RATHER THAN A LOOKUP INSIDE THIS FUNCTION, for the same
   * reason `user-directory.ts` takes its actor as an argument: a resolver that
   * could look up its own caller could be called with nobody in mind, and the
   * page that renders the result is the thing that knows whose request it is.
   * The default is the unrestricted scope, which is what an ingestion job or a
   * test wants; every PAGE passes a real one.
   *
   * IT NARROWS `filters.salonNumbers` BEFORE CANONICALIZATION, so every
   * downstream read — the salon list, the fact query, the facet menus, the
   * eligible population — is already inside the boundary. Narrowing after the
   * queries would mean the refused rows had already been fetched, which is a
   * filter rather than a boundary.
   */
  scope: ReportingScope = reportingScopeOf(null),
): Promise<ReportContextResult> {
  const parsed = parseReportFilters(params);
  const ignored = parsed.ignored;

  /*
   * THE INTERSECTION, NEVER THE UNION. A URL naming salons outside the
   * allowlist keeps only the ones inside it; a URL naming none is narrowed to
   * the whole allowlist. Asking for a salon you may not see yields nothing, not
   * everything — which is what stops the boundary being reachable by editing a
   * query string.
   */
  const filters: ReportFilters = scope.unrestricted
    ? parsed.filters
    : {
        ...parsed.filters,
        salonNumbers: narrowSalonSelection(scope, parsed.filters.salonNumbers),
      };

  /*
   * A RESTRICTED CALLER WHOSE ALLOWLIST IS EMPTY SEES NO FIGURES, and is told
   * why. Returning early rather than running the queries with an empty `in ()`
   * keeps the two states — "no salon assigned" and "no report ingested" —
   * distinguishable, because they need different sentences and different fixes.
   */
  if (!scope.unrestricted && scope.salonNumbers.length === 0) {
    return { status: "out_of_scope" };
  }

  /* The REPORT's period scope. Named apart from the caller's access scope. */
  const reportScope = await repository.getScope(filters.periodEnd, filters.periodGrain);
  if (!reportScope) return { status: "no_report" };

  /*
   * The catalogue is deliberately UNSCOPED here. It is the input to window
   * discovery, and windows are what choose the sheet — reading a sheet-scoped
   * catalogue first would mean knowing the sheet before the thing that decides
   * it.
   */
  /*
   * THE PERIOD'S POPULATION, AS THIS READER'S POPULATION.
   *
   * `allSalons` means "every salon this report holds, before the OTHER filters"
   * — it feeds the salon menu, the eligible list and the "of N salons" counts,
   * so a menu built from the delivery's full population would put every salon's
   * NAME in front of a restricted reader even with its figures withheld.
   *
   * NARROWED IN THE QUERY RATHER THAN AFTERWARDS. Reading all fifteen and
   * filtering to one satisfies the screen and not the requirement: the rows
   * exist in the process, in a log line, in a serialisation. The allowlist goes
   * into the request instead.
   */
  const rosterFilters = scope.unrestricted
    ? DEFAULT_FILTERS
    : { ...DEFAULT_FILTERS, salonNumbers: [...scope.salonNumbers] };

  const [options, catalogue, allSalons, periods] = await Promise.all([
    repository.getFilterOptions(reportScope.periodId),
    repository.getMetricCatalogue(reportScope.periodId),
    repository.listSalons(reportScope.periodId, rosterFilters),
    repository.listPeriods(),
  ]);

  /*
   * Reporting history, which is NOT the performance window. Weekly / Monthly /
   * Yearly need several ingested periods; a window is one figure the source
   * computed inside a single report.
   */
  const grains = reportingGrainOptions(periods);
  const availableGrains = grains.filter((grain) => grain.available).map((grain) => grain.id);

  /*
   * THE CURRENT YEAR, DERIVED FROM THIS PERIOD'S OWN DATA.
   *
   * Was `CURRENT_BASIS_YEAR`, a constant reading 2026 under a comment claiming
   * it came from the data. Every "current" figure on the dashboard and in the
   * chat briefing is selected by basis year, so a constant here is a product
   * that starts reading the wrong year on the first of January and shows blanks
   * instead of an error. See `currentBasisYear` in `./windows`.
   *
   * Resolved once, here, and carried on the context — so the dashboard, the
   * salon drill-down and the chat briefing cannot disagree about which year is
   * current, which is the same reason every other resolution lives in this
   * module.
   */
  const currentYear = currentBasisYear({
    fiscalYear: reportScope.fiscalYear,
    catalogue,
  });

  const windows = reportWindows(catalogue, {
    currentYear,
    grainLabel: reportScope.grain.toUpperCase(),
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
  if (!activeWindow) return { status: "no_comparisons", scope: reportScope };

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
            currentYear,
          )
        : false,
    ]),
  );

  return {
    status: "ready",
    context: {
      repository,
      scope: reportScope,
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
      currentYear,
    },
  };
}
