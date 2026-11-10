import Link from "next/link";

import {
  REVIEW_TABS,
  reviewsTabHref,
  type ReviewFilters,
  type ReviewsTab,
} from "@/lib/reviews/filters";
import { cn } from "@/lib/utils/cn";
import { formatNumber } from "@/lib/utils/format";

/**
 * THE FOUR VIEWS OF THE GOOGLE REVIEWS PAGE.
 *
 * ORDINARY LINKS, NOT A TAB WIDGET — the argument `ReportTabs` already makes
 * for the reports strip, and it applies here for the same three reasons: each
 * view is a real URL somebody can send, Back and refresh have to work, and the
 * page is server-rendered so the choice has to arrive with the request. A
 * `role="tablist"` swapping panels in the browser would break all three.
 * `aria-current="page"` is the honest markup for "this link is where you are".
 *
 * THE FILTERS TRAVEL WITH THE READER. Every href carries the filters in force,
 * so narrowing to KS Lawrence on the chart and then opening Google Reviews
 * shows KS Lawrence's reviews rather than silently resetting to the estate.
 *
 * THE COUNTS ARE READ, NEVER ASSERTED. "Needs Response (21)" is the same
 * `summary.unanswered` the tile and the queue read; a badge computed a second
 * way is how a tab and the page behind it start disagreeing.
 */
export function ReviewsTabs({
  filters,
  counts,
  className,
}: {
  filters: ReviewFilters;
  /** The figure to print beside a tab, where one belongs. */
  counts?: Partial<Record<ReviewsTab, number>>;
  className?: string;
}) {
  return (
    <nav
      aria-label="Google Reviews views"
      className={cn(
        /*
         * ITS OWN GUTTER AND ITS OWN GROUND, lining up with the full-bleed band
         * above it.
         *
         * `overflow-x-auto` IS LOAD-BEARING AT PHONE WIDTH: four uppercase
         * labels do not fit on 390px, and wrapping them into two rows reads as
         * two strips rather than one. The container scrolls; the page never
         * moves sideways.
         */
        /* CLAY: a pressed-in pill bar, inset to line up with the clay band above. */
        "scroll-slim mx-3 mt-3 flex items-center gap-1 overflow-x-auto rounded-full bg-surface-muted p-1.5 shadow-dent sm:mx-4",
        className,
      )}
    >
      {REVIEW_TABS.map((tab) => {
        const current = filters.tab === tab.key;
        const count = counts?.[tab.key];
        return (
          <Link
            key={tab.key}
            href={reviewsTabHref(filters, tab.key)}
            aria-current={current ? "page" : undefined}
            className={cn(
              /* The active view takes the 3px brand-yellow underline the
                 reports strip uses, so "which level of the page am I on" reads
                 the same way in both places. */
              "shrink-0 rounded-full px-4 py-2.5 text-[10px] font-black tracking-[0.1em] whitespace-nowrap uppercase transition-[color,background-color,box-shadow]",
              current
                /* CLAY: the active view is a raised yellow pill rather than a
                   3px underline — still the one yellow "which level am I on". */
                ? "bg-brand-yellow text-brand-yellow-foreground clay-fill"
                : "text-muted-foreground hover:bg-surface hover:text-foreground",
            )}
          >
            {tab.label}
            {typeof count === "number" && count > 0 ? (
              <span
                className={cn(
                  "ml-1.5 tabular-nums",
                  current ? "text-measure-flagged-foreground" : "text-muted-foreground",
                )}
              >
                ({formatNumber(count)})
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
