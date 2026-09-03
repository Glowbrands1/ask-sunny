import type { Metadata } from "next";

import { PermissionGate } from "@/components/permission-gate";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState, Notice } from "@/components/ui/feedback";
import { SectionHeader } from "@/components/ui/layout";
import {
  SUPABASE_URL_ENV,
  supabaseSecretKeyConfigured,
} from "@/lib/config/server-env";
import {
  formatReportDate,
  listSalesTotalsDates,
  loadSalesTotals,
  type SalesTotalsSubject,
} from "@/lib/reporting/read/sales-totals-read";
import {
  SALES_TOTALS_MEASURES,
  type SalesTotalsWindow,
} from "@/lib/reporting/sales-totals/metric-map";
import { ReportFrame } from "@/features/reports/report-frame";
import { REPORTS } from "@/features/reports/reports-routes";
import {
  SalesTotalsFilterBar,
  type SalesTotalsFilters,
} from "@/features/reports/sales-totals/filter-bar";
import { SalesTotalsKpiCards } from "@/features/reports/sales-totals/kpi-cards";
import { SalesTotalsRankingChart } from "@/features/reports/sales-totals/ranking-chart";
import { SalesTotalsSalonTable } from "@/features/reports/sales-totals/salon-table";

/**
 * ============================================================================
 * SALES TOTALS — the daily report
 * ============================================================================
 *
 * One delivery per morning, each carrying two windows: the previous day and
 * month to date through that day. So this page shows ONE report date at a time,
 * and switching date switches snapshot rather than extending a range.
 *
 * THREE THINGS THIS PAGE REFUSES TO DO, each because the source makes it
 * tempting and each because the result would be a wrong number:
 *
 *   1. NO SUMMING ACROSS REPORT DATES. MTD is already cumulative — Sep 2's MTD
 *      contains Sep 1 — so adding two snapshots double-counts the overlap. The
 *      read layer takes one date and one window, which makes the mistake
 *      unavailable rather than merely discouraged.
 *
 *   2. NO TREND LINE FROM ONE DATE, or from MTD at all. Two dates are two
 *      snapshots, not two points on a path. A daily trend becomes honest once
 *      enough `daily` snapshots exist, and it will be a new chart.
 *
 *   3. NO ESTATE TOTAL DERIVED FROM THE SALON ROWS. The summary block covers
 *      all 249 salons; the salon rows are the recipient's 15. Neither is
 *      computable from the other, so both are shown as reported and labelled
 *      with which population they describe.
 *
 * The summary figures are per-salon AVERAGES, which the cards say out loud —
 * see `kpi-cards.tsx` for why that label is the most important thing on the
 * page.
 */

export const metadata: Metadata = { title: "Sales Totals" };

/** Reads live reporting data on every request. */
export const dynamic = "force-dynamic";

const BASE_PATH = "/reports/sales-totals";
const REPORT = REPORTS.find((report) => report.key === "sales-totals")!;

