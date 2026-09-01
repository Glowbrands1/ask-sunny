import type { ReportPeriodGrain } from "../types";

/**
 * REPORT VIEWS AND REPORTING GRAINS.
 *
 * Two selectors that look similar and mean entirely different things. Keeping
 * them apart in one file, side by side, is deliberate: the whole risk in this
 * area is a control that implies data nobody has.
 *
 *   A VIEW is one sheet of the source workbook. `MTD vs 2024` is the sheet we
 *   ingest today; `MTD Rolling` and `YTD` are two further sheets in the same
 *   file. Each has its own columns, its own period marker and its own parser.
 *   A view is offered because facts from that sheet exist in the database.
 *
 *   A GRAIN is how much reporting HISTORY we hold: weekly, monthly, yearly. It
 *   needs several ingested periods, and no arrangement of one report produces
 *   it. A grain is offered because enough periods exist.
 *
 * Neither is a hardcoded menu. Both take the database's answer and, where the
 * answer is no, carry the REASON — so an unavailable option explains itself
 * instead of being hidden (which looks like a missing feature) or fabricating a
 * chart (which is worse).
 */

/* ------------------------------------------------------------------- views */

export type ReportViewId = "mtd_vs_2024" | "mtd_rolling" | "ytd";

export interface ReportViewDefinition {
  id: ReportViewId;
  /** Manager-facing name. No parser or sheet jargon. */
  label: string;
  /** The workbook sheet behind it. Shown only in the source & quality panel. */
  sourceSheet: string;
  grain: ReportPeriodGrain;
  /** One line on what the view answers. */
  description: string;
}

/**
 * The three views the workbook can support, in reading order.
 *
 * Listing all three even though one is ingested is the point of the control: a
 * manager can see what this report will grow into, and each unavailable entry
 * says what it is waiting for rather than silently not existing.
 */
export const REPORT_VIEWS: ReportViewDefinition[] = [
  {
    id: "mtd_vs_2024",
    label: "MTD vs 2024",
    sourceSheet: "CompReport(MTD) vs 2024",
    grain: "mtd",
    description:
      "Month-to-date figures against the 2024 and 2019 baselines the source reports.",
  },
  {
    id: "mtd_rolling",
    label: "MTD Rolling",
    sourceSheet: "CompReport(MTD)",
    grain: "mtd",
    description:
      "Month-to-date figures with the source's trailing 3, 6, 9 and 12 month comparisons.",
  },
  {
    id: "ytd",
    label: "YTD",
    sourceSheet: "CompReport(YTD)",
    grain: "ytd",
    description: "Year-to-date figures. A separate period, never mixed with month-to-date.",
  },
];

export const VIEWS_BY_ID = new Map(REPORT_VIEWS.map((view) => [view.id, view]));

export function isReportViewId(value: string): value is ReportViewId {
  return VIEWS_BY_ID.has(value as ReportViewId);
}

/** One row of `comp_sales_source_views`: a sheet that has live facts. */
export interface SourceViewRow {
  periodId: string;
  grain: ReportPeriodGrain;
  periodEnd: string;
  sourceSheet: string;
  factCount: number;
  salonCount: number;
  metricCount: number;
  ingestedAt: string | null;
}

export interface ReportViewOption extends ReportViewDefinition {
  available: boolean;
  /** Why it cannot be selected. Null when it can. */
  unavailableReason: string | null;
  /** Live fact count behind it, when available. */
  factCount: number;
  salonCount: number;
}

/**
 * The View options, resolved against what has actually been ingested.
 *
 * Matching is on the SHEET NAME recorded on each fact, which is lineage the
 * ingestion wrote — not on a parser key or a guess. A sheet with no facts is
 * unavailable and says so.
 */
