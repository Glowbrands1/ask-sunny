import Link from "next/link";

import { cn } from "@/lib/utils/cn";
import { formatNumber } from "@/lib/utils/format";
import { serializeFilters, type AnalyticsFilters } from "@/lib/analytics/filters";

/**
 * THE ADOPTION GAP, stated rather than implied.
 *
 * This is the panel management came for. "MO Kansas City Wornall filed seven
 * forms" is mildly interesting; "twelve of fifteen salons have filed nothing
 * this month" is the sentence somebody acts on, and until it is written down as
 * a number it has to be counted by eye from a table of zeros.
 *
 * TWO FIGURES AND A TOGGLE. Active out of total, inactive on its own, and a
 * control that reduces the table below to exactly those inactive rows. The
 * toggle is a LINK carrying every other filter, so "inactive locations in this
 * district over the last 90 days" is a URL somebody can send.
 *
 * NEITHER FIGURE IS COLOURED RED. A salon that has not started is a fact, not a
 * measure short of a target the business set, and this system reserves the coral
 * flag for the latter. The emphasis is size and a word.
 */
export function AdoptionGapPanel({
  noun,
  pluralNoun,
  total,
  inactive,
  filters,
  base,
}: {
  /** Singular label, e.g. "location". */
  noun: string;
  /** Plural label, e.g. "locations". */
  pluralNoun: string;
  total: number;
  inactive: number;
  filters: AnalyticsFilters;
  base: string;
}) {
  const active = total - inactive;

  const toggleHref = (() => {
    const query = serializeFilters({
      ...filters,
      inactiveOnly: !filters.inactiveOnly,
    });
    return query ? `${base}?${query}` : base;
  })();

  return (
    <div className="rounded-[var(--radius-lg)] border border-border bg-surface px-5 py-4 shadow-soft">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-wrap items-end gap-8">
          <div>
            <p className="eyebrow">Active {pluralNoun}</p>
            <p className="display-figure mt-1.5 text-[30px] text-foreground">
              {formatNumber(active)}
              {/*
                THE DENOMINATOR IS PART OF THE FIGURE. "3" cannot be read; "3 of
                15" is the whole finding, so the total is set beside it at a
                smaller size rather than left to a caption underneath.
              */}
              <span className="ml-1 text-[18px] text-muted-foreground">
                / {formatNumber(total)}
              </span>
            </p>
          </div>

          <div>
            <p className="eyebrow">Inactive {pluralNoun}</p>
            <p className="display-figure mt-1.5 text-[30px] text-foreground">
              {formatNumber(inactive)}
            </p>
          </div>
        </div>

        {/*
          The toggle is only useful when there is something to toggle TO. With
          nothing inactive it would filter the table to nothing and read as a
          broken control rather than as good news.
        */}
        {inactive > 0 || filters.inactiveOnly ? (
          <Link
            href={toggleHref}
            aria-pressed={filters.inactiveOnly}
            className={cn(
              "inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5",
              "text-[11.5px] font-medium transition-colors",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
              filters.inactiveOnly
                ? "border-transparent bg-selected text-selected-foreground"
                : "border-border text-muted-foreground hover:bg-hover-surface hover:text-foreground",
            )}
          >
            {filters.inactiveOnly
              ? `Showing inactive only — show all ${pluralNoun}`
              : `Show inactive only`}
          </Link>
        ) : null}
      </div>

      <p className="mt-3 text-[11.5px] leading-relaxed text-muted-foreground">
        {inactive === 0
          ? `Every ${noun} on the roster recorded activity in this period.`
          : `${formatNumber(inactive)} ${
              inactive === 1 ? noun : pluralNoun
            } recorded no activity in this period. The counts above describe the whole roster and do not change when the table is filtered.`}
      </p>
    </div>
  );
}
