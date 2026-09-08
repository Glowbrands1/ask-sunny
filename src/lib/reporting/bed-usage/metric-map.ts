/**
 * ============================================================================
 * THE BED USAGE MEASURES, AND WHAT THE SOURCE ACTUALLY MEANS BY EACH
 * ============================================================================
 *
 * Every statement below was checked against the August 2026 report (2,907
 * equipment rows over 252 salons). Four of them are easy to get wrong, and each
 * one changes a number a manager would act on.
 *
 * FACT ONE — `v Chain` IS A RATIO, NOT A PERCENTAGE.
 *
 * The column reads 2.0258 for GA Dalton's FAST beds and 0.9648 for its
 * SIGNATURE INSTANT bed. Those are multiples of the chain's per-bed usage for
 * the same LEVEL: 190.667 / 94.118 = 2.0258, and 323 / 334.781 = 0.9648. The
 * identity holds for all 2,907 rows. Classified as a percentage without
 * converting, 2.0258 reads as "+2%, outperforming" when the salon is in fact
 * running at twice the chain — and 0.9648 reads as "+0.96%, outperforming" when
 * it is 3.5% behind. `percentFromRatio` does the conversion once, at the parser.
 *
 * FACT TWO — `Salon Tans` IS REPEATED ON EVERY ROW OF A SALON.
 *
 * Column M holds the salon's whole-salon tan count, written again on each of
 * its nine to twelve equipment rows. Summing the column gives a figure eleven
 * times too large. The source marks the first row of each salon with `Ref` = 1
 * — its own summary block counts salons with `SUM(A:A)` — so the salon total is
 * read from the `Ref` = 1 row and nowhere else. `Bed Count` (column O) is
 * repeated the same way and read the same way.
 *
 * FACT THREE — THERE ARE TWO TAN COLUMNS AND THEY ARE DIFFERENT.
 *
 * `Client Tans` (H) excludes employee tans; `Total Tans` (K) includes them. For
 * GA Dalton's FASTEST beds: 1,008 client, 1,034 total, and the Usage Detail
 * sheet confirms 26 employee tans. The salon-level `Salon Tans` equals the sum
 * of CLIENT tans — verified to the unit for all fifteen authorized salons — so
 * the traffic measure and the row measure are consistent with each other, and
 * `per_bed` is derived from client tans as the source derives it.
 *
 * FACT FOUR — THE CHAIN BENCHMARK IS CHAIN-WIDE, AND IS NOT OURS TO PUBLISH.
 *
 * The per-level chain average is computed by the source over all 252 salons.
 * It is a BENCHMARK: a single number per equipment level, carrying no salon,
 * no company and no store name. Keeping it is what makes `v Chain` explicable
 * — "104.8 against a chain average of 117.2" rather than an unexplained -10.6%
 * — and it discloses nothing about another company's salons.
 */

/** The equipment levels the report groups by, in the order it lists them. */
export const BED_LEVELS: readonly string[] = [
  "FAST",
  "FASTER",
  "FASTEST",
  "INSTANT",
  "SUNLESS",
  "SPA",
];

/** Where a measure is reported: for one equipment row, or for a whole salon. */
export type BedUsageGrainKind = "equipment" | "salon";

export interface BedUsageMeasure {
  readonly code: string;
  readonly label: string;
  readonly unit: "count" | "ratio" | "percent";
  readonly grain: BedUsageGrainKind;
  /** How this measure behaves when combined across rows. */
  readonly aggregation: "sum" | "average" | "derived";
  /** True when a bigger number is better. Null where the business has not said. */
  readonly higherIsBetter: boolean | null;
  readonly note: string;
}

/**
 * THE MEASURES, in the order a dashboard reads them.
 *
 * `derived` aggregation means the figure must be RECOMPUTED from its parts when
 * rows are combined, never averaged. Per-bed usage over four salons is the sum
 * of their tans over the sum of their beds; averaging four per-bed figures
 * weights a one-bed salon the same as a twenty-bed one.
 */
export const BED_USAGE_MEASURES: readonly BedUsageMeasure[] = [
  {
    code: "salon_total_tans",
    label: "Total Tans",
    unit: "count",
    grain: "salon",
    aggregation: "sum",
    higherIsBetter: true,
    note: "The salon's tanning traffic for the period, from the source's own `Salon Tans` column. Read once per salon — the column repeats the same figure on every equipment row — and used as the denominator of Spa Conversion Rate.",
  },
  {
    code: "salon_bed_count",
    label: "Total Beds",
    unit: "count",
    grain: "salon",
    aggregation: "sum",
    higherIsBetter: null,
    note: "Installed units across every level. Also repeated on each equipment row in the source, so also read once per salon. More beds is neither good nor bad without knowing the traffic.",
  },
  {
    code: "salon_per_bed",
    label: "Per Bed Usage",
    unit: "count",
    grain: "salon",
    aggregation: "derived",
    higherIsBetter: true,
    note: "Tans divided by installed beds. Recomputed from tans and beds whenever salons are combined; an average of per-bed figures would weight a small salon like a large one.",
  },
  {
    code: "equipment_client_tans",
    label: "Client Tans",
    unit: "count",
    grain: "equipment",
    aggregation: "sum",
    higherIsBetter: true,
    note: "Tans on this equipment row, excluding employee tans. This is what the source divides by unit count to get Per Bed.",
  },
  {
    code: "equipment_total_tans",
    label: "Tans incl. employee",
    unit: "count",
    grain: "equipment",
    aggregation: "sum",
    higherIsBetter: null,
    note: "Client tans plus employee tans for this equipment row. Kept for reconciliation against the Usage Detail sheet; never the traffic measure.",
  },
  {
    code: "equipment_qty",
    label: "Units",
    unit: "count",
    grain: "equipment",
    aggregation: "sum",
    higherIsBetter: null,
    note: "Installed units of this bed type at this salon.",
  },
  {
    code: "equipment_per_bed",
    label: "Per Bed Usage",
    unit: "count",
    grain: "equipment",
    aggregation: "derived",
    higherIsBetter: true,
    note: "Client tans divided by units, which is how the source normalizes a store with one unit against a store with four.",
  },
  {
    code: "equipment_v_chain",
    label: "v Chain",
    unit: "percent",
    grain: "equipment",
    aggregation: "derived",
    higherIsBetter: true,
    note: "This row's per-bed usage against the chain's average per-bed usage for the same equipment LEVEL. Stored as a percentage difference; the source states it as a multiple.",
  },
  {
    code: "equipment_v_bed_type",
    label: "v Bed Type",
    unit: "percent",
    grain: "equipment",
    aggregation: "derived",
    higherIsBetter: true,
    note: "The same comparison against the chain average for this exact bed MODEL rather than its level. Narrower and noisier, so it is a supporting figure rather than the headline.",
  },
  {
    code: "equipment_share_of_tans",
    label: "% of Salon Tans",
    unit: "percent",
    grain: "equipment",
    aggregation: "derived",
    higherIsBetter: null,
    note: "This row's share of the salon's tans. Compared with its share of the salon's beds, it says whether a level is pulling its weight.",
  },
];

export const BED_USAGE_MEASURES_BY_CODE: Readonly<Record<string, BedUsageMeasure>> =
  Object.fromEntries(BED_USAGE_MEASURES.map((measure) => [measure.code, measure]));

/** Measures a salon-level ranking chart may offer. */
export const BED_USAGE_SALON_MEASURE_CODES: readonly string[] = BED_USAGE_MEASURES.filter(
  (measure) => measure.grain === "salon",
).map((measure) => measure.code);
