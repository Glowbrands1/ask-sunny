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
  aggregateSalons,
  selectionHeading,
} from "@/lib/reporting/read/sales-totals-aggregate";
import {
  SALES_TOTALS_MEASURES,
  SALES_TOTALS_METRIC_CODES,
  type SalesTotalsWindow,
} from "@/lib/reporting/sales-totals/metric-map";
import {
  rankSalonsByMetric,
  resolveReportDate,
  resolveSalesTotalsSelection,
  resolveSortField,
  resolveWindow,
} from "@/lib/reporting/read/sales-totals-view";
import { ReportFrame } from "@/features/reports/report-frame";
import { REPORTS } from "@/features/reports/reports-routes";
import {
  SalesTotalsFilterBar,
  type SalesTotalsFilters,
} from "@/features/reports/sales-totals/filter-bar";
import { EstateScopeCards } from "@/features/reports/sales-totals/estate-scope-cards";
import { SelectedSalonCards } from "@/features/reports/sales-totals/selected-salon-cards";
import { SalesTotalsRankingChart } from "@/features/reports/sales-totals/ranking-chart";
import { SalesTotalsSalonTable } from "@/features/reports/sales-totals/salon-table";
import { AskSunnyReportPanel } from "@/features/reports/sales-totals/ask-sunny-panel";
import { requirePagePermission } from "@/lib/auth/page";

