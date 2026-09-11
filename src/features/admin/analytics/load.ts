import "server-only";

import { parseFilters, resolveWindow } from "@/lib/analytics/filters";
import { loadAnalytics } from "@/lib/analytics/queries";
import { businessToday } from "@/lib/business-date";
import type { AnalyticsView } from "./analytics-screen";

/**
 * Everything the analytics screen needs, loaded once.
 *
 * Shared by the Overview route and the three view routes so all four read the
 * same filters the same way — four copies of this would be four chances for one
 * tab to interpret `?range=90d` differently from its neighbour.
 *
 * THE PRIOR-PERIOD CATEGORY SPLIT IS FETCHED SEPARATELY, and it is the one
 * thing `loadAnalytics` does not already return. The Usage Types table shows a
 * change per row, so it needs the same breakdown over the preceding window —
 * `loadAnalytics` is given the shifted filters a second time rather than growing
 * a second set of return fields that only one panel reads.
 */
export async function loadAnalyticsPage(
  view: AnalyticsView,
  searchParams: Record<string, string | string[] | undefined>,
) {
  const filters = parseFilters(searchParams);
  const snapshot = await loadAnalytics(filters);

  /*
   * The preceding window as an explicit custom range, so the second call is
   * filtered identically in every other respect. `resolveWindow` already
   * computed those bounds; this converts them back to the dates the filter
   * shape carries.
   */
  const window = resolveWindow(filters, businessToday());
  const previousSnapshot = await loadAnalytics({
    ...filters,
    from: window.previousFrom.slice(0, 10),
    /*
     * `previousTo` is EXCLUSIVE and `filters.to` is inclusive, so a day is
     * subtracted. Without it the prior period would borrow the first day of the
     * current one and every "vs prior" would be quietly wrong by a day.
     */
    to: isoDayBefore(window.previousTo),
  });

  return {
    view,
    filters,
    snapshot,
    previousCategories: previousSnapshot.byCategory,
  };
}

function isoDayBefore(iso: string): string {
  const day = new Date(Date.parse(iso) - 24 * 60 * 60 * 1000);
  return day.toISOString().slice(0, 10);
}
