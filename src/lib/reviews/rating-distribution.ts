import type { RatingDistribution } from "./types";

/**
 * ============================================================================
 * THE STAR DISTRIBUTION, SHAPED — AND KEPT OUT OF THE WEEKLY ARITHMETIC
 * ============================================================================
 *
 * This is a module of its own rather than a function in `aggregate.ts`, and the
 * separation is the point. Everything in that file is summed from
 * `google_review_location_periods`: the weekly totals, the qualifying count,
 * the baselines, the twelve-period trend. A distribution over the review
 * RECORDS has nothing to do with any of it, shares none of its inputs, and must
 * not be able to disturb it — so it does not live next to it.
 *
 * WHAT WENT WRONG WHEN THE TWO SHARED A HOME. The rating card read
 * `ReviewSummary.byRating`, which that rollup supplies, and the rollup holds a
 * review only where it was proven to sit above its listing's baseline. On an
 * estate whose baselines have not been set it is empty, so the card rendered
 * five zeroes beside an over-time chart drawing hundreds of real reviews.
 * `byRating` is still exactly what it was — the period-scoped breakdown — and
 * is still computed the same way. The CARD stopped asking it a question it was
 * never answering.
 *
 * THE COUNTS ARRIVE FROM A READ OF THE REVIEW RECORDS, and this function's only
 * job is to shape them and derive the total. No baseline, anchor, reporting
 * period or weekly-eligibility signal reaches it, because none of them is a
 * fact about what a customer gave.
 *
 * THE TOTAL IS DERIVED HERE AND NOWHERE ELSE, which is what makes "the five
 * bars add up to the heading" a property of the code rather than something to
 * check by eye: a caller cannot pass a total that disagrees with its buckets,
 * because it cannot pass a total at all.
 *
 * Client-safe. No database client, no secret, no `server-only` import.
 */
export function ratingDistribution(perStar: readonly number[]): RatingDistribution {
  /* A missing or negative bucket is zero: a count is never fewer than none. */
  const at = (index: number) => Math.max(0, Math.trunc(perStar[index] ?? 0));
  const counts: [number, number, number, number, number] = [
    at(0),
    at(1),
    at(2),
    at(3),
    at(4),
  ];
  return { counts, total: counts.reduce((running, count) => running + count, 0) };
}