export function reportViewOptions(rows: SourceViewRow[]): ReportViewOption[] {
  const bySheet = new Map<string, SourceViewRow[]>();
  for (const row of rows) {
    bySheet.set(row.sourceSheet, [...(bySheet.get(row.sourceSheet) ?? []), row]);
  }

  return REPORT_VIEWS.map((view) => {
    const matches = bySheet.get(view.sourceSheet) ?? [];
    const factCount = matches.reduce((total, row) => total + row.factCount, 0);
    const salonCount = Math.max(0, ...matches.map((row) => row.salonCount));

    return {
      ...view,
      available: factCount > 0,
      unavailableReason:
        factCount > 0
          ? null
          : `No figures from this part of the workbook have been loaded yet, so there is nothing to show.`,
      factCount,
      salonCount: matches.length > 0 ? salonCount : 0,
    };
  });
}

/** The view a report opens on: the first available one, in reading order. */
export function defaultReportView(options: ReportViewOption[]): ReportViewOption | null {
  return options.find((option) => option.available) ?? options[0] ?? null;
}

export function findReportView(
  options: ReportViewOption[],
  id: string | null,
): ReportViewOption | null {
  if (!id) return null;
  return options.find((option) => option.id === id) ?? null;
}

/* ------------------------------------------------------------------ grains */

export type ReportingGrainId = "weekly" | "monthly" | "yearly";

export interface ReportingGrainOption {
  id: ReportingGrainId;
  label: string;
  available: boolean;
  /** Why it cannot be selected. Null when it can. */
  unavailableReason: string | null;
  /** Periods that would feed it. */
  periodCount: number;
}

const GRAIN_TOKENS = new Set<string>(["weekly", "monthly", "yearly"]);

export function isReportingGrainId(value: string): value is ReportingGrainId {
  return GRAIN_TOKENS.has(value);
}

/** A period as the grain calculation needs it. */
export interface PeriodShape {
  grain: ReportPeriodGrain;
  periodEnd: string;
}

/**
 * Which reporting grains the ingested periods can support.
 *
 * THE RULE IS TWO OR MORE PERIODS, and it is not conservatism for its own sake.
 * A single report is a single point. Weekly, monthly or yearly all mean "how
 * this moved between reporting periods", and with one period there is no
 * between — any chart drawn for it would be an invention, which is precisely
 * what this project has refused throughout.
 *
 * Monthly counts distinct month-to-date period ends; yearly counts distinct
 * year-to-date ones. Weekly has no grain in the schema at all yet, so it says
 * so rather than pretending it is merely empty.
 */
export function reportingGrainOptions(periods: PeriodShape[]): ReportingGrainOption[] {
  const monthly = new Set(
    periods.filter((period) => period.grain === "mtd").map((period) => period.periodEnd),
  );
  const yearly = new Set(
    periods.filter((period) => period.grain === "ytd").map((period) => period.periodEnd),
  );

  const needsMore = (count: number, noun: string) =>
    count === 0
      ? `No ${noun} reports have been loaded yet.`
      : `Only one ${noun} report has been loaded. Comparing across periods needs at least two.`;

  return [
    {
      id: "weekly",
      label: "Weekly",
      available: false,
      // Honest about the shape of the gap: this is not "no data yet", it is a
      // grain the source does not currently produce at all.
      unavailableReason:
        "The Comp Report is not produced weekly, so no weekly periods exist to compare.",
      periodCount: 0,
    },
    {
      id: "monthly",
      label: "Monthly",
      available: monthly.size > 1,
      unavailableReason: monthly.size > 1 ? null : needsMore(monthly.size, "month-to-date"),
      periodCount: monthly.size,
    },
    {
      id: "yearly",
      label: "Yearly",
      available: yearly.size > 1,
      unavailableReason: yearly.size > 1 ? null : needsMore(yearly.size, "year-to-date"),
      periodCount: yearly.size,
    },
  ];
}

/**
 * The grain a report opens on.
 *
 * Null when none is available, which is the current state and is correct: the
 * dashboard shows one period's figures and offers no history control that would
 * do nothing.
 */
export function defaultReportingGrain(
  options: ReportingGrainOption[],
): ReportingGrainOption | null {
  return options.find((option) => option.available) ?? null;
}
