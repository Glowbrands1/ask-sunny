/**
 * ============================================================================
 * A RANK IS A POSITION IN A POPULATION. IT STARTS AT 1.
 * ============================================================================
 *
 * THE DEFECT THIS MODULE EXISTS FOR, and it is worth writing down precisely
 * because the number on screen was not the number in the database.
 *
 * The Spa Engagement "Overall Rank" chart plots an INVERTED rank so a better
 * position draws a longer bar: `value = population - rank + 1`, so rank 1 with
 * a population of 248 plots at 248 and rank 248 plots at 1. The axis then
 * formats each tick back into a rank with the same inversion.
 *
 * The chart handed that axis no domain, so the charting library chose its own
 * — a rounded range from 0 to a little PAST the largest bar. With a population
 * of 248 it picked ticks at 0, 65, 130, 195 and 260, and the formatter turned
 * them into:
 *
 *     0   -> #249      <- one past the end of the population
 *     65  -> #184
 *     130 -> #119
 *     195 -> #54
 *     260 -> #-11      <- a negative rank
 *
 * which is exactly the sequence the 14 September review reported. Nothing was
 * wrong with any salon's stored rank; the AXIS was describing positions that do
 * not exist, and #-11 is the visible corner of that.
 *
 * SO THE FIX IS THE DOMAIN, NOT A FORMATTER THAT HIDES THE SYMPTOM. The
 * plottable range of an inverted rank is exactly [1, population] — there is no
 * such thing as a rank of 0 or of population+1 — and `rankAxis` below states
 * that as the axis's domain and ticks. `clampRank` is then a belt-and-braces
 * guard for anything that still reaches a formatter, and `isValidRank` is the
 * validation the read layer applies so an impossible stored rank is DROPPED as
 * unreadable rather than drawn.
 */

/** A rank the source could legitimately have published for this population. */
export function isValidRank(
  rank: number | null | undefined,
  population?: number | null,
): boolean {
  if (rank === null || rank === undefined) return false;
  if (!Number.isFinite(rank)) return false;
  // Ranks are whole positions. A fractional one is a parsing artefact.
  if (!Number.isInteger(rank)) return false;
  if (rank < 1) return false;
  /*
   * A rank BEYOND the population is refused too, and for the same reason a
   * negative one is: both describe a position that does not exist. The check is
   * skipped when the delivery did not record a population, because then there
   * is no upper bound to test against and refusing every rank would be worse
   * than accepting an unbounded one.
   */
  if (population !== null && population !== undefined && population > 0 && rank > population) {
    return false;
  }
  return true;
}

/**
 * A stored rank, or null when it is not a rank.
 *
 * NULL RATHER THAN A CORRECTED VALUE. There is no honest way to repair an
 * impossible rank — a 0 is not a 1 and a -11 is not anything — so an invalid
 * one becomes "not reported", which every caller already renders as a dash.
 */
export function readRank(
  rank: number | null | undefined,
  population?: number | null,
): number | null {
  return isValidRank(rank, population) ? (rank as number) : null;
}

/** A rank forced into the possible range, for a formatter that must print one. */
export function clampRank(rank: number, population: number | null | undefined): number {
  const floor = Math.max(1, Math.round(rank));
  if (population === null || population === undefined || population <= 0) return floor;
  return Math.min(floor, Math.round(population));
}

/** The value an inverted-rank bar plots at: rank 1 is longest. */
export function invertRank(rank: number, population: number): number {
  return population - rank + 1;
}

/** The rank an inverted plot value represents. */
export function rankFromInverted(value: number, population: number): number {
  return population - value + 1;
}

export interface RankAxis {
  /** The only values an inverted rank can take, as a chart domain. */
  readonly domain: readonly [number, number];
  /** Whole-rank tick positions inside that domain, ascending. */
  readonly ticks: readonly number[];
}

/**
 * The axis an inverted-rank chart must use.
 *
 * DOMAIN [1, population], BECAUSE THAT IS THE WHOLE OF WHAT EXISTS. Every tick
 * is generated inside it and is a whole position, so no tick can format to a
 * rank below 1 or above the population — which is the property the tests
 * assert and the one the reported defect violated.
 *
 * `#1` and `#population` are always present: the two ends of the ranking are
 * the ticks a reader actually orients by, and an axis that stops short of
 * either invites the same "what is past the end" reading that produced #-11.
 */
export function rankAxis(population: number | null | undefined, tickCount = 5): RankAxis {
  /*
   * NO POPULATION MEANS NO INVERSION IS POSSIBLE, so there is nothing sensible
   * to plot and the caller renders its empty state. A single-point domain is
   * returned rather than null so the type stays simple; a chart given one has
   * no bars to draw anyway.
   */
  if (population === null || population === undefined || population <= 0) {
    return { domain: [1, 1], ticks: [1] };
  }

  const top = Math.round(population);
  if (top <= 1) return { domain: [1, 1], ticks: [1] };

  const wanted = Math.max(2, Math.min(tickCount, top));
  const step = (top - 1) / (wanted - 1);
  const ticks = Array.from({ length: wanted }, (_, index) =>
    Math.round(1 + index * step),
  );

  // Rounding can collide two ticks on a small population; a duplicated tick
  // draws a doubled label rather than adding information.
  const unique = [...new Set(ticks)].sort((a, b) => a - b);

  return { domain: [1, top], ticks: unique };
}
