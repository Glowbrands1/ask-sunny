/**
 * THE RANKING AXIS SHOWS THE STORE NAME. THE CATEGORY IS STILL THE SALON NUMBER.
 *
 * A manager reads "MO Kansas City Liberty"; nobody recognises 0394 on sight. So
 * the axis had to stop showing numbers.
 *
 * But it cannot simply be keyed on `storeName`. Recharts treats a category
 * axis value as the identity of a bar, and `salons.store_name` carries no
 * unique constraint — only a not-blank check. Two salons sharing a name would
 * silently collapse into one bar holding one of their two values, which is a
 * wrong figure rather than a cosmetic fault. `salon_number` IS unique, so it
 * stays the category and only the rendered tick changes.
 *
 * The number is not lost: `salonTick` keeps it first in the tooltip. The axis
 * is for recognition, the tooltip for identification.
 *
 * Pure functions in their own module so they can be tested without loading
 * Recharts, and so the reasoning above sits next to what it governs.
 */

/** The fields these helpers need — narrower than a full ranking row. */
export interface SalonAxisRow {
  readonly salonNumber: string;
  readonly storeName: string;
}

/** Maps a salon number to the name shown on the axis. */
export function storeNameTicks(
  rows: readonly SalonAxisRow[],
): (value: string) => string {
  const byNumber = new Map(
    rows.filter((row) => row.storeName).map((row) => [row.salonNumber, row.storeName]),
  );
  /*
   * Falls back to the number rather than to an empty tick. A nameless bar
   * cannot be attributed to anything; a numbered one still can.
   */
  return (value: string) => byNumber.get(value) ?? value;
}

/** Widest axis the longest name in view needs, within bounds. */
export function salonAxisWidth(rows: readonly SalonAxisRow[]): number {
  const longest = rows.reduce(
    (widest, row) => Math.max(widest, (row.storeName || row.salonNumber).length),
    0,
  );
  /*
   * Measured, not fixed. The previous 64px was sized for a four-digit number
   * and clipped every name. Unbounded, one long name would squeeze the bars
   * into nothing — so it is capped and Recharts truncates past that.
   */
  return Math.min(196, Math.max(96, Math.round(longest * 6.2) + 14));
}

/**
 * ============================================================================
 * THE MOVERS AXIS RUNS OVER THE MOVEMENT THAT EXISTS
 * ============================================================================
 *
 * THE DEFECT, from the 14 September review: "'Strongest and Weakest Movers'
 * runs its axis down to -71%, even though nothing is negative."
 *
 * The chart asked for a SYMMETRIC domain — `[-bound, bound]` where `bound` was
 * the largest absolute change plus 15% headroom — on the reasoning that a +5%
 * bar and a -5% bar should be the same length. That reasoning is right, and it
 * only applies when there ARE bars on both sides. With every salon up, the
 * symmetry manufactured a whole negative half nobody could reach: half the plot
 * area empty, every real bar squeezed into the other half, and an axis labelled
 * down to -71% under a heading about growth.
 *
 * SO SYMMETRY IS CONDITIONAL ON THE DATA HAVING BOTH SIGNS:
 *
 *   Both signs present   symmetric, so equal movements draw equal bars and the
 *                        zero line sits in the middle where it belongs.
 *   All positive         zero to the largest increase.
 *   All negative         the largest decrease to zero.
 *   Nothing but zeros    a small symmetric window, so the flat bars have
 *                        somewhere to be drawn rather than collapsing.
 *
 * Zero is always an endpoint or inside the domain, because the zero line is
 * what makes the sign legible and a chart of changes that cannot show it is
 * not a chart of changes.
 */
export interface MoversDomain {
  readonly min: number;
  readonly max: number;
}

/** Headroom past the largest bar, so a value label has room to sit. */
const MOVERS_HEADROOM = 1.15;

/** A domain with nothing in it. Small, symmetric and never zero-width. */
const EMPTY_MOVERS_DOMAIN: MoversDomain = { min: -0.01, max: 0.01 };

export function moversDomain(changes: readonly (number | null)[]): MoversDomain {
  const values = changes.filter(
    (value): value is number => value !== null && Number.isFinite(value),
  );
  if (values.length === 0) return EMPTY_MOVERS_DOMAIN;

  const highest = Math.max(...values);
  const lowest = Math.min(...values);

  const hasPositive = highest > 0;
  const hasNegative = lowest < 0;

  if (!hasPositive && !hasNegative) return EMPTY_MOVERS_DOMAIN;

  if (hasPositive && hasNegative) {
    // Symmetric, because both directions are on screen and a reader compares
    // their lengths.
    const bound = Math.max(Math.abs(highest), Math.abs(lowest)) * MOVERS_HEADROOM;
    return { min: -bound, max: bound };
  }

  if (hasPositive) return { min: 0, max: highest * MOVERS_HEADROOM };
  return { min: lowest * MOVERS_HEADROOM, max: 0 };
}
