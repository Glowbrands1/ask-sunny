import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/server";
import {
  SALES_TOTALS_WINDOWS,
  type SalesTotalsWindow,
} from "../sales-totals/metric-map";

/**
 * ============================================================================
 * THE SALES TOTALS READ LAYER
 * ============================================================================
 *
 * Server-only, same posture as the Comp Report read layer and for the same
 * reason: there is no identity provider yet, `authenticated` is a role nobody
 * holds, and a browser client would read zero rows through RLS. Reads run
 * server-side under the secret key, and `import "server-only"` makes a client
 * component importing this file a BUILD failure rather than a review comment.
 *
 * THE ONE RULE THIS MODULE ENFORCES ABOVE ALL OTHERS: it reads ONE report date
 * at a time and never aggregates across dates. MTD is already cumulative in
 * the source, so adding two snapshots double-counts the overlap between them.
 * There is deliberately no function here that sums, averages or otherwise
 * combines report dates — the shape of the API is the safeguard.
 *
 * AND IT NEVER DERIVES A SUMMARY FROM SALON ROWS. The report's summary block
 * covers all 249 salons; the salon rows are the recipient's 15. Neither is
 * computable from the other, so both are read as they were reported.
 */

/** A report date offered in the picker. */
export interface SalesTotalsDateOption {
  /** ISO `yyyy-mm-dd`. */
  readonly reportDate: string;
  /** As the report wrote it, e.g. `09-02-2026`. */
  readonly reportDateRaw: string;
  readonly monthStart: string;
  readonly label: string;
  readonly ingestedAt: string | null;
}

/** One measure for one subject in one window. */
export interface SalesTotalsFigure {
  readonly metricCode: string;
  readonly metricLabel: string;
  readonly unit: "currency" | "count";
  readonly aggregation: "sum" | "average";
  readonly summaryIsAverage: boolean;
  readonly note: string;
  /** Null means the source left it blank. Never rendered as zero. */
  readonly value: number | null;
}

/** A summary scope, or a salon. */
export interface SalesTotalsSubject {
  readonly kind: "summary" | "salon";
  /** `all_salons`, or the salon number for a salon row. */
  readonly key: string;
  readonly label: string;
  /** Salon rows only. */
  readonly salonNumber: string | null;
  /** Summary rows only: how many salons the average covers. */
  readonly salonCount: number | null;
  readonly figures: readonly SalesTotalsFigure[];
}

export interface SalesTotalsSnapshot {
  readonly reportDate: string;
  readonly reportDateRaw: string;
  readonly monthStart: string;
  readonly window: SalesTotalsWindow;
  readonly windowLabel: string;
  readonly windowDescription: string;
  readonly summaries: readonly SalesTotalsSubject[];
  readonly salons: readonly SalesTotalsSubject[];
  readonly lineage: {
    readonly parserKey: string | null;
    readonly parserVersion: number | null;
    readonly ingestedAt: string | null;
  };
}

/** Rows as `sales_totals_current_facts` returns them. Private to this module. */
interface FactRow {
  report_date: string;
  report_date_raw: string;
  month_start: string;
  report_window: SalesTotalsWindow;
  scope_kind: "summary" | "salon";
  scope_code: string;
  subject_label: string | null;
  scope_order: number | null;
  salon_number: string | null;
  store_name: string | null;
  metric_code: string;
  metric_label: string;
  metric_unit: "currency" | "count";
  metric_aggregation: "sum" | "average";
  summary_is_average: boolean;
  metric_note: string;
  metric_order: number;
  value: string | number | null;
  salon_count: number | null;
  parser_key: string | null;
  parser_version: number | null;
  ingested_at: string | null;
}

