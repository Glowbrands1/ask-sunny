import type { Metadata } from "next";
import Link from "next/link";

import { PermissionGate } from "@/components/permission-gate";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState, Notice } from "@/components/ui/feedback";
import { PageHeader, PageShell, SectionHeader } from "@/components/ui/layout";
import {
  SUPABASE_URL_ENV,
  supabaseSecretKeyConfigured,
} from "@/lib/config/server-env";
import {
  buildSalonKpis,
  buildSalonMetricRows,
  buildSalonWindowComparisons,
  CURRENT_BASIS_YEAR,
  HEADLINE_METRIC_CODES,
  reportedComparisons,
  serializeReportFilters,
  windowCaveatSentence,
  windowMetricCodeList,
  windowMetricCodes,
  type SalonWindowComparison,
} from "@/lib/reporting/read";
import { loadReportContext } from "@/lib/reporting/read/report-context";
import { SALON_NUMBER_PATTERN } from "@/lib/reporting/salon-number";
import { DataSourcePanel } from "@/features/reports/salon-performance/data-source-panel";
import { SalonComparisonChart } from "@/features/reports/salon-performance/salon-comparison-chart";
import { SalonComparisonTable } from "@/features/reports/salon-performance/salon-comparison-table";
import { SalonHeader } from "@/features/reports/salon-performance/salon-header";
import { SalonKpiCards } from "@/features/reports/salon-performance/salon-kpi-cards";
import { SalonMetricTable } from "@/features/reports/salon-performance/salon-metric-table";
import { requirePagePermission } from "@/lib/auth/page";

/**
 * SALON PERFORMANCE — ONE SALON.
 *
 * Reached by clicking a salon on the dashboard, which hands over its whole
 * filter set in the URL. That is the design: this page resolves period, window,
 * sheet and measure through the SAME loader the dashboard uses
 * (`read/report-context.ts`), so the figures here are the figures behind the
 * row that was clicked. Back returns to the dashboard exactly as it was left.
 *
 * The gate over `/reports/salon-performance/*` covers this route automatically —
 * `src/middleware.ts` matches the prefix and everything nested under it, so this
 * page was protected the moment it existed rather than the moment somebody
 * remembered to add it to a list.
 *
 * WHAT THIS PAGE WILL NOT DO, each for a stated reason:
 *
 *   No line chart across windows. `Last 3 Months` and `Last 6 Months` are two
 *   figures the source calculated over overlapping spans, not two points in
 *   time; a line between them is the most convincing wrong chart this data can
 *   produce.
 *   No MTD figure beside a YTD one. The windows come from one period's
 *   catalogue, so a month-to-date period offers only month-to-date comparisons.
 *   No recomputed rank or quintile. Both are reported chain-wide upstream.
 *   No zero standing in for a missing figure — `Unavailable`, with the reason.
 *   No substitution of a different salon, period, measure, window or basis
 *   year when the one asked for is not there.
 *
 * READING ORDER: who this salon is, the four headline measures, the comparisons
 * the report offers, every figure it holds, and provenance last and closed.
 */
export const dynamic = "force-dynamic";

const BASE_PATH = "/reports/salon-performance";

export const metadata: Metadata = {
  title: "Salon detail",
};

function Frame({ children, backHref }: { children: React.ReactNode; backHref?: string }) {
  return (
    <PageShell className="space-y-6">
      <PageHeader
        eyebrow="Reporting"
        title="Salon detail"
        description="Comparable-store (same-store) sales for one salon, from the ingested Comp Report."
      />
      {children}
      <Link
        href={backHref ?? BASE_PATH}
        className="inline-block text-[13px] font-medium text-muted-foreground underline decoration-border-strong underline-offset-2 transition-colors hover:text-foreground"
      >
        Back to Salon Performance
      </Link>
    </PageShell>
  );
}

