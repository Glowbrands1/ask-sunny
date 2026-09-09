import "server-only";

import { SALES_TOTALS_METRIC_CODES } from "../sales-totals/metric-map";
import type { ChatReportContext } from "./chat-report-context";
import type { CatalogPeriod } from "./report-catalog";
import { aggregateSalons, selectionHeading } from "./sales-totals-aggregate";
import {
  buildSalesTotalsBriefing,
  type SalesTotalsWindowBriefing,
} from "./sales-totals-briefing";
import { listSalesTotalsDates, loadSalesTotals } from "./sales-totals-read";
import { orderSalonsByMetric, resolveSalesTotalsSelection } from "./sales-totals-view";

/**
 * ============================================================================
 * LOADING THE SALES TOTALS SECTION
 * ============================================================================
 *
 * The server-only half of `sales-totals-briefing.ts`. It reads the report date
 * the manager was looking at — or the newest, when they were not looking at
 * one — and runs THE SAME resolvers, aggregators and rankers the Sales Totals
 * dashboard runs.
 *
 * WHY IT REUSES THE DASHBOARD'S FUNCTIONS RATHER THAN QUERYING FOR SUMMARIES.
 * If Chat computed its own totals a manager could read $11,838.81 on the tab
 * and be told $11,838.80 in chat, and both would be defensible. There is one
 * implementation of each figure and both surfaces call it. `sales-totals-view.ts`
 * exists precisely because the Ask Sunny panel and the dashboard had to agree
 * about which date, which window and which salons; this is that same agreement
 * extended to the chat pipeline.
 *
 * BOTH WINDOWS, ALWAYS. A manager asking "how are we doing" wants yesterday and
 * the month so far; asking one and getting the other is the wrong answer to the
 * right question. The window pointer from the dashboard decides ORDER — the one
 * the reader was looking at is briefed first — not which windows are read.
 *
 * WHAT IT DOES NOT DO:
 *
 *   IT NEVER THROWS. A reporting outage must not take down the answer path.
 *   Every failure returns null and the pipeline continues without the section.
 *
 *   IT TRUSTS NO FIGURE FROM THE CALLER. The context carries pointers only —
 *   which date, which window, which salons, which measure. Every number below
 *   was read from the database inside this function.
 *
 *   IT DOES NOT CACHE. A delivery lands once a morning and a chat turn is not
 *   hot path enough to justify a cache whose invalidation would be a second
 *   thing to get wrong.
 */

export interface SalesTotalsSection {
  readonly text: string;
  /** The report date actually read, for the composer's provenance line. */
  readonly reportDate: string;
}

export async function loadSalesTotalsSection(
  context: ChatReportContext | null,
  /**
   * The period the composer resolved from the question's own words, when it
   * named one — "last month", "August", "year to date".
   *
   * IT OUTRANKS THE DASHBOARD POINTER, and that is the point of the parameter.
   * A manager who arrives from this tab showing the 3rd and then types "what
   * about last month?" is asking to move; letting the tab's date win would
   * answer the same day twice and look like the question was ignored.
   *
   * Null means the question named no window, and the tab's pointer — or the
   * newest delivery — decides as before.
   */
  resolved: CatalogPeriod | null = null,
): Promise<SalesTotalsSection | null> {
  try {
    const dates = await listSalesTotalsDates();
    if (dates.length === 0) return null;

    /*
     * THE REQUESTED DATE, OR THE NEWEST, AND THE DIFFERENCE IS REPORTED.
     *
     * `resolveReportDate` falls back silently, which is right for a dashboard
     * that also renders a date picker showing what it landed on. Chat has no
     * date picker, so the fallback is detected here and stated in the text — a
     * stale bookmark quietly answering about a different day is the failure.
     *
     * A RESOLVED PERIOD IS NOT A REQUEST AND CANNOT FALL BACK. It was chosen
     * from the periods the catalog listed, so it exists by construction; only a
     * pointer that arrived in a URL can name a delivery this history lacks.
     */
    const requested = resolved
      ? null
      : context?.family === "sales-totals"
        ? context.period
        : null;
    const exact = requested ? dates.find((date) => date.reportDate === requested) : undefined;
    const reportDate = resolved?.end ?? exact?.reportDate ?? dates[0].reportDate;
    const fellBackToNewest = Boolean(requested) && exact === undefined;

    /*
     * Read the window the reader was on FIRST, then the other one. Both are
     * always briefed; the pointer only decides which leads — and a resolved
     * window leads over the pointer, so "month to date" opens on month to date.
     */
    const leading = resolved
      ? resolved.type === "mtd"
        ? "mtd"
        : "daily"
      : context?.family === "sales-totals" && context.window === "mtd"
        ? "mtd"
        : "daily";
    const order = leading === "mtd" ? (["mtd", "daily"] as const) : (["daily", "mtd"] as const);

    const snapshots = await Promise.all(
      order.map((window) => loadSalesTotals({ reportDate, window })),
    );

    const windows: SalesTotalsWindowBriefing[] = [];
    let deliverySalonCount = 0;
    let selectionLabel: string | null = null;

    for (const snapshot of snapshots) {
      if (!snapshot) continue;

      /*
       * THE DASHBOARD'S OWN SELECTION RESOLVER. It drops salon numbers this
       * delivery does not carry rather than erroring, and — importantly — an
       * explicit selection that matched NOTHING stays empty instead of
       * widening to the whole delivery. A filter must never broaden itself,
       * and Chat inheriting a dashboard's filters must not be the exception.
       */
      const view = resolveSalesTotalsSelection(snapshot, {
        // `view` carries the estate summary card the reader had selected;
        // `metric` carries the measure. Two different pointers, and swapping
        // them would rank the salons by whichever card happened to be open.
        estateSummaryKey: context?.family === "sales-totals" ? context.view : null,
        metric: context?.family === "sales-totals" ? context.metric : null,
        salonIds: context?.family === "sales-totals" ? context.salons : null,
      });

      deliverySalonCount = snapshot.salons.length;
      selectionLabel = view.isAllSalons
        ? null
        : selectionHeading(view.selectedSalons, snapshot.salons.length);

      windows.push({
        window: snapshot.window,
        snapshot,
        aggregated: aggregateSalons(view.selectedSalons, SALES_TOTALS_METRIC_CODES),
        // Highest on the selected measure first, through the same ordering the
        // dashboard's ranking chart uses, so the rows a manager is most likely
        // asking about survive truncation.
        salons: orderSalonsByMetric(view.selectedSalons, view.metric.code),
      });
    }

    const text = buildSalesTotalsBriefing({
      windows,
      deliverySalonCount,
      selectionLabel,
      fellBackToNewest,
    });

    return text ? { text, reportDate } : null;
  } catch {
    // Deliberately silent and deliberately not rethrown — see "IT NEVER
    // THROWS" above. The read layer logs its own failures.
    return null;
  }
}
