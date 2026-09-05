import {
  SALES_TOTALS_MEASURES,
  SALES_TOTALS_METRIC_CODES,
  type SalesTotalsMeasure,
  type SalesTotalsWindow,
} from "../sales-totals/metric-map";
import type { SalesTotalsDateOption, SalesTotalsSnapshot, SalesTotalsSubject } from "./sales-totals-read";

/**
 * ============================================================================
 * WHICH SALES TOTALS VIEW A SET OF FILTERS MEANS.
 * ============================================================================
 *
 * Pure, no database, and shared by the two things that must never disagree
 * about it: the dashboard page, and the Ask Sunny analysis resolver.
 *
 * This logic used to live inline in the page. Copying it into the analysis
 * layer would have been the fastest route and the wrong one — the entire value
 * of report analysis is that Ask Sunny is looking at the SAME numbers the
 * reader is, and two hand-written copies of "which salons did they select"
 * would be two chances to drift. So the page now calls these too.
 *
 * NOTHING HERE READS OR TRUSTS A VALUE. The filters say WHICH data to load;
 * the figures come from the snapshot the server read for itself.
 */

/** The filters a reader can express, before validation. */
export interface SalesTotalsViewRequest {
  readonly reportDate?: string | null;
  readonly window?: string | null;
  /**
   * The estate summary card in view — All Salons, STC Consolidated, STC
   * Franchisees.
   *
   * Called `estateSummaryKey` rather than `scope` ON PURPOSE. "Scope" already
   * means something else in this application: the area a signed-in person is
   * authorised over. Two unrelated ideas under one word in an authorization
   * context is how somebody eventually reads one and enforces the other.
   */
  readonly estateSummaryKey?: string | null;
  /** Salon numbers. Empty means every salon in the delivery — see below. */
  readonly salonIds?: readonly string[] | null;
  readonly metric?: string | null;
}

/** The same filters, resolved against a real snapshot. */
export interface ResolvedSalesTotalsView {
  readonly window: SalesTotalsWindow;
  /** The estate summary row in view, or null if the report carries none. */
  readonly estateSummary: SalesTotalsSubject | null;
  readonly metric: SalesTotalsMeasure;
  /**
   * The salons the figures describe.
   *
   * EMPTY SELECTION MEANS EVERY SALON IN THE DELIVERY, never zero salons. A
   * dashboard that opened on nothing would be a blank screen a manager has to
   * configure before it says anything, and an analysis that read it as zero
   * would confidently report on no data at all.
   */
  readonly selectedSalons: readonly SalesTotalsSubject[];
  /**
   * The salon keys the reader actually asked for, after dropping unknown ones.
   * Empty when the selection is "all" — which is what the URL and the request
   * body both encode — and also empty when an explicit selection matched
   * nothing, which is why `isAllSalons` exists separately.
   */
  readonly selectedKeys: readonly string[];
  /**
   * True when NO explicit selection was made, so this is the whole delivery.
   *
   * NOT the same as "no valid keys survived". An explicit selection naming only
   * salons this delivery does not carry is an EMPTY selection, not a request for
   * everything — see `selectionInvalid`.
   */
  readonly isAllSalons: boolean;
  /**
   * True when the reader named salons and NONE of them exist in this snapshot.
   *
   * THE BUG THIS FIELD EXISTS TO PREVENT: deciding "all salons" from
   * `selectedKeys.length === 0` alone conflates two different states. Asking
   * for nothing means show everything; asking for salon 9999 and being told it
   * is not here means show nothing. Under the old rule a link naming a salon
   * from another delivery — a typo, a district that moved, a report the reader
   * does not receive — silently WIDENED to the entire estate delivery and
   * answered a question nobody asked. A filter must never broaden itself.
   */
  readonly selectionInvalid: boolean;
  /** Salon identifiers that were asked for and do not exist in this snapshot. */
  readonly unknownSalonIds: readonly string[];
}

/**
 * The report date to show.
 *
 * Falls back to the newest available — by the date the report COVERS, which is
 * how `listSalesTotalsDates` already orders them, so a backfilled older report
 * never becomes the default.
 */
