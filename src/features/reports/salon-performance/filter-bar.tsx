"use client";

import { RotateCcw } from "lucide-react";

import { cn } from "@/lib/utils/cn";
import { eligibleSalons } from "@/lib/reporting/read/canonical";
import {
  FACET_TO_FIELD,
  hasActiveFilters,
  type ReportFilters,
} from "@/lib/reporting/read/filters";
import type {
  FacetName,
  FilterOptions,
  MetricDescriptor,
  PeriodOption,
  SalonPeriodDescriptors,
} from "@/lib/reporting/read/types";
import type { PerformanceWindow } from "@/lib/reporting/read/windows";
import type { ReportingGrainOption } from "@/lib/reporting/read/views";
import {
  InlineMultiSelect,
  MoreFiltersMenu,
  MultiSelectMenu,
  SingleSelectMenu,
  useFilterNavigation,
  type MenuOption,
} from "./filter-menu";
import { formatPeriodEnd } from "./scope-banner";

/**
 * THE FILTER BAR.
 *
 * Six controls in one line: Period, Window, Metric, District, Salon, More
 * Filters. It replaces a wall of roughly fifty permanent chips, and the count
 * is the point — an early version put every metric, every district and every
 * salon on screen at once, so a manager had to read the filters before they
 * could reach a number.
 *
 * TWO CONTROLS WERE DELIBERATELY REMOVED, and neither is a feature loss.
 *
 *   VIEW asked which sheet of the source workbook to read. That is not a
 *   question a manager can answer, and it was answerable from their real
 *   question anyway: `vs 2024` lives on one sheet, `Last 3 Months` on another,
 *   so choosing the comparison chooses the sheet. Two controls able to disagree
 *   about which sheet is on screen was the shape of the reported bug.
 *
 *   HISTORY offered Weekly / Monthly / Yearly. Every one of them needs several
 *   ingested reporting periods and one is loaded, so the control could only
 *   ever display an unavailable choice as though it were active. It returns —
 *   from the same `reportingGrainOptions` that governs it now — when the
 *   periods behind it genuinely exist.
 *
 * WHAT DECIDES WHETHER A CONTROL APPEARS: the data, not this file. A facet with
 * fewer than two values cannot change the view, so it is not rendered; in this
 * report that removes Company and Comp Salon, because every salon reports the
 * same value for both. A control whose single option is the only one available
 * — one ingested period — is still a real dropdown, so a manager can see where
 * future periods will appear.
 *
 * SECONDARY DIMENSIONS LIVE UNDER `More`. Ownership group, DMA and quintile are
 * real filters that a manager uses occasionally; on the front line they crowd
 * out the ones used constantly.
 */

const FACET_LABELS: Record<FacetName, string> = {
  district: "District",
  region: "Region",
  company: "Company",
  ownership_group: "Ownership group",
  dma: "DMA",
  quintile_group: "Quintile",
  pricing_plan: "Pricing plan",
  market_consolidation: "Market",
  comp_salon: "Comp salon",
};

/**
 * Facets shown on the bar itself, in reading order.
 *
 * District first: it is the one a manager reaches for, and it is the one that
 * narrows the Salon menu below it. Region stays listed because a chain with
 * several regions needs it, and disappears on its own when a period reports
 * only one — `usefulFacets` decides that from the data.
 */
const PRIMARY_FACETS: FacetName[] = ["district", "region"];

/** Facets tucked behind `More`. */
const SECONDARY_FACETS: FacetName[] = ["ownership_group", "dma", "quintile_group", "company"];

/** A facet is only worth a control when it has something to choose between. */
export function usefulFacets(options: FilterOptions, candidates: FacetName[]): FacetName[] {
  return candidates.filter((facet) => (options[facet]?.length ?? 0) > 1);
}

function facetOptions(options: FilterOptions, facet: FacetName): MenuOption[] {
  return (options[facet] ?? []).map((option) => ({
    value: option.value,
    label: option.value,
    note: String(option.salonCount),
  }));
}

