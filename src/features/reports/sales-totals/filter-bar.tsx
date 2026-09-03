"use client";

import { cn } from "@/lib/utils/cn";
import type {
  SalesTotalsDateOption,
  SalesTotalsSubject,
} from "@/lib/reporting/read/sales-totals-read";
import {
  SALES_TOTALS_MEASURES,
  SALES_TOTALS_WINDOWS,
  type SalesTotalsWindow,
} from "@/lib/reporting/sales-totals/metric-map";

import {
  MultiSelectMenu,
  SingleSelectMenu,
  useQueryNavigation,
} from "../filter-menu";

/**
 * THE SALES TOTALS FILTER BAR.
 *
 * Rebuilt on the same menus Salon Performance uses, for two reasons beyond
 * consistency.
 *
 * 1. THE SCROLL JUMP. The first version was a wall of inline `<Link>` elements
 *    — fifteen of them for salons alone. Next scrolls to the top of the
 *    document on navigation by default, so changing any filter from halfway
 *    down the page threw the reader back to the header. `useQueryNavigation`
 *    pushes with `scroll: false`, which is the actual fix; nothing about the
 *    layout would have helped.
 *
 * 2. FIFTEEN INLINE BUTTONS DO NOT SCALE, and they could only ever express one
 *    salon at a time. A multi-select is what makes "these four salons" a
 *    question the dashboard can answer.
 *
 * FILTER STATE STAYS IN THE URL. These are client components only so they can
 * open a panel and call the router; no selection is held in React state. A
 * pasted link reproduces exactly what somebody was looking at, refresh is
 * honest, and the server remains the only thing that decides what the numbers
 * are.
 */

export interface SalesTotalsFilters {
  readonly reportDate: string;
  readonly window: SalesTotalsWindow;
  readonly scope: string;
  /** Salon numbers. Empty means every salon in the delivery. */
  readonly salons: readonly string[];
  readonly metric: string;
  readonly sort: string | null;
}

/** The filter state as a query string. One place, so the page can agree. */
export function serializeSalesTotalsFilters(filters: SalesTotalsFilters): URLSearchParams {
  const params = new URLSearchParams();
  params.set("date", filters.reportDate);
  params.set("window", filters.window);
  params.set("scope", filters.scope);
  params.set("metric", filters.metric);
  // Omitted entirely when empty, so "all salons" is the clean default URL
  // rather than `salons=`.
  if (filters.salons.length > 0) params.set("salons", filters.salons.join(","));
  if (filters.sort) params.set("sort", filters.sort);
  return params;
}

export function SalesTotalsFilterBar({
  base,
  filters,
  dates,
  scopes,
  salons,
}: {
  base: string;
  filters: SalesTotalsFilters;
  dates: readonly SalesTotalsDateOption[];
  scopes: readonly SalesTotalsSubject[];
  salons: readonly SalesTotalsSubject[];
}) {
  const { apply, pending } = useQueryNavigation(base);

  function change(next: Partial<SalesTotalsFilters>) {
    apply(serializeSalesTotalsFilters({ ...filters, ...next }));
  }

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2 rounded-[var(--radius-md)] border border-border bg-surface-raised p-2.5",
        pending && "opacity-70",
      )}
    >
      {/*
        WINDOW IS A SEGMENTED CONTROL, not a dropdown. It is the one choice that
        changes what every number on the page MEANS — previous day against month
        to date — so both options stay visible rather than one being hidden
        behind a trigger whose current value has to be remembered.
      */}
      <div
        role="group"
        aria-label="Window"
        className="flex shrink-0 gap-0.5 rounded-[var(--radius-sm)] bg-surface-muted p-0.5"
      >
        {SALES_TOTALS_WINDOWS.map((option) => {
          const active = option.id === filters.window;
          return (
            <button
              key={option.id}
              type="button"
              aria-pressed={active}
              title={option.description}
              onClick={() => change({ window: option.id })}
              className={cn(
                "rounded-[var(--radius-xs)] px-2.5 py-1.5 text-[13px] font-medium transition-colors",
                active
                  ? "bg-selected text-selected-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>

      <SingleSelectMenu
        label="Date"
        // Newest first, ordered by the date the report COVERS rather than when
        // it was ingested, so a late backfill slots into history.
        options={dates.map((date) => ({ value: date.reportDate, label: date.label }))}
        selected={filters.reportDate}
        onChange={(value) => change({ reportDate: value })}
        pending={pending}
      />

      <SingleSelectMenu
        label="Estate scope"
        options={scopes.map((scope) => ({
          value: scope.key,
          label: scope.label,
          note: scope.salonCount ? `${scope.salonCount} salons` : undefined,
        }))}
        selected={filters.scope}
        onChange={(value) => change({ scope: value })}
        pending={pending}
      />

      <SingleSelectMenu
        label="Metric"
        options={SALES_TOTALS_MEASURES.map((measure) => ({
          value: measure.code,
          label: measure.label,
        }))}
        selected={filters.metric}
        onChange={(value) => change({ metric: value })}
        pending={pending}
      />

      <MultiSelectMenu
        label="Salons"
        searchable
        searchPlaceholder="Search salons"
        options={salons.map((salon) => ({
          value: salon.key,
          label: salon.label,
          note: salon.salonNumber ?? undefined,
          // So typing a salon number finds it as readily as a name.
          searchText: salon.salonNumber ?? "",
        }))}
        selected={[...filters.salons]}
        onChange={(values) => change({ salons: values })}
        // Empty means every salon in the delivery, and the trigger says so
        // rather than showing a bare "All" that could be read as the estate.
        emptyLabel={`All ${salons.length}`}
        /*
         * NAMED FOR WHAT IT DOES HERE, not for the mechanism.
         *
         * The action empties the selection, and an empty selection in Sales
         * Totals means every salon in the delivery — so pressing it WIDENS the
         * dashboard back to all of them. Called "Clear", it read as "show me
         * nothing", which is the opposite of what happens; a manager who had
         * four salons selected and wanted the whole delivery back had no way to
         * tell that this was the control for it.
         *
         * The data semantics are untouched: `[]` still means all salons, the
         * URL still omits the parameter, and the action still calls
         * `onChange([])`. Only the word changed, and only for this menu.
         */
        clearLabel="Reset to all"
        footnote="The salons included in this delivery. Selecting several totals their figures."
        pending={pending}
      />
    </div>
  );
}
