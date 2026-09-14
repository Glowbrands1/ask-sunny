/**
 * ============================================================================
 * PPTA — ONE DEFINITION, IN ONE PLACE
 * ============================================================================
 *
 *      PPTA = Product Sales ÷ Total Tans
 *
 * This is the business's own definition, confirmed in the 14 September review,
 * and it is authoritative. Nothing in Ask Sunny may state another one.
 *
 * ============================================================================
 * WHY THIS MODULE EXISTS: THERE WERE THREE DEFINITIONS
 * ============================================================================
 *
 * The review found all three live at once, and they disagreed with each other
 * and with the business:
 *
 *   1. The Sales Totals page called it "money per transaction" — a ticket
 *      average. That is a different measure with a different denominator, and
 *      it is what made the column look broken: a reader checking it against
 *      Grand Total ÷ Tans finds it reconciles on no row, correctly, because
 *      Grand Total is ALL sales and PPTA's numerator is PRODUCT sales only.
 *   2. The employee framework called it "Product Productivity Average" and
 *      sent Sunny elsewhere to verify the formula.
 *   3. The Bonus Viewer defined Unique PPTA as product sales ÷ UNIQUE TANNERS.
 *
 * Definition 3 is a real and different measure — "Unique PPTA" — and naming it
 * separately is the point: product sales per unique customer and product sales
 * per tanning session are both meaningful, and calling either one "PPTA" makes
 * the other wrong.
 *
 * ============================================================================
 * WHAT THE CORRECTED DEFINITION CHANGES ABOUT COMBINING IT
 * ============================================================================
 *
 * Under "money per transaction" a combined PPTA was genuinely impossible here,
 * because transaction counts are not published — and the aggregate layer
 * refused to produce one, which was the right answer to the wrong question.
 *
 * Under the correct definition it is ordinary arithmetic, because the
 * denominator IS published. For salons i:
 *
 *      PPTA_i = ProductSales_i / Tans_i        so  ProductSales_i = PPTA_i x Tans_i
 *
 *      Combined PPTA = SUM(ProductSales) / SUM(Tans)
 *                    = SUM(PPTA_i x Tans_i) / SUM(Tans_i)
 *
 * — a TANS-WEIGHTED mean, exact rather than approximate, using only figures the
 * Sales Totals report publishes per salon. A plain mean of the salons' PPTAs is
 * still refused, and still wrong: it weights a 42-tan salon the same as a
 * 900-tan one.
 *
 * IT IS ONLY COMPUTED WHERE BOTH SIDES ARE PRESENT. A salon that reported a
 * PPTA and no Tans cannot contribute a numerator, so it is excluded and the
 * result says how many salons it actually covers. Where nothing qualifies the
 * answer is null with a reason — never zero, and never a plain mean quietly
 * substituted.
 *
 * ============================================================================
 * IMPLAUSIBLE VALUES ARE FLAGGED, NEVER CORRECTED
 * ============================================================================
 *
 * The review found $0.00 and $0.19 in the live report and judged them a parsing
 * problem rather than performance. This module will not decide that: it has no
 * access to the source column and inventing a corrected figure would be the
 * worst available outcome — a fabricated number that looks like a measurement.
 *
 * What it does is say when a value is outside what the measure can plausibly
 * take, so that every surface — the table, the KPI card, the ranking and
 * anything Sunny is grounded on — treats it as a data question rather than as a
 * performance finding. A salon is not coached, ranked last, or named as a
 * problem on the strength of a figure the app itself considers unreadable.
 */

/** The one sentence every surface shows for PPTA. */
export const PPTA_DEFINITION = "Product Sales ÷ Total Tans";

/** The longer form, for a tooltip or an info panel. */
export const PPTA_EXPLANATION =
  "PPTA is product sales divided by total tans — the product revenue earned per tanning session. It is not the average ticket and it does not reconcile to Grand Total ÷ Tans, because Grand Total is all sales while PPTA's numerator is product sales only.";