export function FilterBar({
  base,
  filters,
  options,
  metrics,
  activeWindowId,
  windows,
  windowAvailability,
  periods,
  grains,
  salons,
  eligibleOf,
  className,
}: {
  /** The dashboard path, without a query string. */
  base: string;
  /** ALREADY SANITIZED. See `read/canonical.ts`. */
  filters: ReportFilters;
  options: FilterOptions;
  /** BASE measures the selected comparison's sheet offers. */
  metrics: MetricDescriptor[];
  /**
   * The window the page RESOLVED to, which may differ from the URL token.
   *
   * Passed separately and used for the trigger, so the control cannot read `—`
   * while the dashboard is showing a real comparison — the two came from
   * different places once, and that is precisely how they disagreed.
   */
  activeWindowId: string;
  /** Every window the report offers, discovered from the catalogue. */
  windows: PerformanceWindow[];
  /** Window id -> whether the report holds figures for the selected measure. */
  windowAvailability: Record<string, boolean>;
  periods: PeriodOption[];
  /**
   * Reporting history grains, each unavailable one carrying its reason.
   *
   * The control appears only when at least one is genuinely available, which is
   * never with a single period loaded — so it is hidden today and turns itself
   * on the day a second report is ingested, with no change here. Hard-coding the
   * hide would work now and stay wrong later.
   */
  grains: ReportingGrainOption[];
  /**
   * The salons a manager may currently choose between: ELIGIBLE, not selected.
   *
   * Narrowed by the district and region filters and by nothing else. Narrowing
   * it by the salon selection too would mean ticking one salon removed every
   * other option, trapping the view with no way back except Reset. Leaving it
   * unnarrowed would offer salons the selected district does not contain — which
   * is what this revision fixes.
   */
  salons: SalonPeriodDescriptors[];
  /** Salons in the whole period, so the menu can say "4 of 15 eligible". */
  eligibleOf: number;
  className?: string;
}) {
  const { apply, pending } = useFilterNavigation(base);

  const selectedMetric = filters.metricCodes[0] ?? null;
  const families = [...new Set(metrics.map((metric) => metric.family))].sort();

  const primary = usefulFacets(options, PRIMARY_FACETS);
  const secondary = usefulFacets(options, SECONDARY_FACETS);

  const secondaryActiveCount = secondary.reduce((count, facet) => {
    const field = FACET_TO_FIELD[facet];
    if (!field) return count;
    return count + (filters[field] as string[]).length;
  }, 0);

  /**
   * Applies a change, dropping salon selections the change makes impossible.
   *
   * THE PRUNING HAPPENS HERE AS WELL AS ON THE SERVER, on purpose. The server
   * canonicalizes whatever URL it is handed, which covers a pasted link and a
   * refresh; this covers the click itself, so the URL that goes into history is
   * already correct and Back does not walk through contradictory states. Both
   * call the same `eligibleSalons`, so they cannot disagree about what a
   * district contains.
   *
   * Deselecting a district REMOVES its salons from the selection rather than
   * keeping them. Keeping them would leave a filter that narrows every number
   * on the page with no control showing it — the hardest kind of wrong for a
   * manager to notice, because the dashboard looks fine and is answering a
   * different question.
   */
  const applyCascading = (next: ReportFilters) => {
    const eligible = new Set(
      eligibleSalons(salons, { ...next, salonNumbers: [] }).map((salon) => salon.salonNumber),
    );
    apply({
      ...next,
      salonNumbers: next.salonNumbers.filter((number) => eligible.has(number)),
    });
  };

  const facetMenu = (facet: FacetName) => {
    const field = FACET_TO_FIELD[facet];
    if (!field) return null;
    const selected = (filters[field] as string[]) ?? [];
    return (
      <MultiSelectMenu
        key={facet}
        label={FACET_LABELS[facet]}
        options={facetOptions(options, facet)}
        selected={selected}
        pending={pending}
        onChange={(values) =>
          applyCascading({ ...filters, [field]: values } as ReportFilters)
        }
      />
    );
  };

  return (
    <div
      className={cn(
        // STICKY, so a manager reading the table two screens down can change a
        // filter without travelling back to the top and losing their place.
        // `top-0` on desktop; the mobile shell has its own 14-unit top bar, so
        // the bar sits below it there. A high-contrast background rather than a
        // translucent one: numbers scrolling underneath a filter control is
        // exactly the kind of thing that makes a dashboard feel unreliable.
        "sticky top-0 z-20 -mx-1 flex flex-wrap items-center gap-2 rounded-xl border",
        "border-border bg-surface p-2.5 shadow-soft lg:top-0",
        className,
      )}
    >
      <SingleSelectMenu
        label="Period"
        selected={filters.periodEnd ?? periods[0]?.periodEnd ?? null}
        pending={pending}
        options={periods.map((period) => ({
          value: period.periodEnd,
          label: `${period.grain.toUpperCase()} ending ${formatPeriodEnd(period.periodEnd)}`,
          note: `${period.salonCount}`,
        }))}
        onChange={(value) => apply({ ...filters, periodEnd: value })}
      />

      <SingleSelectMenu
        label="Window"
        // The RESOLVED window, not the URL token. A token the report does not
        // offer has already been replaced by the nearest valid comparison, and
        // the control must show what the figures below it actually are.
        selected={activeWindowId}
        pending={pending}
        options={windows.map((window) => ({
          value: window.id,
          label: window.shortLabel,
          // Marked, never hidden and never substituted: a measure the source
          // does not report for this window says so once selected.
          unavailable: windowAvailability[window.id] === false,
        }))}
        onChange={(value) => apply({ ...filters, window: value })}
      />

      {/* HISTORY, only once history exists. Weekly / Monthly / Yearly each need
          several ingested periods; with one loaded the control could only
          present an unavailable option as the active selection, which is a
          claim about history we cannot support — and is what it was reported
          doing. Weekly stays listed-and-disabled even then, because the source
          is not produced weekly at all: a different gap from "not yet loaded",
          and one the row says out loud. */}
      {grains.some((grain) => grain.available) ? (
        <SingleSelectMenu
          label="History"
          selected={filters.grain}
          pending={pending}
          // No grain selected is a real, correct state — the dashboard is
          // showing one period's figures — so the trigger says so rather than
          // showing a dash a reader would take for a failure to resolve.
          emptyLabel="None"
          options={grains.map((grain) => ({
            value: grain.id,
            label: grain.label,
            unavailable: !grain.available,
            reason: grain.unavailableReason,
          }))}
          onChange={(value) => apply({ ...filters, grain: value })}
        />
      ) : null}

      <SingleSelectMenu
        label="Metric"
        selected={selectedMetric}
        pending={pending}
        options={metrics.map((metric) => ({ value: metric.code, label: metric.label }))}
        groups={families.map((family) => ({
          key: family,
          label: family,
          values: metrics.filter((metric) => metric.family === family).map((m) => m.code),
        }))}
        onChange={(value) => apply({ ...filters, metricCodes: [value] })}
      />

      {primary.map(facetMenu)}

      {salons.length > 1 ? (
        <MultiSelectMenu
          label="Salon"
          searchable
          searchPlaceholder="Search number or name"
          selected={filters.salonNumbers}
          pending={pending}
          // ELIGIBLE SALONS ONLY. The search box, `Select all` and `Clear` all
          // operate on this list, so selecting a district and pressing Select
          // all selects that district's salons — not the whole report's, which
          // would silently undo the district the manager just chose.
          options={salons.map((salon) => ({
            // Text, so '0468' keeps its leading zero here and in the URL.
            value: salon.salonNumber,
            label: `${salon.salonNumber} · ${salon.storeName}`,
            searchText: salon.storeName,
          }))}
          // Shown only when the eligible set is narrower than the period, so
          // the count appears exactly when it is telling a manager something:
          // that a filter above is already limiting what they can pick.
          footnote={
            salons.length < eligibleOf
              ? `${salons.length} of ${eligibleOf} salons eligible under the current filters`
              : undefined
          }
          onChange={(values) => apply({ ...filters, salonNumbers: values })}
        />
      ) : null}

      {secondary.length > 0 ? (
        <MoreFiltersMenu activeCount={secondaryActiveCount}>
          {/* Rendered INLINE, not as nested dropdowns: see MultiSelectBody. */}
          {secondary.map((facet) => {
            const field = FACET_TO_FIELD[facet];
            if (!field) return null;
            return (
              <InlineMultiSelect
                key={facet}
                label={FACET_LABELS[facet]}
                options={facetOptions(options, facet)}
                selected={(filters[field] as string[]) ?? []}
                onChange={(values) =>
                  applyCascading({ ...filters, [field]: values } as ReportFilters)
                }
              />
            );
          })}
        </MoreFiltersMenu>
      ) : null}

      {hasActiveFilters(filters) ? (
        <button
          type="button"
          onClick={() =>
            apply({
              ...filters,
              districts: [],
              regions: [],
              companies: [],
              ownershipGroups: [],
              dmas: [],
              quintiles: [],
              salonNumbers: [],
              compSalonOnly: null,
            })
          }
          className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-sm)] px-2.5 text-[13px] text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground"
        >
          <RotateCcw aria-hidden className="size-3.5" />
          Reset filters
        </button>
      ) : null}
    </div>
  );
}
