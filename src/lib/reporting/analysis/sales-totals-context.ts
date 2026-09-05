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
import { viewFingerprint } from "./view-fingerprint";
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
  | "no_salon_data"
  /**
   * The caller named salons and none of them are in this delivery.
   *
   * DISTINCT FROM `no_salon_data` on purpose. The report is fine and the reader
   * simply asked about salons that are not in it, so the answer is "that
   * selection is empty" rather than "there is no report" — and, critically,
   * never "here is the whole estate delivery instead".
   */
  | "invalid_selection";

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
  /**
   * Which view this grounding describes, computed from what was RESOLVED.
   *
   * Not from what was requested: a stale date falls back to the newest report
   * and an unknown metric falls back to the first, so a fingerprint taken off
   * the request would claim an identity the grounding does not have. This one
   * is derived from the rows that were actually read, which is what makes it
   * safe to gate a conversation on.
   */
  readonly fingerprint: string;
}

export type SalesTotalsAnalysisResult =
  | SalesTotalsAnalysisContext
  | { readonly ok: false; readonly failure: AnalysisContextFailure };

/**
 * How many salon rows may be spelled out in full.
 *
 * This delivery carries fifteen, so the cap is not reached today. It exists so
 * that a larger delivery degrades DETERMINISTICALLY rather than by silently
 * dropping whichever rows happened to come last.
 */
const MAX_SALON_ROWS = 60;

/**
 * The share of the cap reserved for salons that did not report the measure.
 *
 * They cannot compete for the ranked places — a blank is not a low number, so
 * they have no position in the ranking at all — and without a reservation the
 * bound would erase them entirely from a large delivery. One row in six is
 * enough to make "some salons did not report this" visible as rows rather than
 * only as a count.
 */
const UNREPORTED_SHARE = 6;

/** How the cap was applied, so the grounding text can state it truthfully. */
interface BoundedSalonRows {
  readonly listed: readonly SalesTotalsSubject[];
  /** Ranked salons left out. They genuinely lie between the listed extremes. */
  readonly omittedRanked: number;
  /** Salons that did not report the measure and were left out. */
  readonly omittedUnreported: number;
  /** How many of the selection did not report the measure at all. */
  readonly totalUnreported: number;
}

/**
 * ============================================================================
 * BOUNDING A LARGE SELECTION WITHOUT LOSING THE ROWS BEING ASKED ABOUT
 * ============================================================================
 *
 * THE BUG THIS REPLACES: the previous version ordered the selection high to low
 * and took `slice(0, MAX_SALON_ROWS)` while its own comment claimed it kept
 * both extremes. It kept the TOP sixty. On a delivery larger than the cap, the
 * weakest salons — the exact rows behind "which salons need attention?" — were
 * the first thing dropped, and the grounding text then told the model the
 * omitted rows lay between the extremes, which was false.
 *
 * WHAT IT DOES NOW. The ranking on the selected measure has two ends and they
 * are both kept: the top half of the budget from the highest, the bottom half
 * from the lowest. The slices are taken so they cannot overlap, so no salon is
 * listed twice and none is counted twice in the omission figures.
 *
 * SALONS THAT DID NOT REPORT THE MEASURE ARE HANDLED SEPARATELY, because they
 * are not the bottom of the ranking — they are not in the ranking. Ordering
 * them "last" and calling that the bottom would present a blank cell as the
 * worst performance in the delivery, which is the missing-is-not-zero rule
 * broken in the one place it would be hardest to notice. They get their own
 * reserved share of the cap and are labelled as unranked.
 *
 * AND THE OMISSION IS DESCRIBED HONESTLY. The two kinds of omitted row are
 * counted separately, and only the ranked ones are described as lying between
 * the extremes — because only they do.
 */
