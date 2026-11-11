import "server-only";

import { parseFilters, resolveWindow } from "@/lib/analytics/filters";
import { loadAnalytics } from "@/lib/analytics/queries";
import {
  loadFeedbackAnalytics,
  loadFeedbackPage,
} from "@/lib/analytics/feedback-queries";
import { parseFeedbackFilters } from "@/lib/analytics/feedback-filters";
import { businessToday } from "@/lib/business-date";
import { isDemoMode } from "@/lib/config/runtime";
import {
  demoAnalyticsSnapshot,
  demoFeedbackPage,
  demoFeedbackSnapshot,
} from "@/lib/demo/analytics-fixtures";
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
  const queueFilters = parseFeedbackFilters(searchParams);

  /*
   * DEMO: an invented event log, counted the way the SQL counts it. A demo
   * deployment never holds the Supabase key, so the live reads below threw
   * `MissingConfigurationError` and the whole page crashed. Same shape, so the
   * live screen draws it unchanged. See `lib/demo/analytics-fixtures.ts`.
   */
  if (isDemoMode()) {
    const window = resolveWindow(filters, businessToday());
    const previous = demoAnalyticsSnapshot({
      ...filters,
      from: window.previousFrom.slice(0, 10),
      to: isoDayBefore(window.previousTo),
    });
    return {
      view,
      filters,
      snapshot: demoAnalyticsSnapshot(filters),
      previousCategories: previous.byCategory,
      feedback: demoFeedbackSnapshot(filters),
      queueFilters,
      feedbackPage: view === "feedback" ? demoFeedbackPage(filters, queueFilters) : null,
      demo: true as const,
    };
  }

  /*
   * THE TWO SNAPSHOTS GO TOGETHER, not one after the other. They share the
   * window and the filters and neither depends on the other's result, so
   * running them in sequence would be a second full round trip of latency on
   * every render for no reason.
   */
  const [snapshot, feedback] = await Promise.all([
    loadAnalytics(filters),
    loadFeedbackAnalytics(filters),
  ]);

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

  /*
   * THE COMMENTS ARE FETCHED ONLY FOR THE TAB THAT SHOWS THEM.
   *
   * It is the one query here whose cost grows with the number of complaints,
   * and four of the five views never render a single comment. Loading a page of
   * them to draw the KPI row would be work nobody reads, every time.
   */
  const feedbackPage =
    view === "feedback" ? await loadFeedbackPage(filters, queueFilters) : null;

  return {
    view,
    filters,
    snapshot,
    previousCategories: previousSnapshot.byCategory,
    feedback,
    queueFilters,
    feedbackPage,
    demo: false as const,
  };
}

function isoDayBefore(iso: string): string {
  const day = new Date(Date.parse(iso) - 24 * 60 * 60 * 1000);
  return day.toISOString().slice(0, 10);
}