function first(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export default async function SalesTotalsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!process.env[SUPABASE_URL_ENV] || !supabaseSecretKeyConfigured()) {
    return (
      <ReportFrame report={REPORT}>
        <Notice tone="attention" title="Supabase is not configured in this runtime">
          This report reads ingested reporting data directly, so it needs the
          server-side Supabase configuration in whichever environment served this
          page. An administrator can add it; there is nothing for a reader to do
          and no other address to try.
        </Notice>
      </ReportFrame>
    );
  }

  const search = await searchParams;
  const dates = await listSalesTotalsDates();

  if (dates.length === 0) {
    return (
      <ReportFrame report={REPORT}>
        <EmptyState
          title="No Sales Totals report has been ingested yet"
          description="This report arrives each morning by email. Once a delivery has been ingested, its previous-day and month-to-date figures appear here."
        />
      </ReportFrame>
    );
  }

  /*
   * DEFAULT IS THE NEWEST REPORT DATE — newest by the date the report COVERS,
   * not by when it was ingested. A backfilled older report must not become the
   * default just because it arrived last.
   */
  const requestedDate = first(search.date);
  const reportDate =
    dates.find((date) => date.reportDate === requestedDate)?.reportDate ?? dates[0].reportDate;

  const requestedWindow = first(search.window);
  const window: SalesTotalsWindow = requestedWindow === "mtd" ? "mtd" : "daily";

  const snapshot = await loadSalesTotals({ reportDate, window });
  if (!snapshot) {
    return (
      <ReportFrame report={REPORT}>
        <Notice tone="attention" title="This report date has no figures for the selected window">
          The snapshot for {formatReportDate(reportDate)} exists but reported nothing
          in this window. Try the other window, or another date.
        </Notice>
      </ReportFrame>
    );
  }

  // Scope: default to the widest one the report offers.
  const requestedScope = first(search.scope);
  const scope =
    snapshot.summaries.find((entry) => entry.key === requestedScope) ?? snapshot.summaries[0];

  const requestedSalon = first(search.salon);
  const activeSalon =
    snapshot.salons.find((entry) => entry.key === requestedSalon)?.key ?? null;

  const requestedMetric = first(search.metric);
  const metric =
    SALES_TOTALS_MEASURES.find((measure) => measure.code === requestedMetric) ??
    SALES_TOTALS_MEASURES[0];

  const requestedSort = first(search.sort);
  const sortField =
    requestedSort === "label" ||
    SALES_TOTALS_MEASURES.some((measure) => measure.code === requestedSort)
      ? requestedSort!
      : metric.code;

  const filters: SalesTotalsFilters = {
    reportDate,
    window,
    scope: scope?.key ?? "",
    salon: activeSalon,
    metric: metric.code,
  };

  // The subject the KPI cards describe: a pinned salon if there is one, else
  // the selected scope. A salon's own figures are its takings; a scope's are
  // averages, and the cards say which.
  const pinnedSalon = activeSalon
    ? (snapshot.salons.find((entry) => entry.key === activeSalon) ?? null)
    : null;
  const cardSubject = pinnedSalon ?? scope;

  const tableSalons = sortSalons(snapshot.salons, sortField);
  const rankingRows = snapshot.salons
    .map((salon) => {
      const figure = salon.figures.find((entry) => entry.metricCode === metric.code);
      return {
        salonNumber: salon.salonNumber ?? salon.key,
        storeName: salon.label,
        value: figure?.value ?? null,
      };
    })
    // A salon that did not report this measure is left out rather than plotted
    // as a zero-length bar, which would read as "reported nothing sold".
    .filter((row): row is { salonNumber: string; storeName: string; value: number } =>
      row.value !== null,
    )
    .sort((left, right) => right.value - left.value);

  const tableMetrics = SALES_TOTALS_MEASURES.map((measure) => ({
    code: measure.code,
    label: measure.label,
    unit: measure.unit,
  }));

  function sortHref(field: string): string {
    const params = new URLSearchParams();
    params.set("date", reportDate);
    params.set("window", window);
    params.set("scope", filters.scope);
    params.set("metric", metric.code);
    if (activeSalon) params.set("salon", activeSalon);
    params.set("sort", field);
    return `${BASE_PATH}?${params.toString()}`;
  }

  return (
    <PermissionGate permission="view_reports">
      <ReportFrame report={REPORT}>
        {/* What this delivery is, and the caveat that governs every figure. */}
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted-foreground">
            <span className="rounded-full bg-surface-muted px-2 py-0.5 font-medium text-foreground">
              {formatReportDate(snapshot.reportDate)}
            </span>
            <span>{snapshot.windowLabel}</span>
            <span aria-hidden>·</span>
            <span>{snapshot.windowDescription}</span>
            {snapshot.lineage.ingestedAt ? (
              <>
                <span aria-hidden>·</span>
                <span>
                  Ingested{" "}
                  {new Date(snapshot.lineage.ingestedAt).toLocaleString("en-US", {
                    dateStyle: "medium",
                    timeStyle: "short",
                    timeZone: "UTC",
                  })}{" "}
                  UTC
                </span>
              </>
            ) : null}
          </div>

          <Notice tone="attention" title="Two populations on this page">
            The scope figures below cover <strong>all salons in the estate</strong> and are{" "}
            <strong>averages per salon</strong>, exactly as the report states. The salon
            table and chart cover the <strong>{snapshot.salons.length} salons in this
            delivery</strong> and are those salons&rsquo; own figures. Neither is derived
            from the other, and they do not add up to each other.
          </Notice>
        </div>

        <SalesTotalsFilterBar
          base={BASE_PATH}
          filters={filters}
          dates={dates}
          scopes={snapshot.summaries}
          salons={snapshot.salons}
          metrics={SALES_TOTALS_MEASURES.map((measure) => ({
            code: measure.code,
            label: measure.label,
          }))}
        />

        {/* A. The six measures for the selected subject. */}
        <section className="space-y-3">
          <SectionHeader
            title={pinnedSalon ? pinnedSalon.label : (scope?.label ?? "Scope")}
            description={
              pinnedSalon
                ? `This salon's own figures for the ${snapshot.windowLabel.toLowerCase()} window.`
                : `Averages per salon across ${scope?.salonCount ?? "?"} salons, as reported.`
            }
          />
          {cardSubject ? (
            <SalesTotalsKpiCards
              subject={cardSubject}
              window={window}
              reportDate={formatReportDate(snapshot.reportDate)}
              monthStart={formatReportDate(snapshot.monthStart)}
            />
          ) : null}
        </section>

        {/* B. All scopes side by side, for the selected metric. */}
        <section className="space-y-3">
          <SectionHeader
            title="By company / scope"
            description={`${metric.label} — ${metric.note}`}
          />
          <div className="grid gap-3 sm:grid-cols-3">
            {snapshot.summaries.map((summary) => {
              const figure = summary.figures.find((entry) => entry.metricCode === metric.code);
              return (
                <Card key={summary.key}>
                  <CardContent className="space-y-1 p-4">
                    <p className="eyebrow">{summary.label}</p>
                    <p className="text-[22px] leading-none font-semibold tabular-nums text-foreground">
                      {figure?.value == null
                        ? "Unavailable"
                        : formatValue(figure.value, metric.unit)}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      Average per salon · {summary.salonCount ?? "?"} salons
                    </p>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </section>

        {/* C. The salons in this delivery, ranked on the selected metric. */}
        <section className="space-y-3">
          <SectionHeader
            title={`${metric.label} by salon`}
            description={`${snapshot.windowLabel} figures for the ${snapshot.salons.length} salons in this delivery, ranked. A snapshot of one date — not a trend.`}
          />
          <Card>
            <CardContent className="p-3">
              <SalesTotalsRankingChart
                rows={rankingRows}
                metricLabel={metric.label}
                unit={metric.unit}
                windowLabel={snapshot.windowLabel}
              />
            </CardContent>
          </Card>
        </section>

        {/* D. Everything, sortable. */}
        <section className="space-y-3">
          <SectionHeader
            title="All measures by salon"
            description="Sortable. No totals row: PPTA is an average that cannot be summed, and a sum of these 15 salons would not be the estate figure shown above."
          />
          <Card>
            <CardContent className="p-0">
              <SalesTotalsSalonTable
                salons={tableSalons}
                metrics={tableMetrics}
                sortField={sortField}
                sortHref={sortHref}
                activeSalon={activeSalon}
              />
            </CardContent>
          </Card>
        </section>

        {/* E. Where these figures came from. */}
        <section className="space-y-3">
          <SectionHeader title="Data source & quality" description="Lineage for this delivery." />
          <Card>
            <CardContent className="grid gap-x-8 gap-y-2 p-4 text-[12px] sm:grid-cols-2">
              <Lineage label="Report date (as printed)" value={snapshot.reportDateRaw} />
              <Lineage label="Report date (resolved)" value={snapshot.reportDate} />
              <Lineage label="MTD window opens" value={snapshot.monthStart} />
              <Lineage label="Window shown" value={snapshot.windowLabel} />
              <Lineage label="Scopes reported" value={String(snapshot.summaries.length)} />
              <Lineage label="Salons in this delivery" value={String(snapshot.salons.length)} />
              <Lineage label="Parser" value={snapshot.lineage.parserKey ?? "Not recorded"} />
              <Lineage
                label="Parser version"
                value={
                  snapshot.lineage.parserVersion === null
                    ? "Not recorded"
                    : String(snapshot.lineage.parserVersion)
                }
              />
              <Lineage label="Source" value="Sales Totals (daily emailed report)" />
              <Lineage
                label="Report dates held"
                value={`${dates.length} (${dates[dates.length - 1].reportDate} to ${dates[0].reportDate})`}
              />
            </CardContent>
          </Card>
        </section>
      </ReportFrame>
    </PermissionGate>
  );
}

function Lineage({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border pb-1.5 last:border-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right text-foreground">{value}</dd>
    </div>
  );
}

function formatValue(value: number, unit: "currency" | "count"): string {
  if (unit === "currency") {
    return value.toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }
  return value.toLocaleString("en-US");
}

/** Sorts by a measure descending, or by name ascending. */
function sortSalons(
  salons: readonly SalesTotalsSubject[],
  field: string,
): SalesTotalsSubject[] {
  const sorted = [...salons];
  if (field === "label") {
    return sorted.sort((left, right) => left.label.localeCompare(right.label));
  }
  return sorted.sort((left, right) => {
    const leftValue = left.figures.find((entry) => entry.metricCode === field)?.value;
    const rightValue = right.figures.find((entry) => entry.metricCode === field)?.value;
    // Unavailable sorts last either way, rather than being treated as zero.
    if (leftValue == null && rightValue == null) return left.label.localeCompare(right.label);
    if (leftValue == null) return 1;
    if (rightValue == null) return -1;
    return rightValue - leftValue;
  });
}
