import {
  SALES_TOTALS_MEASURES,
  SALES_TOTALS_MEASURES_BY_CODE,
  type SalesTotalsWindow,
} from "../sales-totals/metric-map";
import type { AggregatedFigure } from "./sales-totals-aggregate";
import type { SalesTotalsSnapshot, SalesTotalsSubject } from "./sales-totals-read";

/**
 * ============================================================================
 * GROUNDING THE ASSISTANT ON THE DAILY SALES TOTALS REPORT
 * ============================================================================
 *
 * Sales Totals is the report a manager's day starts from. "What should I focus
 * on today?", "what happened yesterday?", "are we converting traffic?" — all of
 * them are answered from six measures over two windows, and before this module
 * none of them reached Chat at all. The Sales Totals figures were reachable
 * only from a panel on the dashboard, so the assistant answered the most common
 * question in the product from the knowledge base and a bed report.
 *
 * PURE. Text out of structures the read and aggregate layers already produce,
 * so every figure here was computed by the function the dashboard called. There
 * is no second implementation of "the delivery's total tans" to drift from the
 * first — this file does no arithmetic beyond ordering and truncating.
 *
 * ============================================================================
 * THE TWO POPULATIONS, AND WHY THEY ARE RENDERED APART
 * ============================================================================
 *
 * The report holds two blocks that look alike and are not:
 *
 *   ESTATE AVERAGES   All Salons / STC Consolidated / STC Franchisees, over 249
 *                     / 98 / 151 salons. These are per-salon AVERAGES —
 *                     verified arithmetically in `sales-totals/metric-map.ts`:
 *                     (98 x 734.50 + 151 x 872.94) / 249 = 818.45, exactly the
 *                     All Salons figure, while the sum is not.
 *
 *   THIS DELIVERY     The recipient's fifteen salon rows, which do sum.
 *
 * Neither is derived from the other and the rows do not add up to the summary.
 * So they are separate sub-sections, each one saying what its figures ARE, and
 * the rules block forbids comparing them. A model handed "All Salons Grand
 * Total $824.14" next to a salon's $506.47 with no note would read the first as
 * an estate total and conclude the estate was doing worse than one salon.
 *
 * PPTA IS NEVER COMBINED, at any scope. It is money per transaction, so adding
 * two salons' PPTA is meaningless and averaging them is a different number that
 * looks authoritative. `aggregateSalons` already refuses it and carries the
 * reason; this renderer prints the reason rather than a figure.
 */

/** How many salon rows the section contributes before it truncates and says so. */
export const MAX_SALES_TOTALS_BRIEFING_ROWS = 30;

/**
 * The rules that travel with the Sales Totals figures.
 *
 * Beside the renderer rather than in the prompt module because every rule here
 * is a SALES TOTALS rule — the two populations, the cumulative MTD, the refusal
 * to sum across dates — and it must change when the report changes, not when
 * the assistant's tone does.
 */
export const SALES_TOTALS_BRIEFING_RULES = `HOW TO USE THE SALES TOTALS DATA

- This is a DAILY report. Each delivery carries two windows: the single day named as the report date, and month to date through that day.
- MONTH TO DATE IS ALREADY CUMULATIVE. Never add one report date's month-to-date figure to another's — that double-counts every day they share. Across dates, pick one; never sum.
- THE ESTATE AVERAGE ROWS AND THIS DELIVERY'S SALONS ARE DIFFERENT POPULATIONS. The estate rows are per-salon averages over every salon in the chain; the salon rows are this delivery's own salons and their figures sum. Never compare one directly with the other, never call an estate average a total, and never describe the delivery as above or below "the estate" using them.
- PPTA IS AN AVERAGE AT EVERY SCOPE. Never sum it and never average two salons' PPTA to get a combined figure. Where a combined PPTA is asked for, say why there is not one.
- Quote only figures written below. Do not compute a new ratio, project a trend or estimate a missing value.
- A blank is NOT REPORTED, which is not zero. Say "not reported" and do not substitute a zero.
- This report carries no employee-level figures, no coupon or discount detail, no drawer reconciliation, no break records, no inventory counts and no labour hours. If a question needs one of those, say the report does not carry it rather than inferring it.`;

/* --------------------------------------------------------------- rendering -- */