/**
 * ============================================================================
 * SALES TOTALS — the daily report
 * ============================================================================
 *
 * One delivery per morning, each carrying two windows: the previous day and
 * month to date through that day.
 *
 * THE PAGE IS TWO SECTIONS BECAUSE THE DATA IS TWO POPULATIONS, and conflating
 * them is what made the first version read as arithmetically broken:
 *
 *   SOURCE ESTATE AVERAGES — All Salons / STC Consolidated / STC Franchisees,
 *   covering 249 / 98 / 151 salons. Verified against both real reports: these
 *   are per-salon AVERAGES, not totals. (98 x 734.50 + 151 x 872.94) / 249 =
 *   818.45, which is exactly the All Salons figure; the sum, 1,607.44, is not.
 *   So a card reading "Grand Total $734.50" beside one salon's $958.79 looked
 *   wrong, and a reader was right to think so.
 *
 *   THIS DELIVERY'S SALONS — the 15 real salon rows, which DO sum. Their total
 *   for 09-02 is $11,838.81, about fifteen times the estate average and not
 *   comparable to it.
 *
 * Neither is derived from the other, and no control mixes them. See
 * `sales-totals-aggregate.ts` for the arithmetic and why PPTA is refused.
 *
 * STILL REFUSED: summing across report dates (MTD is already cumulative), and
 * any trend line from snapshots whose MTD windows overlap.
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
  await requirePagePermission("view_reports");

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
   * RESOLVED THROUGH THE SHARED HELPERS, not inline any more.
   *
   * Ask Sunny's report analysis has to reconstruct exactly this view on the
   * server, and the whole value of that feature is that it is looking at the
   * same numbers the reader is. Two hand-written copies of "which date, which
   * window, which salons" would be two chances to drift, so both callers use
   * `sales-totals-view.ts`.
   */
  const reportDate = resolveReportDate(dates, first(search.date))!;
  const window: SalesTotalsWindow = resolveWindow(first(search.window));

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

  /*
   * Salon selection is a comma-separated list of salon numbers. Unknown entries
   * are dropped rather than erroring: a stale shared link should still open on
   * the salons that do exist. Empty means EVERY salon in the delivery.
   */
  const view = resolveSalesTotalsSelection(snapshot, {
    estateSummaryKey: first(search.scope),
    metric: first(search.metric),
    salonIds: (first(search.salons) ?? "").split(","),
  });

  const scope = view.estateSummary;
  const metric = view.metric;
  const selectedKeys = view.selectedKeys;
  const selectedSalons: readonly SalesTotalsSubject[] = view.selectedSalons;

  const sortField = resolveSortField(first(search.sort), metric.code);

  const filters: SalesTotalsFilters = {
    reportDate,
    window,
    scope: scope?.key ?? "",
    salons: selectedKeys,
    metric: metric.code,
    sort: sortField,
  };

  // THE SELECTED SALONS' OWN FIGURES. Only salon-level facts reach this — the
  // estate summary rows are a different population and never enter it.
  const aggregated = aggregateSalons(selectedSalons, SALES_TOTALS_METRIC_CODES);

  // Shared with the analysis resolver, so a ranking Ask Sunny describes is the
  // ranking on screen.
  const rankingRows = rankSalonsByMetric(selectedSalons, metric.code);

  function sortHref(field: string): string {
    const params = new URLSearchParams();
    params.set("date", reportDate);
    params.set("window", window);
    params.set("scope", filters.scope);
    params.set("metric", metric.code);
    if (selectedKeys.length > 0) params.set("salons", selectedKeys.join(","));
    params.set("sort", field);
    return `${BASE_PATH}?${params.toString()}`;
  }

  return (
    <PermissionGate permission="view_reports">
      <ReportFrame report={REPORT}>
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted-foreground">
            <span className="rounded-full bg-surface-muted px-2 py-0.5 font-medium text-foreground">
              {formatReportDate(snapshot.reportDate)}
            </span>
            <span className="font-medium text-foreground">{snapshot.windowLabel}</span>
            <span aria-hidden>·</span>
            <span>
              {window === "daily"
                ? `The single day of ${formatReportDate(snapshot.reportDate)}`
                : `${formatReportDate(snapshot.monthStart)} through ${formatReportDate(snapshot.reportDate)}`}
            </span>
          </div>

          {/*
            ASK SUNNY IS HANDED THE FILTERS, NOT THE FIGURES.

            Every prop below is a pointer at rows — which date, which window,
            which estate summary card, which measure, which salons. Not one
            number this page rendered is passed, because the server re-reads the
            snapshot for itself and must not be able to be told what it says.
            The same helpers resolved both, so the view it reads is the view on
            screen.
          */}
          <AskSunnyReportPanel
            view={{
              reportDate: snapshot.reportDate,
              window,
              estateSummaryKey: filters.scope,
              metric: metric.code,
              salonIds: selectedKeys,
            }}
          />
        </div>

        <SalesTotalsFilterBar
          base={BASE_PATH}
          filters={filters}
          dates={dates}
          scopes={snapshot.summaries}
          salons={snapshot.salons}
        />

        {/*
          AN EXPLICIT SELECTION THAT MATCHED NOTHING SHOWS NOTHING, and says so.

          It used to fall through to every salon in the delivery, because the
          code decided "all" from "no keys survived" rather than from "no keys
          were asked for". A link naming a salon this delivery does not carry
          then quietly answered a much broader question than the one in the URL.
          The dashboard and the analyser both refuse it now, so they still agree
          about what a set of filters means.
        */}
        {view.selectionInvalid ? (
          <Notice tone="attention" title="None of the selected salons are in this delivery">
            The link asked for{" "}
            {view.unknownSalonIds.length === 1 ? "a salon" : "salons"} this Sales
            Totals delivery does not carry, so nothing is selected. Clear the
            salon filter to see all {snapshot.salons.length} salons in the
            delivery.
          </Notice>
        ) : null}

        {/* ---------------------------------------------------------------
            A. THIS DELIVERY'S SALONS. First, because it is the question a
            manager actually came with, and because these are the only figures
            on the page that add up.
            --------------------------------------------------------------- */}
        <section className="space-y-3">
          <SectionHeader
            title={selectionHeading(selectedSalons, snapshot.salons.length)}
            description={
              selectedSalons.length > 1
                ? `Totals across the selected salons' own reported figures, for the ${snapshot.windowLabel.toLowerCase()} window.`
                : `This salon's own reported figures for the ${snapshot.windowLabel.toLowerCase()} window.`
            }
          />
          <SelectedSalonCards
            figures={aggregated}
            window={window}
            reportDate={formatReportDate(snapshot.reportDate)}
            monthStart={formatReportDate(snapshot.monthStart)}
          />
        </section>

        {/* ---------------------------------------------------------------
            B. THE SOURCE ESTATE. Visually separated and labelled as averages,
            because the numbers here are a different population and a different
            KIND of number from section A.
            --------------------------------------------------------------- */}
        <EstateScopeCards
          scopes={snapshot.summaries}
          activeScopeKey={scope?.key ?? null}
          metric={metric}
          deliverySalonCount={snapshot.salons.length}
        />

        {/* C. The selected salons, ranked on the chosen metric. */}
        <section className="space-y-3">
          <SectionHeader
            title={`${metric.label} by salon`}
            description={`${snapshot.windowLabel} figures for ${selectedSalons.length} of the ${snapshot.salons.length} salons in this delivery, ranked. A snapshot of one date — not a trend.`}
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
            description="Sortable. No totals row here: the section above carries the totals, and PPTA has none that can be computed."
          />
          <Card>
            <CardContent className="p-0">
              <SalesTotalsSalonTable
                salons={sortSalons(selectedSalons, sortField)}
                metrics={SALES_TOTALS_MEASURES.map((measure) => ({
                  code: measure.code,
                  label: measure.label,
                  unit: measure.unit,
                }))}
                sortField={sortField}
                sortHref={sortHref}
                activeSalon={selectedKeys.length === 1 ? selectedKeys[0] : null}
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
              <Lineage label="Estate scopes reported" value={String(snapshot.summaries.length)} />
              <Lineage label="Salons in this delivery" value={String(snapshot.salons.length)} />
              {/*
                The SOURCE COLUMN NAMES, kept verbatim. "Grand Total" is what
                the report's own header says, and that belongs here where it can
                be checked against the file — not on a card, where it would
                describe the value wrongly.
              */}
              <Lineage
                label="Source columns"
                value={SALES_TOTALS_MEASURES.map((measure) => measure.header).join(", ")}
              />
              <Lineage
                label="Summary block semantics"
                value="Per-salon averages, with salon counts"
              />
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
