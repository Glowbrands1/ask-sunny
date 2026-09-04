import type { Metadata } from "next";

import { PermissionGate } from "@/components/permission-gate";
import { ReportFrame } from "@/features/reports/report-frame";
import { ReportTabs } from "@/features/reports/report-tabs";
import { REPORTS } from "@/features/reports/reports-routes";
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
  CURRENT_BASIS_YEAR,
  HEADLINE_METRIC_CODES,
  plottableRows,
  serializeReportFilters,
  sortSalonRows,
  windowAvailableFor,
  windowCaveatSentence,
  windowMetricCodeList,
  windowMetricCodes,
  type RankingSortField,
} from "@/lib/reporting/read";
import { loadReportContext } from "@/lib/reporting/read/report-context";
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
import { requirePagePermission } from "@/lib/auth/page";

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

/**
 * The section's shared chrome, carrying the tab strip that switches to Sales
 * Totals. The heading text comes from `REPORTS`, so this report's name is
 * written once.
 */
function Frame({ children }: { children: React.ReactNode }) {
  return <ReportFrame report={REPORTS[0]}>{children}</ReportFrame>;
}

export default async function SalonPerformancePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePagePermission("view_reports");

  if (!process.env[SUPABASE_URL_ENV] || !supabaseSecretKeyConfigured()) {
    return (
      <Frame>
        <Notice tone="attention" title="Supabase is not configured in this runtime">
          This dashboard reads ingested reporting data directly, so it needs the
          server-side Supabase configuration in whichever environment served this
          page. Nothing is wrong with the report or the data — {SUPABASE_URL_ENV}{" "}
          and the Supabase secret key are missing here. An administrator can add
          them; there is nothing for a reader to do and no other address to try.
        </Notice>
      </Frame>
    );
  }

  const params = await searchParams;

  /**
   * ONE RESOLUTION, SHARED WITH THE SALON DRILL-DOWN.
   *
   * Period, then window, then sheet, then measures, then facets, then salons —
   * a dependency order, resolved in `read/report-context.ts`. It lives there
   * rather than here because the drill-down is reached from this page carrying
   * this page's filters, so the two must resolve an identical URL identically.
   * A second copy of this logic would show up as a detail page that disagrees
   * with the row that was clicked, both pages internally consistent.
   */
  const loaded = await loadReportContext(params);

  if (loaded.status === "no_report") {
    return (
      <Frame>
        <EmptyState
          title="No report has been ingested yet"
          description="Once a Comp Report workbook has been ingested, its salons, measures and period appear here."
        />
      </Frame>
    );
  }

  /*
   * A period with figures but no comparison columns.
   *
   * Not reachable from either month-to-date sheet, both of which are nothing but
   * comparisons — but a future sheet could hold only current-period figures, and
   * every line below this point reads the selected comparison. Returning here
   * rather than rendering a dashboard around a window that does not exist is the
   * same fail-closed rule the rest of this page follows.
   */
  if (loaded.status === "no_comparisons") {
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

  const {
    repository,
    scope,
    filters: active,
    ignored,
    dropped,
    changed,
    windows,
    activeWindow,
    activeSheet,
    sheetCatalogue,
    measures,
    measureCodes,
    selectedMetric,
    options,
    allSalons,
    eligible,
    periods,
    grains,
    windowAvailability,
  } = loaded.context;

  /**
   * The narrowed population every chart and the table read from.
   *
   * `eligible`, from the shared context, is what the OTHER filters admit and is
   * what the Salon menu offers — so choosing a district narrows the menu to that
   * district's salons and choosing two gives their union. `salons` applies the
   * salon selection as well, so nothing on the page can disagree about who is
   * being counted.
   */
  const salons = await repository.listSalons(scope.periodId, active);

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

  /**
   * The drill-down link for a salon row.
   *
   * Carries the SANITIZED filter set, so the detail page resolves the same
   * period, comparison, sheet and measure this page is showing — and so Back
   * from there restores this view rather than resetting it. The salon number is
   * percent-encoded as the text it is: `0468` keeps its zero into the path.
   */
  const salonHref = (salonNumber: string) => {
    const query = serializeReportFilters(active).toString();
    const path = `${BASE_PATH}/${encodeURIComponent(salonNumber)}`;
    return query ? `${path}?${query}` : path;
  };

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
            title={REPORTS[0].label}
            description={REPORTS[0].summary}
          />
          {/* Switches to Sales Totals. Above the source and scope lines,
              because those describe THIS report and would read as describing
              the other one if the switch sat below them. */}
          <ReportTabs />
          <SourceFreshness scope={scope} ingestedLabel={ingestedLabel} />
          <ScopeBanner scope={scope} />
        </div>

        {/* Tidies the address bar to match what is rendered. No scroll, no
            history entry — see `canonical-filters.tsx`. */}
        <CanonicalFilters href={canonicalHref} enabled={changed} />

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

        {ignored.length + dropped.length > 0 ? (
          <Notice tone="neutral" title="Some filters in this link were adjusted">
            {[
              ...dropped,
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
              description="Select a salon to open its own page. Rank and quintile are as reported by the source against the whole chain, never recomputed here."
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
                  salonHref={salonHref}
                />
              </CardContent>
            </Card>
          </section>
        </>
      </PageShell>
    </PermissionGate>
  );
}