/** Postgres `numeric` arrives as a string; null stays null. */
function toNumber(value: string | number | null): number | null {
  if (value === null) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Every report date that has a live snapshot, newest first.
 *
 * ORDERED BY `report_date`, NOT BY WHEN IT WAS INGESTED, and that distinction
 * is the point. A report for an older day delivered late — a backfill, a
 * re-send after an outage — must slot into history rather than becoming "the
 * latest". Verified against the live data: Sep 2 was ingested first and Sep 1
 * second, and Sep 2 is still what this returns first.
 */
export async function listSalesTotalsDates(): Promise<SalesTotalsDateOption[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("sales_totals_snapshots")
    .select("report_date, report_date_raw, month_start, created_at, superseded_by_ingestion_id")
    .is("superseded_by_ingestion_id", null)
    .order("report_date", { ascending: false });

  if (error) {
    throw new Error(`Could not list Sales Totals report dates: ${error.message}`);
  }

  return (data ?? []).map((row) => ({
    reportDate: row.report_date as string,
    reportDateRaw: row.report_date_raw as string,
    monthStart: row.month_start as string,
    label: formatReportDate(row.report_date as string),
    ingestedAt: (row.created_at as string) ?? null,
  }));
}

/** `2026-09-02` -> `Wed, Sep 2 2026`. */
export function formatReportDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * One report date, one window, fully resolved.
 *
 * The window is a parameter rather than something the caller filters out
 * afterwards, because a query that returned both would invite somebody to add
 * them together. Daily and MTD describe overlapping spans of time; they are
 * alternatives, never components.
 */
export async function loadSalesTotals(options: {
  reportDate: string;
  window: SalesTotalsWindow;
}): Promise<SalesTotalsSnapshot | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("sales_totals_current_facts")
    .select(
      "report_date, report_date_raw, month_start, report_window, scope_kind, scope_code, " +
        "subject_label, scope_order, salon_number, store_name, metric_code, metric_label, " +
        "metric_unit, metric_aggregation, summary_is_average, metric_note, metric_order, " +
        "value, salon_count, parser_key, parser_version, ingested_at",
    )
    // ONE DATE. Never a range, never "all".
    .eq("report_date", options.reportDate)
    .eq("report_window", options.window);

  if (error) {
    throw new Error(`Could not read Sales Totals: ${error.message}`);
  }

  const rows = (data ?? []) as unknown as FactRow[];
  if (rows.length === 0) return null;

  const windowMeta =
    SALES_TOTALS_WINDOWS.find((entry) => entry.id === options.window) ?? SALES_TOTALS_WINDOWS[0];

  return {
    reportDate: rows[0].report_date,
    reportDateRaw: rows[0].report_date_raw,
    monthStart: rows[0].month_start,
    window: options.window,
    windowLabel: windowMeta.label,
    windowDescription: windowMeta.description,
    summaries: groupSubjects(rows.filter((row) => row.scope_kind === "summary")),
    salons: groupSubjects(rows.filter((row) => row.scope_kind === "salon")),
    lineage: {
      parserKey: rows[0].parser_key,
      parserVersion: rows[0].parser_version,
      ingestedAt: rows[0].ingested_at,
    },
  };
}

/** Facts to subjects, each carrying its measures in report order. */
function groupSubjects(rows: readonly FactRow[]): SalesTotalsSubject[] {
  const bySubject = new Map<string, { row: FactRow; order: number; figures: SalesTotalsFigure[] }>();

  for (const row of rows) {
    const isSalon = row.scope_kind === "salon";
    // Salons key on their NUMBER, which is unique; store names are not
    // constrained to be. Scopes key on their code.
    const key = isSalon ? (row.salon_number ?? row.store_name ?? "unknown") : row.scope_code;
    let entry = bySubject.get(key);
    if (!entry) {
      entry = { row, order: row.scope_order ?? 0, figures: [] };
      bySubject.set(key, entry);
    }
    entry.figures.push({
      metricCode: row.metric_code,
      metricLabel: row.metric_label,
      unit: row.metric_unit,
      aggregation: row.metric_aggregation,
      summaryIsAverage: row.summary_is_average,
      note: row.metric_note,
      value: toNumber(row.value),
    });
    // Keep the report's own measure order rather than whatever the rows arrive
    // in — Postgres makes no promise about that without an ORDER BY.
    entry.figures.sort((left, right) => metricOrder(rows, left) - metricOrder(rows, right));
  }

  return [...bySubject.entries()]
    .map(([key, entry]) => ({
      kind: entry.row.scope_kind,
      key,
      label: entry.row.subject_label ?? key,
      salonNumber: entry.row.salon_number,
      salonCount: entry.row.salon_count,
      figures: entry.figures,
    }))
    .sort((left, right) => {
      if (left.kind === "summary" && right.kind === "summary") {
        return summaryOrder(rows, left.key) - summaryOrder(rows, right.key);
      }
      // Salons alphabetically by the name a reader sees.
      return left.label.localeCompare(right.label);
    });
}

function metricOrder(rows: readonly FactRow[], figure: SalesTotalsFigure): number {
  return rows.find((row) => row.metric_code === figure.metricCode)?.metric_order ?? 0;
}

function summaryOrder(rows: readonly FactRow[], scopeCode: string): number {
  return rows.find((row) => row.scope_code === scopeCode)?.scope_order ?? 0;
}