/**
 * `Unique PPTA`, named so it can never be confused with PPTA.
 *
 * The Bonus Viewer's measure: product sales per UNIQUE TANNER. Recorded here
 * because the two were being used interchangeably, and the fix is to name both
 * rather than to delete one.
 */
export const UNIQUE_PPTA_DEFINITION = "Product Sales ÷ Unique Tanners";

export const UNIQUE_PPTA_DISAMBIGUATION =
  "Unique PPTA (the Bonus Viewer's measure) is product sales divided by UNIQUE TANNERS, not by total tans. It is a different figure from PPTA and the two must never be quoted for each other.";

/** How PPTA combines across salons, in one line for a prompt or a caption. */
export const PPTA_COMBINATION_RULE =
  "A combined PPTA is SUM(product sales) ÷ SUM(total tans), which equals each salon's PPTA weighted by that salon's tans. Never sum PPTA and never take a plain mean of salon PPTAs — a plain mean weights a small salon the same as a large one.";

/* ------------------------------------------------------------ arithmetic -- */

/** PPTA from its two parts, or null where it is not defined. */
export function computePpta(
  productSales: number | null | undefined,
  totalTans: number | null | undefined,
): number | null {
  if (productSales === null || productSales === undefined) return null;
  if (totalTans === null || totalTans === undefined) return null;
  if (!Number.isFinite(productSales) || !Number.isFinite(totalTans)) return null;
  // No tans is no denominator. Zero would read as "sells no product", which is
  // a finding, and this is the absence of a measurement.
  if (totalTans <= 0) return null;
  return productSales / totalTans;
}

/** One salon's contribution to a combined PPTA. */
export interface PptaContribution {
  /** That salon's reported PPTA. */
  readonly ppta: number | null;
  /** That salon's reported Total Tans — the weight. */
  readonly tans: number | null;
}

export interface CombinedPpta {
  /** The tans-weighted PPTA, or null when it could not be computed. */
  readonly value: number | null;
  /** Salons that contributed both a PPTA and a tans weight. */
  readonly contributingSalons: number;
  /** Salons that were offered and could not contribute. */
  readonly excludedSalons: number;
  /** The denominator the figure was computed over. */
  readonly totalTans: number | null;
  /** Set when `value` is null, saying why rather than showing a zero. */
  readonly reason: string | null;
}

/**
 * A combined PPTA across salons: SUM(product sales) ÷ SUM(tans).
 *
 * Reconstructs each salon's product sales as `ppta x tans`, which is exact
 * under the definition rather than an estimate of it.
 */
export function combinePpta(rows: readonly PptaContribution[]): CombinedPpta {
  const usable = rows.filter(
    (row): row is { ppta: number; tans: number } =>
      row.ppta !== null &&
      row.tans !== null &&
      Number.isFinite(row.ppta) &&
      Number.isFinite(row.tans) &&
      row.tans > 0,
  );

  const excluded = rows.length - usable.length;

  if (usable.length === 0) {
    return {
      value: null,
      contributingSalons: 0,
      excludedSalons: excluded,
      totalTans: null,
      reason:
        "A combined PPTA is product sales divided by total tans, so it needs both a PPTA and a Tans figure from each salon. No salon in this selection reported both.",
    };
  }

  const totalTans = usable.reduce((total, row) => total + row.tans, 0);
  const productSales = usable.reduce((total, row) => total + row.ppta * row.tans, 0);

  return {
    value: productSales / totalTans,
    contributingSalons: usable.length,
    excludedSalons: excluded,
    totalTans,
    reason: null,
  };
}

/* ----------------------------------------------------------- plausibility -- */