export function resolveReportDate(
  dates: readonly SalesTotalsDateOption[],
  requested: string | null | undefined,
): string | null {
  if (dates.length === 0) return null;
  return dates.find((date) => date.reportDate === requested)?.reportDate ?? dates[0].reportDate;
}

/**
 * Daily unless MTD was explicitly asked for.
 *
 * Anything unrecognised is daily rather than an error: the two windows are
 * alternatives, and defaulting to the narrower one cannot overstate anything.
 */
export function resolveWindow(requested: string | null | undefined): SalesTotalsWindow {
  return requested === "mtd" ? "mtd" : "daily";
}

/** Everything else, against a snapshot that has already been read. */
export function resolveSalesTotalsSelection(
  snapshot: SalesTotalsSnapshot,
  request: SalesTotalsViewRequest,
): ResolvedSalesTotalsView {
  const estateSummary =
    snapshot.summaries.find((entry) => entry.key === request.estateSummaryKey) ??
    snapshot.summaries[0] ??
    null;

  const metric =
    SALES_TOTALS_MEASURES.find((measure) => measure.code === request.metric) ??
    SALES_TOTALS_MEASURES[0];

  /*
   * Unknown salon identifiers are DROPPED, not honoured and not an error. A
   * stale shared link should still open on the salons that do exist — and,
   * more importantly here, a request naming a salon that is not in this
   * delivery must not be able to manufacture a row for it.
   *
   * WHAT DROPPING THEM MUST NOT DO IS WIDEN THE VIEW. The four cases are
   * distinct and each has its own answer:
   *
   *     []                      -> every salon in the delivery
   *     ["1001"]                -> exactly 1001
   *     ["1001", "9999"]        -> exactly 1001, 9999 dropped
   *     ["9999"]                -> NOTHING, and `selectionInvalid` says why
   *
   * The last one used to fall through to "every salon", because the code asked
   * whether any keys survived rather than whether any were asked for.
   */
  const requested = (request.salonIds ?? [])
    .map((entry) => String(entry).trim())
    .filter((entry) => entry.length > 0);

  const known = new Set(snapshot.salons.map((salon) => salon.key));
  const selectedKeys = requested.filter((entry) => known.has(entry));
  const unknownSalonIds = requested.filter((entry) => !known.has(entry));

  // The question is whether a selection was MADE, not whether one survived.
  const isAllSalons = requested.length === 0;
  const selectionInvalid = requested.length > 0 && selectedKeys.length === 0;

  const selectedSalons = isAllSalons
    ? [...snapshot.salons]
    : snapshot.salons.filter((salon) => selectedKeys.includes(salon.key));

  return {
    window: snapshot.window,
    estateSummary,
    metric,
    selectedSalons,
    selectedKeys,
    isAllSalons,
    selectionInvalid,
    unknownSalonIds,
  };
}

/**
 * The ranking the dashboard plots, for one measure.
 *
 * Shared for the same reason as the selection: a ranking Ask Sunny described
 * that differed from the chart on screen would be worse than no ranking. A
 * salon that did not report the measure is LEFT OUT rather than ranked at zero
 * — plotting a missing value as a zero-length bar reads as "sold nothing".
 */
export function rankSalonsByMetric(
  salons: readonly SalesTotalsSubject[],
  metricCode: string,
): { salonNumber: string; storeName: string; value: number }[] {
  return salons
    .map((salon) => ({
      salonNumber: salon.salonNumber ?? salon.key,
      storeName: salon.label,
      value: salon.figures.find((entry) => entry.metricCode === metricCode)?.value ?? null,
    }))
    .filter((row): row is { salonNumber: string; storeName: string; value: number } =>
      row.value !== null,
    )
    .sort((left, right) => right.value - left.value);
}

/** The sort field a table is using, defaulting to the selected measure. */
export function resolveSortField(
  requested: string | null | undefined,
  metricCode: string,
): string {
  if (requested === "label") return "label";
  if (requested && SALES_TOTALS_METRIC_CODES.includes(requested)) return requested;
  return metricCode;
}
