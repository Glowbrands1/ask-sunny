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