/**
 * WHAT COUNTS AS AN IMPLAUSIBLE PPTA, AND WHY THESE BOUNDS.
 *
 * Bounds, not a business rule, and deliberately loose. The question they answer
 * is "could this figure be a measurement at all", not "is this salon doing
 * well" — no target exists anywhere in this data and none is invented here.
 *
 *   AT OR BELOW ZERO is not a low figure, it is an absent one. Product sales
 *   cannot be negative, and a salon that genuinely sold no product reports a
 *   zero that is indistinguishable from a column that did not parse. The review
 *   found $0.00 in the live report and judged it a parsing problem; this cannot
 *   confirm that, so it declines to treat the value as performance either way.
 *
 *   ABSURDLY HIGH is the other end of the same question: product revenue per
 *   tanning session in the hundreds of dollars means a wrong column far more
 *   often than it means a remarkable day.
 *
 * A value inside the bounds is NOT thereby endorsed, and nothing here says a
 * flagged value is wrong. Both are stated in `pptaPlausibilityNote`.
 */
export const PPTA_IMPLAUSIBLE_AT_OR_BELOW = 0;
export const PPTA_IMPLAUSIBLE_AT_OR_ABOVE = 100;

export type PptaPlausibility =
  /** Inside the bounds. Not an endorsement — just not obviously unreadable. */
  | "plausible"
  /** Zero or negative product revenue per tan. */
  | "non_positive"
  /** Far outside anything product-per-tan can take. */
  | "implausibly_high"
  /** Not a number at all. */
  | "not_reported";

export function pptaPlausibility(value: number | null | undefined): PptaPlausibility {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "not_reported";
  }
  if (value <= PPTA_IMPLAUSIBLE_AT_OR_BELOW) return "non_positive";
  if (value >= PPTA_IMPLAUSIBLE_AT_OR_ABOVE) return "implausibly_high";
  return "plausible";
}

/** True when a PPTA must not be used to rank, coach or draw a conclusion. */
export function isPptaUnusable(value: number | null | undefined): boolean {
  const verdict = pptaPlausibility(value);
  return verdict === "non_positive" || verdict === "implausibly_high";
}

/**
 * What to SAY about a flagged PPTA. Never "the correct figure is".
 *
 * One sentence, shared by the table cell's tooltip, the ranking caption and the
 * text Sunny is grounded on, so a manager who sees the flag in two places reads
 * the same explanation and is pointed at the same next step.
 */
export function pptaPlausibilityNote(value: number | null | undefined): string | null {
  switch (pptaPlausibility(value)) {
    case "non_positive":
      return "This salon's PPTA is reported as zero or less. Product sales per tan cannot be negative, and a zero here is as likely to be a source or parsing problem as a salon that sold no product — so it is not treated as performance and not used to rank this salon. Check the delivery before acting on it.";
    case "implausibly_high":
      return "This salon's PPTA is far outside the range product sales per tan can take, which usually means the source column did not read as expected. It is not treated as performance and not used to rank this salon. Check the delivery before acting on it.";
    default:
      return null;
  }
}

/**
 * The rule that travels with PPTA into every prompt.
 *
 * The review's own requirement, and the reason it is stated rather than left to
 * judgement: Sunny was "repeating the $0.00 result and ranking Omaha 132nd last
 * because of it", which sends a manager to fix a salon that may not be broken.
 */
export const PPTA_ASSISTANT_RULES = `PPTA

- PPTA IS PRODUCT SALES DIVIDED BY TOTAL TANS. That is the company's definition and it is the only one. It is NOT money per transaction, NOT an average ticket, and NOT product sales per unique tanner — that last one is a different measure called Unique PPTA and belongs to the Bonus Viewer.
- PPTA DOES NOT RECONCILE TO GRAND TOTAL DIVIDED BY TANS, and it is not supposed to. Grand Total is all sales; PPTA's numerator is product sales only. Never present the two as though one should reproduce the other.
- ${PPTA_COMBINATION_RULE}
- A PPTA MARKED AS A DATA ISSUE IS NOT A PERFORMANCE FINDING. Where a figure is flagged below, say that the figure looks wrong and needs checking against the delivery. Do not coach from it, do not rank the salon on it, do not call the salon lowest or worst on that basis, and do not estimate what the value "should" be.`;
