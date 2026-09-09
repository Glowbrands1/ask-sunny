import type { ReportMetricUnit } from "../types";
import type { DashboardKpi, Movers, SalonRankingRow } from "./dashboard";
import type { MetricDescriptor, ReportScope } from "./types";
import type { PerformanceWindow } from "./windows";

/**
 * ============================================================================
 * GROUNDING THE ASSISTANT ON THE COMP REPORT
 * ============================================================================
 *
 * Salon Performance answers the questions Sales Totals cannot: "are we
 * improving?", "what's driving the comp?", "are tans keeping pace with
 * revenue?", "which salon is strongest?", "where is the biggest gap?". All of
 * those are direction over a window, and a daily report has no direction in it.
 *
 * Together the two families are the pair a manager reasons with — Sales Totals
 * is the immediate signal, Salon Performance is the trend it sits inside — and
 * before this module Chat had neither.
 *
 * PURE. Text out of `DashboardKpi`, `SalonRankingRow` and `Movers`, the exact
 * structures the dashboard renders. Every figure was computed by the function
 * the dashboard called: no total is re-summed here, no percentage re-derived,
 * no median recalculated. This file orders and truncates and nothing else.
 *
 * ============================================================================
 * THE THREE THINGS THIS SOURCE WILL LIE ABOUT IF LET
 * ============================================================================
 *
 * 1. IT IS NOT THE CHAIN. The workbook is one recipient's filtered copy, so
 *    every aggregate is over the salons in the delivery. `MetricAggregate`
 *    carries `companyWide: false` as a literal type for exactly this reason,
 *    and the rules block says it in words, because "revenue is up 4%" read as a
 *    chain figure is the most plausible wrong sentence this data can produce.
 *
 * 2. A CHANGE IS EITHER REPORTED OR DERIVED, and the difference matters. The
 *    workbook publishes its own % change columns; where one is missing the read
 *    layer computes it from the two sides. `changeSource` travels with every
 *    figure so the model can say which it has, and so a derived change is never
 *    presented as the source's own.
 *
 * 3. PERCENTAGES ARE NOT AVERAGED ACROSS SALONS. The dashboard takes the MEDIAN
 *    of reported per-salon changes for anything not summable, because a mean
 *    would weight a small salon equally with a large one. The heading says
 *    median; the rules forbid re-describing it as an average.
 */

/** How many salon rows the section contributes before it truncates and says so. */
export const MAX_SALON_PERFORMANCE_BRIEFING_ROWS = 30;

/**
 * The rules that travel with the Comp Report figures.
 *
 * Beside the renderer for the reason the other two rule blocks are: these are
 * COMP REPORT rules and they change when the workbook does.
 */
export const SALON_PERFORMANCE_BRIEFING_RULES = `HOW TO USE THE SALON PERFORMANCE DATA

- These figures cover THIS DELIVERY'S SALONS ONLY. The source workbook is one recipient's filtered copy, so no total, median or change below is a chain figure. Never describe one as company-wide, and always name how many salons a figure covers.
- NAME THE COMPARISON. Every figure belongs to one window — a prior year, a trailing period, or year to date — and the windows cover different spans. Never compare a figure from one window with a figure from another.
- A CHANGE IS EITHER REPORTED BY THE SOURCE OR DERIVED FROM THE TWO SIDES. Each one says which. Do not present a derived change as the source's own figure.
- FOR MEASURES THAT DO NOT SUM the headline is a MEDIAN across salons, not an average, and the change is the median of the reported per-salon changes. Use the word the heading uses.
- Where a measure is not supported for the selected window the card says so. That is a gap, not a zero, and never a reason to quote another window's figure under this heading.
- Quote only figures written below. Do not compute a new ratio, project a trend or estimate a missing value.`;

/* --------------------------------------------------------------- rendering -- */