function money(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "not reported";
  return `$${value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function count(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "not reported";
  return Number.isInteger(value)
    ? value.toLocaleString("en-US")
    : value.toLocaleString("en-US", { maximumFractionDigits: 1 });
}

/** A figure rendered in its measure's own unit. */
function measured(metricCode: string, value: number | null | undefined): string {
  const measure = SALES_TOTALS_MEASURES_BY_CODE[metricCode];
  return measure?.unit === "currency" ? money(value) : count(value);
}

function salonLabel(subject: SalesTotalsSubject): string {
  return subject.salonNumber ? `${subject.label} (${subject.salonNumber})` : subject.label;
}

/** Truncates a list and SAYS SO — see `bed-spa/briefing.ts` for why it matters. */
function capped<T>(rows: readonly T[], limit: number): { rows: readonly T[]; note: string | null } {
  if (rows.length <= limit) return { rows, note: null };
  return {
    rows: rows.slice(0, limit),
    note: `Only the first ${limit} of ${rows.length} rows are listed here. Do not describe the lowest or highest unless the list is complete.`,
  };
}

/** Every measure for one subject, in the report's own column order. */
function figureLine(subject: SalesTotalsSubject): string {
  const parts = SALES_TOTALS_MEASURES.map((measure) => {
    const figure = subject.figures.find((entry) => entry.metricCode === measure.code);
    return `${measure.label} ${measured(measure.code, figure?.value ?? null)}`;
  });
  return parts.join(", ");
}

/* ------------------------------------------------------------------ input -- */

/**
 * One loaded window of the report.
 *
 * Both windows of one report date are briefed, because the daily signal and the
 * month-to-date position answer different halves of "how are we doing" and a
 * manager asking one almost always wants the other. They arrive as two entries
 * rather than one merged shape so no line can accidentally mix them.
 */
export interface SalesTotalsWindowBriefing {
  readonly window: SalesTotalsWindow;
  readonly snapshot: SalesTotalsSnapshot;
  /**
   * The selected salons' combined figures, from `aggregateSalons`.
   *
   * The dashboard's own aggregation, so a total quoted in chat is the total on
   * the KPI card. Carries `not_aggregatable` with its reason for PPTA.
   */
  readonly aggregated: readonly AggregatedFigure[];
  /**
   * The salons the reader had selected, or every salon in the delivery.
   *
   * Ordered by the caller — highest on the selected measure first — so the rows
   * a manager is most likely asking about survive truncation.
   */
  readonly salons: readonly SalesTotalsSubject[];
}

export interface SalesTotalsBriefingInput {
  /** Both windows of one report date. Empty is not a valid input — pass null. */
  readonly windows: readonly SalesTotalsWindowBriefing[];
  /** How many salons the delivery carries, before any selection. */
  readonly deliverySalonCount: number;
  /** Set when a selection narrowed the rows, so the model knows the population. */
  readonly selectionLabel: string | null;
  /**
   * Set when the reader asked for a report date this delivery history does not
   * hold, and the newest was read instead. Reported, never silent.
   */
  readonly fellBackToNewest: boolean;
}

/* --------------------------------------------------------------- sections -- */

function windowSection(entry: SalesTotalsWindowBriefing, input: SalesTotalsBriefingInput): string {
  const { snapshot } = entry;
  const coverage =
    entry.window === "daily"
      ? `the single day of ${snapshot.reportDate}`
      : `${snapshot.monthStart} through ${snapshot.reportDate}, already cumulative`;

  const lines: string[] = [
    `${snapshot.windowLabel.toUpperCase()} — ${coverage}.`,
  ];

  /* ------------------------------------------------- this delivery's salons */
  const population = input.selectionLabel
    ? `${entry.salons.length} selected salon(s) of ${input.deliverySalonCount} in the delivery (${input.selectionLabel})`
    : `all ${entry.salons.length} salons in the delivery`;

  const combinable = entry.aggregated.filter((figure) => figure.basis !== "not_aggregatable");
  const refused = entry.aggregated.filter((figure) => figure.basis === "not_aggregatable");

  lines.push(`  This delivery — ${population}:`);
  if (combinable.length > 0) {
    lines.push(
      `    Combined: ${combinable
        .map(
          (figure) =>
            `${figure.metricLabel} ${measured(figure.metricCode, figure.value)}` +
            (figure.reportingSalons < figure.selectedSalons
              ? ` (${figure.reportingSalons} of ${figure.selectedSalons} salons reported it)`
              : ""),
        )
        .join(", ")}`,
    );
  }
  for (const figure of refused) {
    lines.push(
      `    ${figure.metricLabel}: no combined figure. ${figure.reason ?? "Not combinable across salons."}`,
    );
  }

  const { rows, note } = capped(entry.salons, MAX_SALES_TOTALS_BRIEFING_ROWS);
  for (const salon of rows) {
    lines.push(`    ${salonLabel(salon)}: ${figureLine(salon)}`);
  }
  if (note) lines.push(`    ${note}`);

  /* ----------------------------------------------------- the estate averages */
  if (snapshot.summaries.length > 0) {
    lines.push(
      "  Estate rows — PER-SALON AVERAGES over the whole chain, NOT totals and NOT comparable with the delivery figures above:",
    );
    for (const summary of snapshot.summaries) {
      const over = summary.salonCount === null ? "" : ` (average per salon over ${summary.salonCount} salons)`;
      lines.push(`    ${summary.label}${over}: ${figureLine(summary)}`);
    }
  }

  return lines.join("\n");
}

/**
 * The Sales Totals section, or null when nothing has been loaded.
 *
 * NULL RATHER THAN AN EMPTY HEADING, for the reason `buildBedSpaBriefing`
 * gives: a block that announces report data and then lists none invites the
 * model to fill the gap. The composer above turns a requested-but-absent family
 * into an explicit "no current delivery" line instead.
 */
export function buildSalesTotalsBriefing(input: SalesTotalsBriefingInput): string | null {
  if (input.windows.length === 0) return null;

  const newest = input.windows[0].snapshot;
  const lineage = newest.lineage;
  const lines: string[] = [
    `SALES TOTALS — report date ${newest.reportDate} (source wrote it ${newest.reportDateRaw}).`,
    `Read from the ingested delivery${
      lineage.ingestedAt ? ` loaded ${lineage.ingestedAt}` : ""
    }${lineage.parserKey ? `, parser ${lineage.parserKey} v${lineage.parserVersion ?? "?"}` : ""}.`,
  ];

  if (input.fellBackToNewest) {
    lines.push(
      "The report date asked for is not among the ingested deliveries, so the NEWEST delivery was read instead. Say so before quoting these figures.",
    );
  }

  for (const entry of input.windows) {
    lines.push("");
    lines.push(windowSection(entry, input));
  }

  return lines.join("\n");
}
