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
  BASELINE_LABELS,
  buildKpiCards,
  formatMetricValue,
  buildMovers,
  buildSalonRows,
  CURRENT_BASIS_YEAR,
  DEFAULT_FILTERS,
  HEADLINE_METRIC_CODES,
  parseReportFilters,
  plottableRows,
  serializeReportFilters,
  sortSalonRows,
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
 * Everything on this page is read from Supabase per request: the scope sentence,
 * the filters offered, the metric catalogue, and every figure. There is no
 * seeded content and no fallback — if the data is not there the page says so.
 *
 * WHAT THIS PAGE WILL NOT DO, each for a stated reason:
 *
 *   No line or area chart. One period is ingested; a line between points that
 *   do not exist is a fabricated trend.
 *   No company total. The workbook is one recipient's filtered copy.
 *   No recomputed rank or quintile. Both are reported chain-wide upstream.
 *   No zero standing in for a missing baseline.
 *
 * Detailed provenance — parser warnings, excluded columns, the file digest —
 * stays out of the executive view by decision, and arrives in 6C behind a
 * "Data source & quality" drawer. Only source and freshness show here.
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

  const [options, catalogue, salons, allSalons] = await Promise.all([
    repository.getFilterOptions(scope.periodId),
    repository.getMetricCatalogue(scope.periodId),
    repository.listSalons(scope.periodId, filters),
    // Unfiltered, so the salon filter can always be widened again.
    repository.listSalons(scope.periodId, DEFAULT_FILTERS),
  ]);

  // The selected measure drives the three charts and the table.
  const selectedCode = filters.metricCodes[0];
  const selectedMetric =
    catalogue.find((metric) => metric.code === selectedCode) ?? catalogue[0];

  // THE KPI ROW IS ALWAYS THE FOUR APPROVED HEADLINE MEASURES. The metric
  // selector drives the charts and the table, not the KPI row: a manager
  // comparing districts should not lose Total Revenue from the top of the page
  // because they went to look at Spa Sessions.
  const kpiCodes = [...HEADLINE_METRIC_CODES];

  const facts = await repository.getFactRows({
    periodId: scope.periodId,
    metricCodes: [...new Set([...kpiCodes, selectedMetric?.code].filter(Boolean) as string[])],
    // The one filter implementation: charts see exactly the salons the filters
    // admitted, so nothing can disagree about the population.
    salonNumbers: salons.map((salon) => salon.salonNumber),
  });

  const kpis = buildKpiCards({
    metricCodes: kpiCodes,
    catalogue,
    facts,
    currentYear: CURRENT_BASIS_YEAR,
    baselineYear: filters.baselineYear,
  });

  const rows = selectedMetric
    ? buildSalonRows({
        metricCode: selectedMetric.code,
        salons,
        facts,
        currentYear: CURRENT_BASIS_YEAR,
        baselineYear: filters.baselineYear,
      })
    : [];

  const sorted = sortSalonRows(rows, filters.sort, filters.direction);
  const plotted = plottableRows(sorted);
  const movers = buildMovers(sorted);

  const availableBaselines = (selectedMetric?.availableBasisYears ?? [])
    .filter((year) => year !== CURRENT_BASIS_YEAR)
    .sort((a, b) => b - a);

  const ingestedLabel = scope.ingestedAt
    ? `${new Date(scope.ingestedAt).toLocaleString("en-US", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "UTC",
      })} UTC`
    : "unknown";

  const drilldownHref = (salonNumber: string) => {
    const query = serializeReportFilters({ ...filters, salonNumbers: [salonNumber] });
    // Route prepared for the 6C drill-down; filters travel with it.
    return `${BASE_PATH}/salon/${encodeURIComponent(salonNumber)}?${query.toString()}`;
  };

  const metricLabel = selectedMetric?.label ?? "Selected measure";
  const unit = selectedMetric?.unit ?? "count";
  const baselineLabel = BASELINE_LABELS[filters.baselineYear] ?? `vs ${filters.baselineYear}`;

  return (
    <PermissionGate permission="view_reports">
      <PageShell className="space-y-6">
        <PageHeader
          eyebrow="Reporting"
          title="Salon Performance"
          description="Comparable-store (same-store) sales from the ingested Comp Report."
        />

        <ScopeBanner scope={scope} />
        <SourceFreshness scope={scope} ingestedLabel={ingestedLabel} />

        {ignored.length > 0 ? (
          <Notice tone="neutral" title="Some filters in this link were ignored">
            {ignored.length} value{ignored.length === 1 ? "" : "s"} could not be applied because
            they are not available in this report.
          </Notice>
        ) : null}

        <FilterBar
          base={BASE_PATH}
          filters={filters}
          options={options}
          metrics={catalogue}
          availableBaselines={availableBaselines}
          salons={allSalons}
        />

        <section className="space-y-3">
          <SectionHeader
            title="Headline measures"
            description={`${salons.length} of ${scope.salonCount} salons in this report · compared ${baselineLabel}`}
          />
          <KpiCards
            kpis={kpis}
            baselineYear={filters.baselineYear}
            currentYear={CURRENT_BASIS_YEAR}
          />
        </section>

        <section className="space-y-3">
          <SectionHeader
            title={`${metricLabel} by salon`}
            description={`${CURRENT_BASIS_YEAR} figures for the salons in view, ranked.`}
          />
          <Card>
            <CardContent>
              <SalonRankingChart
                rows={plotted}
                unit={unit}
                metricLabel={metricLabel}
                currentYear={CURRENT_BASIS_YEAR}
                baselineYear={filters.baselineYear}
              />
            </CardContent>
          </Card>
        </section>

        <section className="space-y-3">
          <SectionHeader
            title={`${CURRENT_BASIS_YEAR} against ${filters.baselineYear}`}
            description="A side-by-side comparison of two reported figures. Not a trend — this report covers one period."
          />
          <Card>
            <CardContent className="space-y-3">
              <ChartLegend
                items={[
                  { label: String(filters.baselineYear), color: SERIES_BASELINE },
                  { label: String(CURRENT_BASIS_YEAR), color: SERIES_CURRENT },
                ]}
              />
              <BaselineComparisonChart
                rows={sorted}
                unit={unit}
                metricLabel={metricLabel}
                currentYear={CURRENT_BASIS_YEAR}
                baselineYear={filters.baselineYear}
              />
            </CardContent>
          </Card>
        </section>

        <section className="space-y-3">
          <SectionHeader
            title="Movement against the baseline"
            description={
              movers.comparable
                ? `Bars run right of zero for an increase and left for a decrease. ${
                    movers.changeSource === "reported"
                      ? "Changes are as reported by the source."
                      : "Changes are computed from the two figures in this report."
                  }`
                : "This measure has no baseline in the report, so movement cannot be shown."
            }
          />
          <Card>
            <CardContent className="space-y-4">
              <MoversChart
                rows={sorted}
                unit={unit}
                metricLabel={metricLabel}
                currentYear={CURRENT_BASIS_YEAR}
                baselineYear={filters.baselineYear}
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
                currentYear={CURRENT_BASIS_YEAR}
                baselineYear={filters.baselineYear}
                drilldownHref={drilldownHref}
              />
            </CardContent>
          </Card>
        </section>
      </PageShell>
    </PermissionGate>
  );
}
