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
  CURRENT_BASIS_YEAR,
  DEFAULT_FILTERS,
  defaultWindow,
  findWindow,
  HEADLINE_METRIC_CODES,
  parseReportFilters,
  plottableRows,
  reportWindows,
  serializeReportFilters,
  sortSalonRows,
  windowAvailableFor,
  windowCaveatSentence,
  windowMetricCodeList,
  windowMetricCodes,
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
import { FilterBar } from "@/features/reports/salon-performance/filter-bar";
import { KpiCards } from "@/features/reports/salon-performance/kpi-cards";
import { RankingTable } from "@/features/reports/salon-performance/ranking-table";
import {
  ScopeBanner,
  SourceFreshness,
} from "@/features/reports/salon-performance/scope-banner";

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
  const scope = await repository.getScope(filters.periodEnd);

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

  const [options, catalogue, salons, allSalons, periods] = await Promise.all([
    repository.getFilterOptions(scope.periodId),
    repository.getMetricCatalogue(scope.periodId),
    repository.listSalons(scope.periodId, filters),
    // Unfiltered, so the salon filter can always be widened again.
    repository.listSalons(scope.periodId, DEFAULT_FILTERS),
    repository.listPeriods(),
  ]);

  /**
   * Selectable measures are the BASE ones.
   *
   * A `% change` metric is identified by carrying a `comparison_of` in the
   * catalogue, so this is read from the data rather than from a name pattern.
   * Those metrics are not offered as measures because the window already
   * expresses the comparison — offering both let a manager pick "Total Revenue
   * % Change" and then also pick a window, two controls saying the same thing
   * and free to disagree.
   */
  const measures = catalogue.filter((metric) => metric.comparisonOfCode === null);

  const selectedMetric =
    measures.find((metric) => metric.code === filters.metricCodes[0]) ?? measures[0] ?? null;

  // Windows are DISCOVERED from the catalogue: a year comparison exists because
  // facts carry that year, a rolling window because a metric for it carries
  // facts. Nothing here is a hardcoded list of options.
  const windows = reportWindows(catalogue, {
    currentYear: CURRENT_BASIS_YEAR,
    grainLabel: scope.grain.toUpperCase(),
  });
  const activeWindow =
    findWindow(windows, filters.window) ?? defaultWindow(windows, CURRENT_BASIS_YEAR - 2);

  const windowAvailability = Object.fromEntries(
    windows.map((window) => [
      window.id,
      selectedMetric
        ? windowAvailableFor(catalogue, selectedMetric.code, window, CURRENT_BASIS_YEAR)
        : false,
    ]),
  );

  // THE KPI ROW IS ALWAYS THE FOUR APPROVED HEADLINE MEASURES. The metric
  // selector drives the charts and the table, not the KPI row: a manager
  // comparing districts should not lose Total Revenue from the top of the page
  // because they went to look at Spa Sessions.
  const kpiCodes = [...HEADLINE_METRIC_CODES];

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
  });

  const kpis = buildKpiCards({
    metricCodes: kpiCodes,
    catalogue,
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

  const sorted = sortSalonRows(rows, filters.sort, filters.direction);
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
    ? windowAvailableFor(catalogue, selectedMetric.code, activeWindow, CURRENT_BASIS_YEAR)
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
    const flip = filters.sort === field && filters.direction === "desc" ? "asc" : "desc";
    const query = serializeReportFilters({ ...filters, sort: field, direction: flip });
    const search = query.toString();
    return search ? `${BASE_PATH}?${search}` : BASE_PATH;
  };

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
        </div>

        {/* B. One compact filter bar. */}
        <FilterBar
          base={BASE_PATH}
          filters={filters}
          options={options}
          metrics={measures}
          windows={windows}
          windowAvailability={windowAvailability}
          periods={periods}
          salons={allSalons}
        />

        {ignored.length > 0 ? (
          <Notice tone="neutral" title="Some filters in this link were ignored">
            {ignored.length} value{ignored.length === 1 ? "" : "s"} could not be applied because
            they are not available in this report.
          </Notice>
        ) : null}

        {caveat ? <Notice tone="attention">{caveat}</Notice> : null}

        {!supported && selectedMetric ? (
          <Notice tone="neutral" title="Unavailable for this combination">
            The source report does not carry {metricLabel} for {activeWindow.label}. Nothing is
            substituted in its place — choose another window or another measure.
          </Notice>
        ) : null}

        {/* C. The four headline measures, always. */}
        <section className="space-y-3">
          <SectionHeader
            title="Headline measures"
            description={`${salons.length} of ${scope.salonCount} salons in this report · ${activeWindow.label}`}
          />
          <KpiCards kpis={kpis} windowShortLabel={activeWindow.shortLabel} />
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
                sort={filters.sort}
                direction={filters.direction}
                sortHref={sortHref}
              />
            </CardContent>
          </Card>
        </section>
      </PageShell>
    </PermissionGate>
  );
}
