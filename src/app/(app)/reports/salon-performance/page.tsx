import type { Metadata } from "next";

import { PermissionGate } from "@/components/permission-gate";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState, Notice } from "@/components/ui/feedback";
import { PageHeader, PageShell, SectionHeader } from "@/components/ui/layout";
import {
  SUPABASE_URL_ENV,
  supabaseSecretKeyConfigured,
} from "@/lib/config/server-env";
import {
  buildKpiCards,
  formatMetricValue,
  buildMovers,
  buildSalonRows,
  canonicalizeReportFilters,
  CURRENT_BASIS_YEAR,
  DEFAULT_FILTERS,
  defaultWindowForSheet,
  eligibleSalons,
  HEADLINE_METRIC_CODES,
  parseReportFilters,
  plottableRows,
  PREFERRED_BASELINE_YEAR,
  reportWindows,
  resolveWindow,
  serializeReportFilters,
  sortSalonRows,
  isReportViewId,
  VIEWS_BY_ID,
  windowAvailableFor,
  windowCaveatSentence,
  windowMetricCodeList,
  windowMetricCodes,
  reportingGrainOptions,
  selectableMeasureCodes,
  type ReportFilters,
  type RankingSortField,
} from "@/lib/reporting/read";
import { ReportingReadRepository } from "@/lib/reporting/read/reporting-read-repository";
import {
  BaselineComparisonChart,
  ChartLegend,
  MoversChart,
  SalonRankingChart,
} from "@/features/reports/salon-performance/charts";
import {
  SERIES_BASELINE,
  SERIES_CURRENT,
} from "@/features/reports/salon-performance/chart-palette";
import { CanonicalFilters } from "@/features/reports/salon-performance/canonical-filters";
import { FilterBar } from "@/features/reports/salon-performance/filter-bar";
import { KpiCards } from "@/features/reports/salon-performance/kpi-cards";
import { RankingTable } from "@/features/reports/salon-performance/ranking-table";
import {
  ScopeBanner,
  SourceFreshness,
} from "@/features/reports/salon-performance/scope-banner";
import { ReviewSessionBanner } from "@/features/reports/salon-performance/review-session-banner";
import { reviewGateConfigured } from "@/lib/reporting-review/gate";

/**
 * SALON PERFORMANCE — the executive dashboard, on live reporting data.
 *
 * Comparable-store (same-store) sales. Not compensation, payroll or bonuses.
 *
 * READING ORDER IS THE DESIGN. Header, then one compact filter bar, then the
 * four headline measures, then the charts, then the table. An earlier revision
 * opened with every filter expanded — a wall of chips a manager had to read past
 * before reaching a single number — and that is the specific thing this layout
 * fixes.
 *
 * Everything here is read from Supabase per request: the scope sentence, the
 * filters offered, the windows offered, the metric catalogue, and every figure.
 * There is no seeded content and no fallback — if the data is not there the page
 * says so.
 *
 * WHAT THIS PAGE WILL NOT DO, each for a stated reason:
 *
 *   No line or area chart. One period is ingested; a line between points that
 *   do not exist is a fabricated progression. A window such as "Last 3 Months"
 *   is a single figure the SOURCE computed, not three months of history — see
 *   `read/windows.ts`, which keeps those two ideas apart deliberately.
 *   No total presented as the chain's. The workbook is one recipient's copy.
 *   No recomputed rank or quintile. Both are reported chain-wide upstream.
 *   No zero standing in for a missing figure.
 *   No substitution. A measure the source does not report for the selected
 *   window reads "Unavailable"; it never falls back to another window.
 *
 * Detailed provenance — parser warnings, excluded columns, the file digest —
 * stays out of the executive view by decision, and arrives behind a "Data
 * source & quality" panel. Only period and freshness show here.
 */
export const dynamic = "force-dynamic";

const BASE_PATH = "/reports/salon-performance";

export const metadata: Metadata = {
  title: "Salon Performance",
};

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <PageShell className="space-y-6">
      <PageHeader
        eyebrow="Reporting"
        title="Salon Performance"
        description="Comparable-store (same-store) sales from the ingested Comp Report."
      />
      {children}
    </PageShell>
  );
}