function boundSalonRows(
  selected: readonly SalesTotalsSubject[],
  ranking: readonly { salonNumber: string }[],
  limit: number,
): BoundedSalonRows {
  const position = new Map(ranking.map((row, index) => [row.salonNumber, index]));
  const keyOf = (salon: SalesTotalsSubject) => salon.salonNumber ?? salon.key;

  const unreported = selected.filter((salon) => !position.has(keyOf(salon)));

  if (selected.length <= limit) {
    return {
      listed: selected,
      omittedRanked: 0,
      omittedUnreported: 0,
      totalUnreported: unreported.length,
    };
  }

  const ranked = selected
    .filter((salon) => position.has(keyOf(salon)))
    .sort((left, right) => position.get(keyOf(left))! - position.get(keyOf(right))!);

  const unreportedBudget = Math.min(
    unreported.length,
    Math.floor(limit / UNREPORTED_SHARE),
  );
  const rankedBudget = limit - unreportedBudget;
  const topCount = Math.ceil(rankedBudget / 2);
  const bottomCount = rankedBudget - topCount;

  const top = ranked.slice(0, topCount);
  /*
   * `Math.max` is what makes the two slices disjoint. When the ranked salons
   * would all fit inside the budget, the bottom slice simply starts where the
   * top one ended, so nothing is listed twice; when they would not, it starts
   * past the top slice and the two ends are genuinely separate.
   */
  const bottom =
    bottomCount > 0 ? ranked.slice(Math.max(topCount, ranked.length - bottomCount)) : [];

  const listedRanked = [...top, ...bottom];
  const listedUnreported = unreported.slice(0, unreportedBudget);

  return {
    listed: [...listedRanked, ...listedUnreported],
    omittedRanked: ranked.length - listedRanked.length,
    omittedUnreported: unreported.length - listedUnreported.length,
    totalUnreported: unreported.length,
  };
}

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

  /*
   * AN EXPLICIT SELECTION THAT MATCHED NOTHING IS REFUSED, not widened. If this
   * fell through to the whole delivery, a caller naming a salon they are not
   * meant to see would be handed every salon instead — the opposite of what
   * their filter asked for.
   */
  if (view.selectionInvalid) return { ok: false, failure: "invalid_selection" };
  if (view.selectedSalons.length === 0) return { ok: false, failure: "no_salon_data" };

  return {
    ok: true,
    grounding: buildGrounding(snapshot, view),
    fingerprint: viewFingerprint({
      reportDate: snapshot.reportDate,
      window: snapshot.window,
      estateSummaryKey: view.estateSummary?.key ?? null,
      metric: view.metric.code,
      // The keys that survived resolution. Empty means the whole delivery, and
      // the fingerprint spells that out rather than leaving it blank.
      salonIds: view.selectedKeys,
    }),
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

  // Both ends of the ranking survive the cap, and unranked salons keep their
  // own reserved share. See `boundSalonRows`.
  const bounded = boundSalonRows(selectedSalons, ranking, MAX_SALON_ROWS);
  const listed = bounded.listed;

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
      .join("\n")}${omissionNote(bounded, metric.label)}`,
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

/**
 * What was left out, said in a way that is true of what was left out.
 *
 * The two kinds of omission are reported separately BECAUSE THEY MEAN
 * DIFFERENT THINGS. A ranked salon that is not listed really does sit between
 * the highest and lowest rows above, so the model may reason about it that way.
 * A salon that did not report the measure sits nowhere on that scale, and
 * lumping the two counts together would invite exactly the inference the
 * missing-is-not-zero rule forbids.
 */
function omissionNote(bounded: BoundedSalonRows, metricLabel: string): string {
  const notes: string[] = [];

  if (bounded.omittedRanked > 0) {
    notes.push(
      `${bounded.omittedRanked} further salons reported ${metricLabel} and are not listed above. ` +
        `The rows above are the highest and the lowest of the selection on ${metricLabel}, so every ` +
        `omitted salon falls between them.`,
    );
  }

  if (bounded.omittedUnreported > 0) {
    notes.push(
      `${bounded.omittedUnreported} of the ${bounded.totalUnreported} selected salons that did not report ` +
        `${metricLabel} are also not listed. They have no position in the ranking at all — a blank is not a ` +
        `low figure — so they are neither above nor below the rows shown.`,
    );
  }

  return notes.length === 0 ? "" : `\n(${notes.join(" ")})`;
}
