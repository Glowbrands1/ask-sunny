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
  isHeadlineSalesMeasure,
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
import {
  AdminOnly,
  ExplainerNote,
  ReportDetailSection,
} from "@/features/reports/detail-section";
import { viewerIsAdmin } from "@/lib/auth/admin-view";
import { ReportFreshnessLine } from "@/features/reports/freshness-line";
import { REPORT_FAMILIES_BY_ID } from "@/lib/reporting/read/report-families";
import { AskSunnyAboutReport } from "@/features/reports/ask-sunny-about-report";
import { REPORTS } from "@/features/reports/reports-routes";
import {
  SalesTotalsFilterBar,
  type SalesTotalsFilters,
} from "@/features/reports/sales-totals/filter-bar";
import { EstateScopeCards } from "@/features/reports/sales-totals/estate-scope-cards";
import { ReportInterpretationPanel } from "@/features/reports/interpretation-panel";
import { interpretSalesTotals } from "@/lib/reporting/read/sales-totals-interpretation";
import { SelectedSalonCards } from "@/features/reports/sales-totals/selected-salon-cards";
import { SalesTotalsRankingChart } from "@/features/reports/sales-totals/ranking-chart";
import { SalesTotalsSalonTable } from "@/features/reports/sales-totals/salon-table";
import { requirePagePermission } from "@/lib/auth/page";
import { resolveReportingScope } from "@/lib/reporting/scope/server";
import { scopeNoticeSentence } from "@/lib/reporting/scope/authorized-salons";

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

  /*
   * THE CALLER'S AUTHORIZED SALONS, APPLIED IN THE QUERY.
   *
   * The review found a one-salon account reading every salon's figures on the
   * reporting tabs. The narrowing happens inside `loadSalesTotals`, so the rows
   * are never selected rather than being selected and hidden. The chain's own
   * estate summary rows survive it — they are per-salon averages that name
   * nobody, the same class of figure as a peer benchmark.
   */
  const access = await resolveReportingScope();
  /* Editorial, not a gate — see `lib/auth/admin-view.ts`. */
  const isAdmin = await viewerIsAdmin();

  /*
   * NO ASSIGNMENT IS NOT "NO REPORT". Both leave the page empty and they need
   * different sentences: one is fixed by an administrator in User Management,
   * the other by a delivery arriving.
   */
  if (!access.unrestricted && access.salonNumbers.length === 0) {
    return (
      <ReportFrame report={REPORT}>
        <Notice tone="attention" title="No salon is assigned to your account">
          {scopeNoticeSentence(access)}
        </Notice>
      </ReportFrame>
    );
  }

  const snapshot = await loadSalesTotals({
    reportDate,
    window,
    authorizedSalonNumbers: access.unrestricted ? null : access.salonNumbers,
  });
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

  /*
   * FOUR CARDS LAND, TWO OPEN. Split from the SAME aggregation rather than by
   * aggregating twice, so the landing row and the disclosure cannot disagree
   * about a figure, and so the plain-language reading below still sees all six.
   */
  const headlineFigures = aggregated.filter((figure) =>
    isHeadlineSalesMeasure(figure.metricCode),
  );
  const secondaryFigures = aggregated.filter(
    (figure) => !isHeadlineSalesMeasure(figure.metricCode),
  );

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
      <ReportFrame
        report={REPORT}
        action={
          /*
            POINTERS AT THE VIEW, NOT THE VIEW'S NUMBERS.

            The in-panel analyser below answers about THIS view; this hands the
            same view to Chat, which can also reach the Comp Report's trend and
            the Knowledge Base. Both send filters and neither sends a figure.
          */
          <AskSunnyAboutReport
            context={{
              family: "sales-totals",
              period: snapshot.reportDate,
              window,
              salons: selectedKeys,
              districts: [],
              metric: metric.code,
              view: filters.scope || null,
            }}
          />
        }
        /*
          THE ONE FRESHNESS LINE, and the REFRESH TIMESTAMP this tab did not
          have. The review: "Sales Totals has no refresh timestamp. It is the
          only tab missing one, and it is also the report people will check
          daily." It was missing because the chips carried the report DATE four
          different ways and never the ingestion instant — which is a different
          fact and the one that answers "has this morning's delivery landed".

          `lineage.ingestedAt` is the stored instant, rendered in Central Time.
        */
        provenance={
          <ReportFreshnessLine
            facts={{
              dataThrough: snapshot.reportDate,
              refreshedAt: snapshot.lineage.ingestedAt,
              salonCount: snapshot.salons.length,
              cadence: REPORT_FAMILIES_BY_ID["sales-totals"].cadence,
              scopeLabel: access.unrestricted ? null : access.areaLabel,
            }}
            detail={
              window === "daily"
                ? `${snapshot.windowLabel} · the single day of ${formatReportDate(snapshot.reportDate)}`
                : `${snapshot.windowLabel} · ${formatReportDate(snapshot.monthStart)} through ${formatReportDate(snapshot.reportDate)}`
            }
          />
        }
        filters={
          <SalesTotalsFilterBar
            base={BASE_PATH}
            filters={filters}
            dates={dates}
            scopes={snapshot.summaries}
            salons={snapshot.salons}
          />
        }
      >
        {/*
          ==================================================================
          ONE ASK SUNNY CONTROL, AND IT IS THE SHARED ONE
          ==================================================================

          THE REVIEW: "There are two separate 'Ask Sunny About This Report'
          buttons on the same screen. This only happens on Sales Totals. Salon
          Performance, Bed Usage, Spa Wellness, and Spa Engagement each have
          just the yellow bar."

          The second was `AskSunnyReportPanel`, an in-page side panel that
          answers about THIS view. It is genuinely useful and it is genuinely a
          second control with the same label in the same place, which is what a
          manager reads as a duplicate. The shared bar in the band wins because
          it is the pattern on the other four tabs and because it reaches the
          Comp Report's trend and the knowledge base as well as this snapshot.

          THE PANEL IS NOT DELETED. Its component, its API route, its grounding
          and its tests are untouched and still covered — the decision here is
          about which control this page MOUNTS, and mounting it again later is
          one line. Deleting a working analyser to resolve a duplicate-label
          complaint would be the wrong trade.
        */}

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

        {/*
          ONE PLAIN-LANGUAGE READING. This is the daily report and the only one
          whose figures are money, so the reading names the flagged PPTAs FIRST
          — before any comparison that might otherwise have used one — and
          attempts no period comparison at all, because the delivery carries one
          date and its month to date and nothing to compare them with.
        */}
        <ReportInterpretationPanel
          reading={interpretSalesTotals({
            salons: selectedSalons,
            figures: aggregated,
            windowLabel: snapshot.windowLabel,
            deliverySalonCount: snapshot.salons.length,
          })}
        />

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
            figures={headlineFigures}
            window={window}
            reportDate={formatReportDate(snapshot.reportDate)}
            monthStart={formatReportDate(snapshot.monthStart)}
          />
        </section>

        {/*
          THE OTHER TWO MEASURES, ONE CLICK AWAY AND OTHERWISE UNCHANGED.

          The review asked each report to land on four headline metrics. This
          one carries six and showed all six as equal cards, so nothing on the
          page said which number a manager came for. New Customers and Sunless
          Sessions describe particular slices rather than the day; a manager
          wanting either is looking for it deliberately.

          NOTHING IS REMOVED. Both keep their label, their formula, their
          aggregation rule and their place in the table below, in the briefing
          and in the analyser. See `SALES_TOTALS_HEADLINE_CODES`.
        */}
        {secondaryFigures.length > 0 ? (
          <ReportDetailSection
            title="New customers and sunless"
            weight={`${secondaryFigures.length} ${
              secondaryFigures.length === 1 ? "measure" : "measures"
            }`}
            description="The two measures that describe a slice of the day rather than the day itself."
          >
            <SelectedSalonCards
              figures={secondaryFigures}
              window={window}
              reportDate={formatReportDate(snapshot.reportDate)}
              monthStart={formatReportDate(snapshot.monthStart)}
            />
          </ReportDetailSection>
        ) : null}

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

        {/* D. Everything, sortable — the drill-down. */}
        {/*
          BEHIND A DISCLOSURE, NOT DELETED. The review: "Every report currently
          opens at maximum detail... The detailed work is valuable; it just
          should not be the landing view." The cards and the ranking chart above
          are the landing view; every salon and every measure is one click away
          and unchanged.

          OPEN BY DEFAULT ON A SHORT SELECTION. A table of one or two salons
          behind a disclosure is a click that buys nothing, and the point is to
          stop a long table being the first thing on the page.
        */}
        <ReportDetailSection
          title="All measures by salon"
          weight={`${selectedSalons.length} ${selectedSalons.length === 1 ? "salon" : "salons"}`}
          defaultOpen={selectedSalons.length <= 3}
          description="Sortable. No totals row here: the section above carries the combined figures, including the tans-weighted PPTA."
        >
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
          <ExplainerNote className="mt-3" label="What PPTA is, and what it is not">
            PPTA is <span className="font-medium">product sales divided by total
            tans</span> — the product revenue earned per tanning session. It is
            not the average ticket, and it does not reconcile to Grand Total ÷
            Tans, because Grand Total is all sales while PPTA&rsquo;s numerator is
            product sales only. Across several salons it is combined as total
            product sales over total tans, which weights each salon by its own
            tans; a plain average of the column would weight a 46-tan salon the
            same as a 251-tan one.
          </ExplainerNote>
        </ReportDetailSection>

        {/* E. Where these figures came from. */}
        {/*
          ENGINEERING LINEAGE, ADMIN-ONLY. The review: "'Data Source & Quality,'
          including the parser name, parser version, and source columns, is
          engineering-facing information and should be admin-only." Gated rather
          than deleted: it is how an operator answers "where did this number
          come from" without reopening the delivery.
        */}
        <AdminOnly isAdmin={isAdmin}>
          <section className="space-y-3">
          <SectionHeader title="Data source & quality" description="Lineage for this delivery." />
          <Card>
            <CardContent className="grid gap-x-8 gap-y-2 p-4 text-[12px] sm:grid-cols-2">
              <Lineage label="Report date (as printed)" value={snapshot.reportDateRaw} />
              <Lineage label="Report date (resolved)" value={snapshot.reportDate} />
              <Lineage label="MTD window opens" value={snapshot.monthStart} />
              <Lineage label="Window shown" value={snapshot.windowLabel} />
              <Lineage
                label="Chain-wide scopes reported"
                value={String(snapshot.summaries.length)}
              />
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
        </AdminOnly>
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
