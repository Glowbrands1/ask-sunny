/**
 * ============================================================================
 * THE SIX SALES TOTALS MEASURES, AND WHAT EACH ONE MEANS
 * ============================================================================
 *
 * Derived from the real report, not from the names. Two facts about this source
 * are easy to get wrong and both change what a dashboard may legitimately show.
 *
 * FACT ONE — THE SUMMARY BLOCK HOLDS AVERAGES, NOT TOTALS.
 *
 * Its header row literally says `Averages | Salon Counts`, and the arithmetic
 * confirms it. From the 09-02-2026 report, Grand Total:
 *
 *     STC Consolidated   98 salons   $734.50
 *     STC Franchisees   151 salons   $872.94
 *     All Salons        249 salons   $818.45
 *
 *     (98 × 734.50 + 151 × 872.94) / 249 = $818.45   <- matches to the cent
 *     734.50 + 872.94                    = $1,607.44 <- not it
 *
 * So "All Salons · Grand Total · $818.45" is the average revenue PER SALON, and
 * a KPI card labelling it a total would overstate the business by a factor of
 * 249. `summaryIsAverage` records this per measure so the presentation layer
 * cannot forget it.
 *
 * FACT TWO — PPTA IS AN AVERAGE EVERYWHERE, INCLUDING PER SALON.
 *
 * Per-person-tanning-average is money per transaction. Adding one salon's PPTA
 * to another's is meaningless, so `aggregation: "average"` marks the measures
 * that must never be summed across salons even at salon level. The counts and
 * Grand Total do sum across salons — but see the scope note below, because in
 * this report you still must not.
 *
 * A THIRD TRAP, recorded here because it follows from the same source: the
 * summary block covers all 249 salons while the salon block is the recipient's
 * 15. The summary is therefore NOT derivable from the rows beneath it, and the
 * rows do not add up to it. They are different populations, which is why they
 * are stored as different scopes rather than one being computed from the other.
 */

/** Which of the two column windows a value came from. */
export type SalesTotalsWindow = "daily" | "mtd";

/** How a measure behaves when combined across salons. */
export type SalesTotalsAggregation = "sum" | "average";

export interface SalesTotalsMeasure {
  /** Stable code. Stored on the fact; never shown to a reader. */
  readonly code: string;
  /** The label as the report writes it, used to match the header. */
  readonly header: string;
  /** What a manager should see. */
  readonly label: string;
  readonly unit: "currency" | "count";
  /**
   * Whether combining this across salons is arithmetic or nonsense.
   * `average` measures must never be summed, at any scope.
   */
  readonly aggregation: SalesTotalsAggregation;
  /**
   * True when the SUMMARY block's figure is a per-salon average rather than a
   * total for the scope. True for every measure in this report — recorded per
   * measure anyway, so a future report that totals some of them can say so
   * without the reader having to guess which convention is in force.
   */
  readonly summaryIsAverage: boolean;
  /** One line explaining the measure where it is shown. */
  readonly note: string;
}

/**
 * IN COLUMN ORDER. The report lays the six measures out left to right, each
 * occupying a pair of columns (report day, then MTD), and the parser relies on
 * this order matching the header pairs it reads.
 */
export const SALES_TOTALS_MEASURES: readonly SalesTotalsMeasure[] = [
  {
    code: "grand_total",
    header: "Grand Total",
    label: "Grand Total",
    unit: "currency",
    aggregation: "sum",
    summaryIsAverage: true,
    note: "Total sales. At salon level this is that salon's own takings; in the summary block it is the average per salon.",
  },
  {
    code: "ppta",
    header: "PPTA",
    label: "PPTA",
    unit: "currency",
    // An average of averages is not the average, so this one is never combined.
    aggregation: "average",
    summaryIsAverage: true,
    note: "Per-person tanning average — money per transaction. An average at every scope, so it is never summed.",
  },
  {
    code: "tans",
    header: "Tans",
    label: "Tans",
    unit: "count",
    aggregation: "sum",
    summaryIsAverage: true,
    note: "Tanning sessions. In the summary block, the average per salon.",
  },
  {
    code: "efts",
    header: "EFTs",
    label: "EFTs",
    unit: "count",
    aggregation: "sum",
    summaryIsAverage: true,
    note: "Electronic funds transfer memberships taken. In the summary block, the average per salon.",
  },
  {
    code: "new_customers",
    header: "New Customers",
    label: "New Customers",
    unit: "count",
    aggregation: "sum",
    summaryIsAverage: true,
    note: "First-time customers. In the summary block, the average per salon.",
  },
  {
    code: "sunless_sessions",
    header: "Sunless Sessions",
    label: "Sunless Sessions",
    unit: "count",
    aggregation: "sum",
    summaryIsAverage: true,
    // The report carries this rule as a footnote; kept because it explains why a
    // salon with spray equipment can still report zero.
    note: 'Spray/sunless sessions. The source counts a session only where the equipment description contains one of "Versa", "Myst", "Norvell", "SunStyle", "Airbrush", "Pura" or "Xpression".',
  },
];

export const SALES_TOTALS_MEASURES_BY_CODE: Readonly<Record<string, SalesTotalsMeasure>> =
  Object.fromEntries(SALES_TOTALS_MEASURES.map((measure) => [measure.code, measure]));

/** Every measure code, in column order. */
export const SALES_TOTALS_METRIC_CODES: readonly string[] = SALES_TOTALS_MEASURES.map(
  (measure) => measure.code,
);

/** The two windows, in the order the report presents them. */
export const SALES_TOTALS_WINDOWS: readonly {
  readonly id: SalesTotalsWindow;
  readonly label: string;
  readonly description: string;
}[] = [
  {
    id: "daily",
    label: "Previous Day",
    // Named for what it IS rather than for the column header, which is a date.
    description: "The single day the report covers.",
  },
  {
    id: "mtd",
    label: "Month to Date",
    description:
      "The first of the month through the report date, already cumulative in the source.",
  },
];
