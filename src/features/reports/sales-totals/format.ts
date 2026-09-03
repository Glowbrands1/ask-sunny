/**
 * Formatting for Sales Totals figures.
 *
 * Separate from the Comp Report's formatter because the units differ: this
 * report has no percentages and its currency figures are small enough that
 * compacting them to "$1.6K" would throw away the cents a manager is checking.
 */

/** `818.45` + currency -> `$818.45`; `239` + count -> `239`. */
export function formatSalesTotalsValue(
  value: number,
  unit: "currency" | "count",
): string {
  if (unit === "currency") {
    return value.toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }
  // Counts are whole things. A fractional tan would be a parsing fault, so it
  // is shown rather than rounded away.
  return Number.isInteger(value)
    ? value.toLocaleString("en-US")
    : value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/** Axis and chip form, where space is tight but cents still matter. */
export function formatSalesTotalsCompact(
  value: number,
  unit: "currency" | "count",
): string {
  if (unit === "currency") {
    return value >= 10_000
      ? `$${(value / 1000).toLocaleString("en-US", { maximumFractionDigits: 1 })}K`
      : value.toLocaleString("en-US", {
          style: "currency",
          currency: "USD",
          maximumFractionDigits: 0,
        });
  }
  return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
}
