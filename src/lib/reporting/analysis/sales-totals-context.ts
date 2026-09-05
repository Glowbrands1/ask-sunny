import "server-only";

import {
  aggregateSalons,
  figureHeading,
  selectionHeading,
  type AggregatedFigure,
} from "../read/sales-totals-aggregate";
import {
  formatReportDate,
  listSalesTotalsDates,
  loadSalesTotals,
  type SalesTotalsSnapshot,
  type SalesTotalsSubject,
} from "../read/sales-totals-read";
import {
  rankSalonsByMetric,
  resolveReportDate,
  resolveSalesTotalsSelection,
  resolveWindow,
  type SalesTotalsViewRequest,
} from "../read/sales-totals-view";
import {
  SALES_TOTALS_MEASURES_BY_CODE,
  SALES_TOTALS_METRIC_CODES,
} from "../sales-totals/metric-map";

/**
 * ============================================================================
 * WHAT ASK SUNNY IS ALLOWED TO KNOW ABOUT A SALES TOTALS VIEW.
 * ============================================================================
 *
 * The browser says WHICH view it is looking at. It never says what the numbers
 * are. This module reloads the report from Supabase, reconstructs the reader's
 * selection with the same helpers the dashboard uses, and builds a bounded
 * text block for the model.
 *
 * That split is the whole security model of the feature. A request can ask for
 * a date, a window, an estate summary card, a metric and a list of salon
 * numbers — all of which are questions. It cannot assert an answer: there is no
 * field on the request through which a figure could arrive, and nothing here
 * reads one.
 *
 * ============================================================================
 * THE SEMANTICS THAT MUST SURVIVE THE TRIP TO THE MODEL
 * ============================================================================
 *
 * The dashboard is careful about four things, and a summary that lost any of
 * them would be confidently wrong rather than merely unhelpful:
 *
 *   TWO POPULATIONS. The estate summary rows are per-salon AVERAGES over the
 *   whole estate; the salon rows are this delivery's own salons. Neither is
 *   derived from the other and they are not comparable. They are sent in
 *   separate sections, each labelled with what it is.
 *
 *   PPTA IS NOT COMBINABLE. Money per transaction needs transaction counts as
 *   weights, and the report does not publish them. The aggregate layer refuses
 *   it and states the reason; that refusal is passed through verbatim rather
 *   than being quietly replaced with a plain mean.
 *
 *   MISSING IS NOT ZERO. A blank cell is "not reported". It is rendered as
 *   "not reported" and excluded from counts, never printed as 0.
 *
 *   MTD IS ALREADY CUMULATIVE. One date, one window, and no function here can
 *   reach a second snapshot — `loadSalesTotals` takes a single date, so the
 *   shape of the API is the safeguard rather than a rule somebody has to
 *   remember.
 */

/** Why a view could not be resolved. Each needs a different sentence. */
export type AnalysisContextFailure =
  /** No Sales Totals has ever been ingested. */
  | "no_reports"
  /** That date has no snapshot for that window. */
  | "no_snapshot"
  /** The snapshot exists but carries no salon rows to analyse. */
  | "no_salon_data";

export interface SalesTotalsProvenance {
  readonly reportType: "Sales Totals";
  readonly reportDate: string;
  readonly reportDateLabel: string;
  readonly window: "daily" | "mtd";
  readonly windowLabel: string;
  readonly salonCount: number;
  /** True when the selection is the whole delivery rather than a subset. */
  readonly isAllSalons: boolean;
  readonly selectedMetric: string;
  readonly estateSummaryLabel: string | null;
}

export interface SalesTotalsAnalysisContext {
  readonly ok: true;
  /** The bounded text handed to the model. */
  readonly grounding: string;
  readonly provenance: SalesTotalsProvenance;
}

export type SalesTotalsAnalysisResult =
  | SalesTotalsAnalysisContext
  | { readonly ok: false; readonly failure: AnalysisContextFailure };

/**
 * How many salon rows may be spelled out in full.
 *
 * This delivery carries fifteen, so the cap is not reached today. It exists so
 * that a larger delivery degrades DETERMINISTICALLY — by ranking on the
 * selected measure and keeping the extremes, which is what a question like
 * "which salons need attention" is about — rather than by silently dropping
 * whichever rows happened to come last.
 */