function value(unit: ReportMetricUnit, raw: number | null | undefined): string {
  if (raw === null || raw === undefined || !Number.isFinite(raw)) return "not reported";
  if (unit === "currency") {
    return `$${raw.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  }
  if (unit === "percent") return `${(raw * 100).toFixed(1)}%`;
  return raw.toLocaleString("en-US", { maximumFractionDigits: 1 });
}

/** A stored FRACTION as a signed percentage: `0.0412` -> `+4.1%`. */
function change(raw: number | null | undefined): string {
  if (raw === null || raw === undefined || !Number.isFinite(raw)) return "N/A";
  const percent = raw * 100;
  return `${percent > 0 ? "+" : ""}${percent.toFixed(1)}%`;
}

function salonLabel(row: SalonRankingRow): string {
  return `${row.storeName} (${row.salonNumber})`;
}

function capped<T>(rows: readonly T[], limit: number): { rows: readonly T[]; note: string | null } {
  if (rows.length <= limit) return { rows, note: null };
  return {
    rows: rows.slice(0, limit),
    note: `Only the first ${limit} of ${rows.length} rows are listed here. Do not describe the lowest or highest unless the list is complete.`,
  };
}

/* ------------------------------------------------------------------ input -- */

export interface SalonPerformanceBriefingInput {
  /** The ingested period these figures belong to. */
  readonly scope: ReportScope;
  /** The comparison selected, which also names the workbook sheet read. */
  readonly window: PerformanceWindow;
  /** The KPI row, exactly as the dashboard built it. */
  readonly kpis: readonly DashboardKpi[];
  /** The measure the ranking and the movers describe. */
  readonly selectedMetric: MetricDescriptor | null;
  /** The ranking rows, ordered by the caller. */
  readonly rows: readonly SalonRankingRow[];
  /** Strongest and weakest movement, from `buildMovers`. */
  readonly movers: Movers;
  /** How many salons the period holds before any filter. */
  readonly periodSalonCount: number;
  /** Set when a district or salon filter narrowed the population. */
  readonly selectionLabel: string | null;
  /**
   * Set when the reader asked for a period this report does not hold and the
   * newest was read instead. Reported, never silent.
   */
  readonly fellBackToNewest: boolean;
}

/* -------------------------------------------------------------- assembly -- */

/**
 * The Salon Performance section, or null when nothing has been loaded.
 *
 * NULL RATHER THAN AN EMPTY HEADING — see `buildSalesTotalsBriefing`.
 */
export function buildSalonPerformanceBriefing(
  input: SalonPerformanceBriefingInput,
): string | null {
  if (input.kpis.length === 0 && input.rows.length === 0) return null;

  const { scope, window } = input;
  const lines: string[] = [
    `SALON PERFORMANCE (Comp Report) — ${scope.grain.toUpperCase()} period ${scope.periodStart} to ${scope.periodEnd}, ` +
      `the source labelled it "${scope.periodLabel}".`,
    `Comparison: ${window.label}. Read from workbook sheet "${window.sourceSheet}", parser ${scope.parserKey} v${scope.parserVersion}` +
      `${scope.ingestedAt ? `, loaded ${scope.ingestedAt}` : ""}.`,
    `Population: ${
      input.selectionLabel
        ? `${input.rows.length} selected salon(s) of ${input.periodSalonCount} in the period (${input.selectionLabel})`
        : `all ${input.periodSalonCount} salons in the period`
    }. This is the recipient's own slice, never the chain.`,
  ];

  if (window.caveat) lines.push(`Caveat that must travel with this comparison: ${window.caveat}`);

  if (input.fellBackToNewest) {
    lines.push(
      "The period asked for is not among the ingested reports, so the NEWEST period was read instead. Say so before quoting these figures.",
    );
  }

  /* --------------------------------------------------------------- the KPIs */
  if (input.kpis.length > 0) {
    lines.push("");
    lines.push("Measures for this comparison — measure, current, comparison, change, how the change was obtained:");
    for (const kpi of input.kpis) {
      if (!kpi.supported) {
        lines.push(
          `  ${kpi.label}: NOT REPORTED for this comparison by the source. No figure, and not a zero.`,
        );
        continue;
      }
      const basis = kpi.current.kind === "sum" ? "total across the salons" : `${kpi.current.kind} across the salons`;
      lines.push(
        `  ${kpi.label} (${basis}, ${kpi.current.salonCount} salons): ` +
          `${kpi.currentLabel} ${value(kpi.unit, kpi.current.value)}` +
          (kpi.baseline
            ? `, ${kpi.baselineLabel ?? "comparison"} ${value(kpi.unit, kpi.baseline.value)}`
            : ", no comparison figure") +
          `, change ${change(kpi.change.value)} (${kpi.change.source})` +
          (kpi.current.unavailableReason ? ` — ${kpi.current.unavailableReason}` : ""),
      );
    }
  }

  /* ------------------------------------------------------------ the ranking */
  const metric = input.selectedMetric;
  if (metric && input.rows.length > 0) {
    lines.push("");
    lines.push(
      `By salon for ${metric.label} — salon, current, comparison, change, how obtained, source revenue rank:`,
    );
    const { rows, note } = capped(input.rows, MAX_SALON_PERFORMANCE_BRIEFING_ROWS);
    for (const row of rows) {
      lines.push(
        `  ${salonLabel(row)}: ${value(metric.unit, row.current)}` +
          `, comparison ${value(metric.unit, row.baseline)}` +
          `, change ${change(row.change)} (${row.changeSource})` +
          `, chain revenue rank ${row.revenueRank ?? "not reported"}` +
          (row.districtLabel ? `, district ${row.districtLabel}` : ""),
      );
    }
    if (note) lines.push(`  ${note}`);
  }

  /* ------------------------------------------------------------- the movers */
  if (input.movers.comparable && metric) {
    lines.push("");
    lines.push(
      `Largest movements in ${metric.label} against ${window.shortLabel} (${input.movers.changeSource} changes). ` +
        "Direction only — whether an increase is good depends on the measure:",
    );
    if (input.movers.gainers.length > 0) {
      lines.push(
        `  Largest increases: ${input.movers.gainers
          .map((row) => `${salonLabel(row)} ${change(row.change)}`)
          .join(", ")}`,
      );
    }
    if (input.movers.decliners.length > 0) {
      lines.push(
        `  Largest decreases: ${input.movers.decliners
          .map((row) => `${salonLabel(row)} ${change(row.change)}`)
          .join(", ")}`,
      );
    }
  } else if (metric) {
    lines.push("");
    lines.push(
      `${metric.label} has no comparison figures for this window, so there is no movement to report. Do not infer a direction.`,
    );
  }

  return lines.join("\n");
}