export default async function SalonDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ salon: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePagePermission("view_reports");

  const { salon: rawSalon } = await params;
  const search = await searchParams;

  if (!process.env[SUPABASE_URL_ENV] || !supabaseSecretKeyConfigured()) {
    return (
      <Frame>
        <Notice tone="attention" title="Supabase is not configured in this runtime">
          This page reads ingested reporting data directly, so it needs the
          server-side Supabase configuration in whichever environment served it.
          Nothing is wrong with the report or the data — {SUPABASE_URL_ENV} and the
          Supabase secret key are missing here. An administrator can add them;
          there is nothing for a reader to do and no other address to try.
        </Notice>
      </Frame>
    );
  }

  /**
   * THE SALON NUMBER, VALIDATED BEFORE IT REACHES A QUERY.
   *
   * Decoded because a path segment is percent-encoded, then checked against the
   * schema's own key format. A segment that is not a salon number is refused
   * here — it never becomes a filter, and it never returns "no figures found"
   * in a way that could be mistaken for a salon with no data.
   *
   * TEXT THROUGHOUT. `0468` is compared as the string it is; coercing it to a
   * number would match a different salon or none at all.
   */
  let salonNumber: string;
  try {
    salonNumber = decodeURIComponent(rawSalon);
  } catch {
    salonNumber = rawSalon;
  }

  if (!SALON_NUMBER_PATTERN.test(salonNumber)) {
    return (
      <Frame>
        <Notice tone="attention" title="That is not a salon number">
          The address does not contain a salon number this report could hold. Nothing is
          shown rather than a guess at which salon was meant.
        </Notice>
      </Frame>
    );
  }

  const loaded = await loadReportContext(search);

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

  if (loaded.status === "no_comparisons") {
    return (
      <Frame>
        <Notice tone="attention" title="This period holds no comparisons yet">
          Figures for this period have been loaded, but none of the workbook&apos;s comparison
          columns are among them, so there is nothing to compare.
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
    activeWindow,
    activeSheet,
    catalogue,
    sheetCatalogue,
    measures,
    measureCodes,
    selectedMetric,
    allSalons,
    windows,
  } = loaded.context;

  /**
   * Back to the dashboard, carrying the SANITIZED filters.
   *
   * Sanitized rather than raw, so a stale link followed into this page returns
   * to a dashboard that works. This is what makes Back restore the filtered
   * view a manager left rather than resetting it: period, window, measure,
   * districts, salon selection and sort all travel in the query string, and the
   * dashboard reads exactly the same set back.
   */
  const backQuery = serializeReportFilters(active).toString();
  const backHref = backQuery ? `${BASE_PATH}?${backQuery}` : BASE_PATH;

  /**
   * IS THIS SALON IN THIS PERIOD?
   *
   * A different question from whether the salon exists. A salon can be in the
   * August report and not the July one, and following an August link with a
   * `?period=` for July has to say so rather than render a page of blanks that
   * looks like a data failure.
   */
  const salon = allSalons.find((entry) => entry.salonNumber === salonNumber) ?? null;

  if (!salon) {
    return (
      <Frame backHref={backHref}>
        <Notice tone="attention" title={`Salon ${salonNumber} is not in this report`}>
          The selected period ({scope.periodLabel}) does not include this salon, so it has
          no figures here. Nothing from another period is substituted, because those figures
          would be wrong under this heading. Try another period, or go back to the salons
          this report does cover.
        </Notice>
      </Frame>
    );
  }

  /**
   * EVERY CODE THIS PAGE COULD NEED, IN ONE QUERY.
   *
   * Two demands, unioned:
   *
   *   The whole active sheet, so "every figure the report holds for this salon"
   *   is the sheet's actual contents rather than a list somebody maintained.
   *
   *   Every headline measure under every window, because the comparison section
   *   reaches across sheets — `vs 2024` lives on one, `Last 3 Months` on
   *   another. Fetched WITHOUT a sheet restriction for that reason, and each
   *   figure is then read back through the sheet its own window names.
   */
  const comparisonMeasures = HEADLINE_METRIC_CODES.filter((code) =>
    catalogue.some(
      (metric) => metric.code === code || metric.comparisonOfCode === code,
    ) || measureCodes.includes(code),
  );

  const factCodes = [
    ...new Set([
      ...sheetCatalogue.map((metric) => metric.code),
      ...[...comparisonMeasures, ...(selectedMetric ? [selectedMetric.code] : [])].flatMap(
        (code) => windows.flatMap((window) => windowMetricCodeList(code, window, CURRENT_BASIS_YEAR)),
      ),
    ]),
  ];

  const [facts, sheetIngestionId] = await Promise.all([
    repository.getFactRows({
      periodId: scope.periodId,
      metricCodes: factCodes,
      // One salon. The filter bar's salon selection is deliberately NOT applied
      // here: a manager who clicked this salon has already selected it, and
      // applying the list as well would blank the page for a salon they reached
      // from a district filter that did not name it.
      salonNumbers: [salonNumber],
    }),
    activeSheet ? repository.getSheetIngestionId(scope.periodId, activeSheet) : null,
  ]);

  /*
   * The active sheet's own facts, for anything shown under the active
   * comparison's heading. The unfiltered set is used only by the comparison
   * section, which reads each window from the sheet that window names.
   */
  const sheetFacts = activeSheet
    ? facts.filter((fact) => fact.sourceSheet === activeSheet)
    : facts;

  /**
   * A. HEADLINE MEASURES, filtered to what this comparison reports.
   *
   * On the trailing-window comparisons the source reports Total Revenue and
   * Total Tans only, so asking for all four there would leave an empty row. The
   * two it does report, plus a line naming the two it does not, is the honest
   * version of that — the same rule the dashboard follows.
   */
  const kpiCodes = HEADLINE_METRIC_CODES.filter((code) => measureCodes.includes(code));
  const kpiOmitted = HEADLINE_METRIC_CODES.filter((code) => !measureCodes.includes(code));
  const omittedDefinitions = await repository.getMetricDefinitions(kpiOmitted);
  const measureLabel = (code: string) =>
    omittedDefinitions.find((metric) => metric.code === code)?.label ?? code;

  const kpis = buildSalonKpis({
    metricCodes: kpiCodes,
    // Both halves, as on the dashboard: `sheetCatalogue` carries the windowed
    // codes that decide availability, `measures` the base-measure definitions
    // which on a rolling sheet exist only in the reviewed vocabulary.
    catalogue: [...sheetCatalogue, ...measures],
    facts: sheetFacts,
    window: activeWindow,
    currentYear: CURRENT_BASIS_YEAR,
  });

  /** B. Every figure the report holds for this salon on the active sheet. */
  const metricRows = buildSalonMetricRows({
    catalogue: sheetCatalogue,
    facts: sheetFacts,
    currentYear: CURRENT_BASIS_YEAR,
  });

  /**
   * C. Each headline measure against every comparison the period offers.
   *
   * One entry per measure, each with its own unit — which is why these are
   * separate charts rather than one. Total Revenue in dollars and Total Tans in
   * counts cannot share a Y axis without making one of them unreadable.
   */
  const byMeasure: {
    code: string;
    label: string;
    unit: (typeof measures)[number]["unit"];
    higherIsBetter: boolean | null;
    comparisons: SalonWindowComparison[];
  }[] = [];

  for (const code of comparisonMeasures) {
    const definition =
      measures.find((metric) => metric.code === code) ??
      catalogue.find((metric) => metric.code === code) ??
      omittedDefinitions.find((metric) => metric.code === code);
    // No approved definition means no label and no unit, so no honest chart.
    if (!definition) continue;

    const comparisons = buildSalonWindowComparisons({
      metricCode: code,
      windows,
      catalogue,
      facts,
      currentYear: CURRENT_BASIS_YEAR,
    });

    byMeasure.push({
      code,
      label: definition.label,
      unit: definition.unit,
      higherIsBetter: definition.higherIsBetter,
      comparisons,
    });
  }

  const plottable = byMeasure.filter(
    (entry) => reportedComparisons(entry.comparisons).length > 0,
  );
  const notReported = byMeasure.filter(
    (entry) => reportedComparisons(entry.comparisons).length === 0,
  );

  /** The selected measure's comparisons, listed in full including the gaps. */
  const selectedComparisons = selectedMetric
    ? (byMeasure.find((entry) => entry.code === selectedMetric.code)?.comparisons ??
      buildSalonWindowComparisons({
        metricCode: selectedMetric.code,
        windows,
        catalogue,
        facts,
        currentYear: CURRENT_BASIS_YEAR,
      }))
    : [];

  const quality = sheetIngestionId
    ? await repository.getSourceQuality(sheetIngestionId)
    : null;

  const caveat = windowCaveatSentence(activeWindow);

  /** The displayed measure's own column, for the provenance panel. */
  const displayedCodes = selectedMetric
    ? windowMetricCodes(selectedMetric.code, activeWindow, CURRENT_BASIS_YEAR)
    : null;
  const displayedFact = displayedCodes
    ? (sheetFacts.find(
        (fact) =>
          fact.metricCode === displayedCodes.currentCode &&
          fact.basisYear === displayedCodes.currentBasisYear,
      ) ?? null)
    : null;

  return (
    <PermissionGate permission="view_reports">
      <PageShell className="space-y-5">
        <SalonHeader salon={salon} scope={scope} backHref={backHref} />


        {ignored.length + dropped.length > 0 ? (
          <Notice tone="neutral" title="Some filters in this link were adjusted">
            {[
              ...dropped,
              ...(ignored.length > 0
                ? [`${ignored.length} value${ignored.length === 1 ? "" : "s"} this report does not recognise`]
                : []),
            ].join("; ")}
            . The nearest valid view of this report is shown.
          </Notice>
        ) : null}

        {caveat ? <Notice tone="attention">{caveat}</Notice> : null}

        {/* A. The headline measures for this salon. */}
        <section className="space-y-3">
          <SectionHeader
            title="Headline measures"
            description={`This salon's own reported figures · ${activeWindow.label}`}
          />
          {kpis.length > 0 ? (
            <SalonKpiCards
              kpis={kpis}
              windowShortLabel={activeWindow.shortLabel}
              sourceReport={quality?.originalFilename ?? null}
            />
          ) : (
            <Notice tone="neutral">
              The source report carries none of the headline measures for{" "}
              {activeWindow.label}. Nothing is substituted in their place.
            </Notice>
          )}
          {kpiOmitted.length > 0 ? (
            <p className="text-xs text-muted-foreground">
              {kpiOmitted.map((code) => measureLabel(code)).join(", ")}{" "}
              {kpiOmitted.length === 1 ? "is" : "are"} not reported for {activeWindow.label},
              so {kpiOmitted.length === 1 ? "it is" : "they are"} not shown here. Nothing is
              substituted in their place.
            </p>
          ) : null}
        </section>

        {/* B. Comparison by window, one chart per measure so units stay honest. */}
        {plottable.length > 0 ? (
          <section className="space-y-3">
            <SectionHeader
              title="Comparison by window"
              description="Each pair is two figures the source calculated for this salon. Not a trend — this report covers one period, and the trailing windows overlap."
            />
            <div className="grid gap-3 lg:grid-cols-2">
              {plottable.map((entry) => (
                <Card key={entry.code}>
                  <CardContent className="space-y-2">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {entry.label}
                    </p>
                    <SalonComparisonChart
                      comparisons={entry.comparisons}
                      unit={entry.unit}
                      metricLabel={entry.label}
                    />
                  </CardContent>
                </Card>
              ))}
            </div>
            {notReported.length > 0 ? (
              <p className="text-xs text-muted-foreground">
                {notReported.map((entry) => entry.label).join(", ")}{" "}
                {notReported.length === 1 ? "has" : "have"} no comparison figures for this
                salon in this report, so {notReported.length === 1 ? "it is" : "they are"} not
                charted.
              </p>
            ) : null}
          </section>
        ) : null}

        {/* C. The selected measure's comparisons in full, gaps included. */}
        {selectedMetric && selectedComparisons.length > 0 ? (
          <section className="space-y-3">
            <SectionHeader
              title={`${selectedMetric.label} — every comparison in this report`}
              description="Including the comparisons the source does not report for this measure, which say so rather than being hidden."
            />
            <SalonComparisonTable
              comparisons={selectedComparisons}
              unit={selectedMetric.unit}
              metricLabel={selectedMetric.label}
              higherIsBetter={selectedMetric.higherIsBetter}
              sourceReport={quality?.originalFilename ?? null}
            />
            <p className="text-xs text-muted-foreground">
              * Computed from the two figures in this report, because the source did not
              state a change. Everything else is the source&apos;s own figure.
            </p>
          </section>
        ) : null}

        {/* D. Everything the report holds for this salon. */}
        <section className="space-y-3">
          <SectionHeader
            title="All reported figures"
            description={`Every figure this report holds for this salon under ${activeWindow.label}. Measures from another comparison appear under that comparison.`}
          />
          <SalonMetricTable
            rows={metricRows}
            sourceReport={quality?.originalFilename ?? null}
            windowLabel={activeWindow.label}
          />
        </section>

        {/* E. Provenance, last and closed. */}
        <DataSourcePanel
          scope={scope}
          quality={quality}
          activeSheet={activeSheet}
          displayedMetric={
            selectedMetric
              ? {
                  label: selectedMetric.label,
                  sourceSheet: displayedFact?.sourceSheet ?? activeSheet,
                  sourceColumn: displayedFact?.sourceColumn ?? null,
                  basisYears: selectedMetric.availableBasisYears,
                }
              : null
          }
        />
      </PageShell>
    </PermissionGate>
  );
}