export default async function SalonPerformancePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!process.env[SUPABASE_URL_ENV] || !supabaseSecretKeyConfigured()) {
    return (
      <Frame>
        <Notice tone="attention" title="Supabase is not configured in this runtime">
          This dashboard reads ingested reporting data directly, so it needs the server-side
          Supabase configuration. It is available in the Preview and internal environments.
        </Notice>
      </Frame>
    );
  }

  const params = await searchParams;
  const { filters, ignored } = parseReportFilters(params);

  const repository = new ReportingReadRepository();
  const scope = await repository.getScope(filters.periodEnd, filters.periodGrain);

  if (!scope) {
    return (
      <Frame>
        <EmptyState
          title="No report has been ingested yet"
          description="Once a Comp Report workbook has been ingested, its salons, measures and period appear here."
        />
      </Frame>
    );
  }

  /**
   * EVERYTHING THE SELECTED PERIOD HOLDS, read before anything is resolved.
   *
   * The catalogue is deliberately UNSCOPED here. It is the input to window
   * discovery, and windows are what choose the sheet — reading a sheet-scoped
   * catalogue first would mean knowing the sheet before the thing that decides
   * it, which is the loop the old View control was papering over.
   *
   * Every one of these reads is scoped to `scope.periodId`. That is what makes
   * this a dashboard that can hold years of reports rather than one: a new
   * period brings its own salons, districts, measures and comparisons, and
   * nothing from another period can reach this render.
   */
  const [options, catalogue, allSalons, periods] = await Promise.all([
    repository.getFilterOptions(scope.periodId),
    repository.getMetricCatalogue(scope.periodId),
    // Unfiltered, so the salon menu can always be widened again.
    repository.listSalons(scope.periodId, DEFAULT_FILTERS),
    repository.listPeriods(),
  ]);

  /**
   * Reporting history, which is NOT the performance window.
   *
   * Weekly / Monthly / Yearly need several ingested periods; a window is one
   * figure the source computed inside a single report. With one period loaded
   * no grain is available, so the control is not rendered at all rather than
   * offering a Weekly that would be a claim we cannot support.
   */
  const grains = reportingGrainOptions(periods);
  const availableGrains = grains
    .filter((grain) => grain.available)
    .map((grain) => grain.id);

  /**
   * THE COMPARISON CHOOSES THE SHEET.
   *
   * Windows are discovered per sheet — a year comparison exists because facts
   * carry that year, a trailing window because a metric for it carries facts —
   * and each window remembers where it came from. So a manager picks
   * `Last 3 Months` and the rolling sheet follows; they pick `vs 2024` and the
   * year-comparison sheet follows. They are never asked which workbook tab
   * their question lives on, because that is not a question they can answer.
   */
  const windows = reportWindows(catalogue, {
    currentYear: CURRENT_BASIS_YEAR,
    grainLabel: scope.grain.toUpperCase(),
  });

  /**
   * A link from when the dashboard DID ask for a sheet.
   *
   * `?view=mtd_rolling` is translated to that sheet's own default comparison
   * rather than dropped, so an old bookmark lands where its author meant. This
   * is also the exact repair for the reported bug's URL: a rolling view paired
   * with a `Current MTD` window resolves to `Last 3 Months` instead of to a
   * comparison that sheet has never carried.
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

  /**
   * Selectable measures are the BASE ones the CHOSEN SHEET offers.
   *
   * `selectableMeasureCodes` answers this from the catalogue: a `% change`
   * metric is never offered, because the window already expresses the
   * comparison, and a rolling metric contributes its STEM rather than itself —
   * a manager picks Total Revenue, and the window decides which of the
   * twenty-four rolling codes is read. On the rolling sheet that leaves exactly
   * Total Revenue and Total Tans, which is what the source reports there.
   *
   * The definitions are fetched separately because a rolling sheet holds no
   * `total_revenue` facts of its own, so its base measure has no catalogue row
   * there; its label and unit come from the reviewed vocabulary instead of being
   * reconstructed from a rolling metric's label.
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

  /**
   * ONE SANITIZING PASS OVER THE WHOLE FILTER SET.
   *
   * Not per control. Resolving each independently is what let a valid window, a
   * valid measure and a valid district add up to a combination the report cannot
   * answer — every part defensible, the whole incoherent. See `read/canonical.ts`.
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

  /**
   * A period with figures but no comparison columns.
   *
   * Not reachable from either month-to-date sheet, both of which are nothing but
   * comparisons — but a future sheet could hold only current-period figures, and
   * every line below this point reads the selected comparison. Returning here
   * rather than rendering a dashboard around a window that does not exist is the
   * same fail-closed rule the rest of this page follows, applied where the type
   * system can also see it.
   */
  if (!activeWindow) {
    return (
      <Frame>
        <Notice tone="attention" title="This period holds no comparisons yet">
          Figures for this period have been loaded, but none of the workbook&apos;s comparison
          columns are among them, so there is nothing to compare. Nothing is shown here rather
          than figures from another period, which would be wrong under this heading.
        </Notice>
      </Frame>
    );
  }

  const selectedMetric =
    measures.find((metric) => metric.code === active.metricCodes[0]) ?? measures[0] ?? null;

  /**
   * The salons the Salon menu may offer, and the ones actually in view.
   *
   * `eligible` is what the OTHER filters admit — so choosing a district narrows
   * the menu to that district's salons, and choosing two gives their union.
   * `salons` is the narrowed population every chart and the table read from, so
   * nothing on the page can disagree about who is being counted.
   */
  const eligible = eligibleSalons(allSalons, active);
  const salons = await repository.listSalons(scope.periodId, active);

  const windowAvailability = Object.fromEntries(
    windows.map((window) => [
      window.id,
      selectedMetric
        ? windowAvailableFor(
            // Availability is judged against the window's OWN sheet, not the
            // one on screen: `Last 3 Months` is available because the rolling
            // sheet reports it, whichever comparison is selected right now.
            catalogue.filter((metric) => metric.sourceSheet === window.sourceSheet),
            selectedMetric.code,
            window,
            CURRENT_BASIS_YEAR,
          )
        : false,
    ]),
  );

  /**
   * THE KPI ROW IS THE APPROVED HEADLINE MEASURES THIS COMPARISON REPORTS.
   *
   * The metric selector drives the charts and the table, not the KPI row: a
   * manager comparing districts should not lose Total Revenue from the top of
   * the page because they went to look at Spa Sessions. So the row is fixed
   * with respect to the MEASURE — and filtered by what the selected COMPARISON
   * can answer, which is not the same thing.
   *
   * On the trailing-window comparisons the source reports Total Revenue and
   * Total Tans only. Asking for all four there produced a "Headline measures"
   * heading over an empty row: `buildKpiCards` looks each code up in the
   * catalogue, the rolling sheet holds no `eft_revenue` entry, and a skipped
   * card leaves nothing behind. Two real tiles and a line saying which measures
   * this comparison does not cover is the honest version of that.
   */
  const kpiCodes = HEADLINE_METRIC_CODES.filter((code) => measureCodes.includes(code));
  const kpiOmitted = HEADLINE_METRIC_CODES.filter((code) => !measureCodes.includes(code));

  /**
   * The catalogue the KPI row reads.
   *
   * Both halves are needed. `sheetCatalogue` carries the windowed codes that
   * decide availability; `measures` carries the base-measure definitions —
   * label, unit, direction — which on a rolling sheet exist only in the
   * reviewed vocabulary, because that sheet holds no `total_revenue` facts of
   * its own.
   */
  const kpiCatalogue = [...sheetCatalogue, ...measures];

  // One query, for exactly the codes the selected window needs.
  const factCodes = [
    ...new Set(
      [...kpiCodes, ...(selectedMetric ? [selectedMetric.code] : [])].flatMap((code) =>
        windowMetricCodeList(code, activeWindow, CURRENT_BASIS_YEAR),
      ),
    ),
  ];

  const facts = await repository.getFactRows({
    periodId: scope.periodId,
    metricCodes: factCodes,
    // The one filter implementation: charts see exactly the salons the filters
    // admitted, so nothing can disagree about the population.
    salonNumbers: salons.map((salon) => salon.salonNumber),
    // Only the selected sheet's figures. Once a second sheet is loaded this is
    // what stops one view showing another's numbers under its heading.
    sourceSheet: activeSheet,
  });

  const kpis = buildKpiCards({
    metricCodes: kpiCodes,
    catalogue: kpiCatalogue,
    facts,
    window: activeWindow,
    currentYear: CURRENT_BASIS_YEAR,
  });

  const rows = selectedMetric
    ? buildSalonRows({
        metricCode: selectedMetric.code,
        window: activeWindow,
        currentYear: CURRENT_BASIS_YEAR,
        salons,
        facts,
      })
    : [];

  const sorted = sortSalonRows(rows, active.sort, active.direction);
  const plotted = plottableRows(sorted);
  const movers = buildMovers(sorted);

  const ingestedLabel = scope.ingestedAt
    ? `${new Date(scope.ingestedAt).toLocaleString("en-US", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "UTC",
      })} UTC`
    : "unknown";

  const metricLabel = selectedMetric?.label ?? "Selected measure";
  const unit = selectedMetric?.unit ?? "count";
  const codes = selectedMetric
    ? windowMetricCodes(selectedMetric.code, activeWindow, CURRENT_BASIS_YEAR)
    : null;
  const currentLabel = codes?.currentLabel ?? String(CURRENT_BASIS_YEAR);
  const baselineLabel = codes?.baselineLabel ?? null;
  const supported = selectedMetric
    ? windowAvailableFor(sheetCatalogue, selectedMetric.code, activeWindow, CURRENT_BASIS_YEAR)
    : false;
  const caveat = windowCaveatSentence(activeWindow);

  /**
   * The comparison caption.
   *
   * Both forms end in the same denial, and it is not boilerplate. A rolling
   * window is the single number the SOURCE calculated for a trailing period; it
   * is not several stored reports, and it must never be read as a path from one
   * point to another. Saying so where the comparison is drawn is cheaper than
   * explaining it after somebody has drawn the wrong conclusion.
   */
  const comparisonCaption =
    activeWindow.kind === "rolling"
      ? "One figure per salon, calculated by the source over its trailing window. Not a trend — this report covers one period."
      : "A side-by-side comparison of two figures the source reported. Not a trend — this report covers one period.";

  /** A sort link that keeps every other filter, and flips an active column. */
  const sortHref = (field: RankingSortField) => {
    const flip = active.sort === field && active.direction === "desc" ? "asc" : "desc";
    const query = serializeReportFilters({ ...active, sort: field, direction: flip });
    const search = query.toString();
    return search ? `${BASE_PATH}?${search}` : BASE_PATH;
  };

  /**
   * The URL these filters SHOULD have.
   *
   * Rendered content already uses the sanitized set, so the page is correct
   * before the address bar is. `CanonicalFilters` then tidies the address bar
   * with a `replace` that does not scroll — so a stale link produces a working
   * dashboard and a shareable URL, rather than a page explaining what it cannot
   * do. A URL that is already canonical is left completely alone.
   */
  /** A measure's approved label, for naming one the comparison does not cover. */
  const omittedDefinitions = await repository.getMetricDefinitions(kpiOmitted);
  const measureLabel = (code: string) =>
    omittedDefinitions.find((metric) => metric.code === code)?.label ?? code;

  const canonicalQuery = serializeReportFilters(active).toString();
  const canonicalHref = canonicalQuery ? `${BASE_PATH}?${canonicalQuery}` : BASE_PATH;

  return (
    <PermissionGate permission="view_reports">
      <PageShell className="space-y-5">
        {/* A. Header — what this is, which period, how fresh, and the one
            caveat that governs every number below it. */}
        <div className="space-y-3">
          <PageHeader
            eyebrow="Reporting"
            title="Salon Performance"
            description="Comparable-store (same-store) sales from the ingested Comp Report."
          />
          <SourceFreshness scope={scope} ingestedLabel={ingestedLabel} />
          <ScopeBanner scope={scope} />
          {/* Shown only where the temporary review gate is switched on. */}
          {reviewGateConfigured() ? <ReviewSessionBanner /> : null}
        </div>

        {/* Tidies the address bar to match what is rendered. No scroll, no
            history entry — see `canonical-filters.tsx`. */}
        <CanonicalFilters href={canonicalHref} enabled={canonical.changed} />

        {/* B. One compact filter bar. */}
        <FilterBar
          base={BASE_PATH}
          filters={active}
          options={options}
          metrics={measures}
          activeWindowId={activeWindow.id}
          windows={windows}
          windowAvailability={windowAvailability}
          periods={periods}
          grains={grains}
          salons={eligible}
          eligibleOf={allSalons.length}
        />

        {ignored.length + canonical.dropped.length > 0 ? (
          <Notice tone="neutral" title="Some filters in this link were adjusted">
            {[
              ...canonical.dropped,
              ...(ignored.length > 0
                ? [`${ignored.length} value${ignored.length === 1 ? "" : "s"} this report does not recognise`]
                : []),
            ].join("; ")}
            . The nearest valid view of this report is shown, and the address bar now matches it.
          </Notice>
        ) : null}

        {caveat ? <Notice tone="attention">{caveat}</Notice> : null}

        {!supported && selectedMetric ? (
          <Notice tone="neutral" title="Unavailable for this combination">
            The source report does not carry {metricLabel} for {activeWindow.label}. Nothing is
            substituted in its place — choose another window or another measure.
          </Notice>
        ) : null}

        <>
          {/* C. The four headline measures, always. */}
          <section className="space-y-3">
            <SectionHeader
              title="Headline measures"
              description={`${salons.length} of ${scope.salonCount} salons in this report · ${activeWindow.label}`}
            />
            <KpiCards kpis={kpis} windowShortLabel={activeWindow.shortLabel} />
            {kpiOmitted.length > 0 ? (
              <p className="text-xs text-muted-foreground">
                {kpiOmitted
                  .map((code) => measureLabel(code))
                  .join(", ")}{" "}
                {kpiOmitted.length === 1 ? "is" : "are"} not reported for{" "}
                {activeWindow.label}, so {kpiOmitted.length === 1 ? "it is" : "they are"} not
                shown here. Nothing is substituted in their place.
              </p>
            ) : null}
          </section>

          {/* D. The charts, all driven by the same measure and window. */}
          <section className="space-y-3">
            <SectionHeader
              title={`${metricLabel} by salon`}
              description={`${currentLabel} figures for the salons in view, ranked.`}
            />
            <Card>
              <CardContent>
                <SalonRankingChart
                  rows={plotted}
                  unit={unit}
                  metricLabel={metricLabel}
                  currentLabel={currentLabel}
                  baselineLabel={baselineLabel}
                />
              </CardContent>
            </Card>
          </section>

          {baselineLabel ? (
            <section className="space-y-3">
              <SectionHeader
                title={`${currentLabel} against ${baselineLabel}`}
                description={comparisonCaption}
              />
              <Card>
                <CardContent className="space-y-3">
                  <ChartLegend
                    items={[
                      { label: baselineLabel, color: SERIES_BASELINE },
                      { label: currentLabel, color: SERIES_CURRENT },
                    ]}
                  />
                  <BaselineComparisonChart
                    rows={sorted}
                    unit={unit}
                    metricLabel={metricLabel}
                    currentLabel={currentLabel}
                    baselineLabel={baselineLabel}
                  />
                </CardContent>
              </Card>
            </section>
          ) : null}

          {baselineLabel ? (
            <section className="space-y-3">
              <SectionHeader
                title="Strongest and weakest movers"
                description={
                  movers.comparable
                    ? `Bars run right of zero for an increase and left for a decrease. ${
                        movers.changeSource === "reported"
                          ? "Changes are as reported by the source."
                          : "Changes are computed from the two figures in this report."
                      }`
                    : "This combination has no comparison figure in the report, so movement cannot be shown."
                }
              />
              <Card>
                <CardContent className="space-y-4">
                  <MoversChart
                    rows={sorted}
                    unit={unit}
                    metricLabel={metricLabel}
                    currentLabel={currentLabel}
                    baselineLabel={baselineLabel}
                  />
                  {movers.comparable ? (
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          Largest increases
                        </p>
                        <ul className="mt-1 space-y-0.5 text-sm">
                          {movers.gainers.map((row) => (
                            <li key={row.salonNumber} className="flex justify-between gap-3">
                              <span className="text-muted-foreground">
                                {row.salonNumber} · {row.storeName}
                              </span>
                              <span className="tabular-nums text-foreground">
                                {row.change === null
                                  ? "—"
                                  : formatMetricValue(row.change, "percent")}
                              </span>
                            </li>
                          ))}
                          {movers.gainers.length === 0 ? (
                            <li className="text-muted-foreground">None</li>
                          ) : null}
                        </ul>
                      </div>
                      <div>
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          Largest decreases
                        </p>
                        <ul className="mt-1 space-y-0.5 text-sm">
                          {movers.decliners.map((row) => (
                            <li key={row.salonNumber} className="flex justify-between gap-3">
                              <span className="text-muted-foreground">
                                {row.salonNumber} · {row.storeName}
                              </span>
                              <span className="tabular-nums text-foreground">
                                {row.change === null
                                  ? "—"
                                  : formatMetricValue(row.change, "percent")}
                              </span>
                            </li>
                          ))}
                          {movers.decliners.length === 0 ? (
                            <li className="text-muted-foreground">None</li>
                          ) : null}
                        </ul>
                      </div>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            </section>
          ) : null}

          {/* E. The sortable detail table. */}
          <section className="space-y-3">
            <SectionHeader
              title="Salon detail"
              description="Rank and quintile are as reported by the source against the whole chain, never recomputed here."
            />
            <Card>
              <CardContent>
                <RankingTable
                  rows={sorted}
                  unit={unit}
                  metricLabel={metricLabel}
                  currentLabel={currentLabel}
                  baselineLabel={baselineLabel}
                  sort={active.sort}
                  direction={active.direction}
                  sortHref={sortHref}
                />
              </CardContent>
            </Card>
          </section>
        </>
      </PageShell>
    </PermissionGate>
  );
}