const MAX_SALON_ROWS = 60;

/** Number for a reader: money to 2dp with separators, counts plain. */
function formatValue(value: number | null, unit: "currency" | "count"): string {
  if (value === null) return "not reported";
  return unit === "currency"
    ? `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : value.toLocaleString("en-US");
}

/** One salon's row: every measure, in report order. */
function salonLine(salon: SalesTotalsSubject): string {
  const figures = SALES_TOTALS_METRIC_CODES.map((code) => {
    const measure = SALES_TOTALS_MEASURES_BY_CODE[code];
    const figure = salon.figures.find((entry) => entry.metricCode === code);
    return `${measure.label}: ${formatValue(figure?.value ?? null, measure.unit)}`;
  });
  return `- ${salon.label} (#${salon.salonNumber ?? salon.key}) — ${figures.join(" | ")}`;
}

/** One combined figure, carrying its basis so the model cannot misread it. */
function aggregateLine(figure: AggregatedFigure, salonsSelected: number): string {
  const measure = SALES_TOTALS_MEASURES_BY_CODE[figure.metricCode];
  const heading = figureHeading(measure, "salon", salonsSelected);

  if (figure.basis === "not_aggregatable") {
    return `- ${heading}: NOT AVAILABLE across multiple salons. ${figure.reason ?? ""}`.trim();
  }

  const reported =
    figure.reportingSalons === figure.selectedSalons
      ? `${figure.reportingSalons} of ${figure.selectedSalons} salons reported`
      : `${figure.reportingSalons} of ${figure.selectedSalons} salons reported — the rest did not report this measure and are NOT counted as zero`;

  const mean =
    figure.meanPerSalon !== null
      ? ` (mean per reporting salon ${formatValue(figure.meanPerSalon, figure.unit)})`
      : "";

  return `- ${heading}: ${formatValue(figure.value, figure.unit)}${mean} — ${reported}`;
}

/**
 * Resolves a requested view into grounding text, or says why it cannot.
 *
 * Every number in the returned text came from `loadSalesTotals` in this call.
 * Nothing is carried over from a previous request and nothing arrives from the
 * caller.
 */
export async function resolveSalesTotalsAnalysisContext(
  request: SalesTotalsViewRequest,
): Promise<SalesTotalsAnalysisResult> {
  const dates = await listSalesTotalsDates();
  const reportDate = resolveReportDate(dates, request.reportDate);
  if (!reportDate) return { ok: false, failure: "no_reports" };

  const window = resolveWindow(request.window);

  // ONE DATE, ONE WINDOW. There is no call available here that could reach a
  // second snapshot and add it to this one.
  const snapshot = await loadSalesTotals({ reportDate, window });
  if (!snapshot) return { ok: false, failure: "no_snapshot" };

  const view = resolveSalesTotalsSelection(snapshot, request);
  if (view.selectedSalons.length === 0) return { ok: false, failure: "no_salon_data" };

  return {
    ok: true,
    grounding: buildGrounding(snapshot, view),
    provenance: {
      reportType: "Sales Totals",
      reportDate: snapshot.reportDate,
      reportDateLabel: formatReportDate(snapshot.reportDate),
      window: snapshot.window,
      windowLabel: snapshot.windowLabel,
      salonCount: view.selectedSalons.length,
      isAllSalons: view.isAllSalons,
      selectedMetric: view.metric.label,
      estateSummaryLabel: view.estateSummary?.label ?? null,
    },
  };
}

/** The bounded text block. Deterministic for a given snapshot and selection. */
function buildGrounding(
  snapshot: SalesTotalsSnapshot,
  view: ReturnType<typeof resolveSalesTotalsSelection>,
): string {
  const { selectedSalons, metric, estateSummary } = view;
  const ranking = rankSalonsByMetric(selectedSalons, metric.code);
  const aggregates = aggregateSalons(selectedSalons, SALES_TOTALS_METRIC_CODES);

  /*
   * Bounded by ranking on the selected measure and keeping both ends. A
   * question about who needs attention is answered by the extremes, so a cap
   * that kept an arbitrary slice would remove exactly the rows being asked
   * about. The omission is stated rather than silent.
   */
  const listed =
    selectedSalons.length <= MAX_SALON_ROWS
      ? selectedSalons
      : orderByRanking(selectedSalons, ranking).slice(0, MAX_SALON_ROWS);
  const omitted = selectedSalons.length - listed.length;

  const sections: string[] = [
    "REPORT\nSales Totals (daily email delivery)",
    `PERIOD\n${formatReportDate(snapshot.reportDate)} (source wrote it as ${snapshot.reportDateRaw})`,
    `WINDOW\n${snapshot.windowLabel} — ${snapshot.windowDescription}`,
    `SELECTION\n${selectionHeading(selectedSalons, snapshot.salons.length)}${
      view.isAllSalons
        ? ` (no salon filter is applied, so this is every salon in the delivery)`
        : ""
    }`,
    `SELECTED METRIC\n${metric.label}${metric.note ? ` — ${metric.note}` : ""}`,
    `SALON FIGURES (${listed.length} of ${selectedSalons.length} selected salons)\n${listed
      .map(salonLine)
      .join("\n")}${
      omitted > 0
        ? `\n(${omitted} further salons are in the selection but not listed here; they rank between the extremes on ${metric.label}.)`
        : ""
    }`,
    `COMBINED FIGURES FOR THE SELECTED SALONS\n${aggregates
      .map((figure) => aggregateLine(figure, selectedSalons.length))
      .join("\n")}`,
    `RANKING BY ${metric.label.toUpperCase()} (highest first; salons that did not report it are absent)\n${
      ranking.length === 0
        ? "No salon reported this measure."
        : ranking
            .map(
              (row, index) =>
                `${index + 1}. ${row.storeName} (#${row.salonNumber}) — ${formatValue(
                  row.value,
                  metric.unit,
                )}`,
            )
            .join("\n")
    }`,
  ];

  if (estateSummary) {
    sections.push(
      `SELECTED ESTATE SUMMARY — ${estateSummary.label}${
        estateSummary.salonCount ? ` (covers ${estateSummary.salonCount} salons)` : ""
      }\n${SALES_TOTALS_METRIC_CODES.map((code) => {
        const measure = SALES_TOTALS_MEASURES_BY_CODE[code];
        const figure = estateSummary.figures.find((entry) => entry.metricCode === code);
        return `- ${figureHeading(measure, "summary", 0)}: ${formatValue(
          figure?.value ?? null,
          measure.unit,
        )}`;
      }).join("\n")}\nNOTE: these estate figures are PER-SALON AVERAGES across the whole estate, not totals, and not derived from the salon rows above. They belong to a different population and must never be added to, subtracted from, or directly compared with this delivery's salon figures.`,
    );
  }

  sections.push(
    [
      "DATA RULES — these are properties of the source, not preferences:",
      '- "not reported" means the source left the cell blank. It is NOT zero, and a salon showing it must not be described as having sold nothing or as the lowest performer on that measure.',
      "- The estate summary block is per-salon AVERAGES over the whole estate. The salon rows are this delivery's own salons. The two are different populations and are not comparable.",
      "- Per-person tanning average (PPTA) is money per transaction. It cannot be summed or averaged across salons without transaction counts, which this report does not publish. Where a combined figure is marked NOT AVAILABLE, say so rather than estimating one.",
      "- Month-to-date figures are already cumulative for the month. They are never added across dates.",
      "- Daily and month-to-date are alternative windows over overlapping time. They are never combined.",
      `- Every figure above is for ${formatReportDate(snapshot.reportDate)} only. There is no other date in this context, so no trend, change or comparison over time can be stated.`,
    ].join("\n"),
  );

  return sections.join("\n\n");
}

/** Selected salons ordered by their rank on the measure, unranked last. */
function orderByRanking(
  salons: readonly SalesTotalsSubject[],
  ranking: readonly { salonNumber: string }[],
): SalesTotalsSubject[] {
  const position = new Map(ranking.map((row, index) => [row.salonNumber, index]));
  return [...salons].sort(
    (left, right) =>
      (position.get(left.salonNumber ?? left.key) ?? Number.MAX_SAFE_INTEGER) -
      (position.get(right.salonNumber ?? right.key) ?? Number.MAX_SAFE_INTEGER),
  );
}
