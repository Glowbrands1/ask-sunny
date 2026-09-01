"use client";

import { RotateCcw } from "lucide-react";

import { cn } from "@/lib/utils/cn";
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
import {
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
 * Seven controls in one line: Period, Performance Window, Metric, Region,
 * District, Salon, More Filters. It replaces a wall of roughly fifty permanent
 * chips, and the count is the point — the previous version put every metric,
 * every district and every salon on screen at once, so a manager had to read
 * the filters before they could reach a number.
 *
 * WHAT DECIDES WHETHER A CONTROL APPEARS: the data, not this file. A facet with
 * fewer than two values cannot change the view, so it is not rendered; in this
 * report that removes Company and Comp Salon, because every salon reports the
 * same value for both. A control whose single option is the only one available
 * — one ingested period — renders as a label rather than a dropdown that opens
 * onto one row.
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

/** Facets shown on the bar itself, in reading order. */
const PRIMARY_FACETS: FacetName[] = ["region", "district"];

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
  windows,
  windowAvailability,
  periods,
  salons,
  className,
}: {
  /** The dashboard path, without a query string. */
  base: string;
  filters: ReportFilters;
  options: FilterOptions;
  /** BASE measures only. A `% change` metric is expressed by the window. */
  metrics: MetricDescriptor[];
  /** Every window the report offers, discovered from the catalogue. */
  windows: PerformanceWindow[];
  /** Window id -> whether the report holds figures for the selected measure. */
  windowAvailability: Record<string, boolean>;
  periods: PeriodOption[];
  /**
   * Salons in the report, UNFILTERED on purpose.
   *
   * A salon menu built from the already-filtered list could never be widened
   * again: selecting one salon would remove every other option and trap the
   * view with no way back except the reset link.
   */
  salons: SalonPeriodDescriptors[];
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
        onChange={(values) => apply({ ...filters, [field]: values } as ReportFilters)}
      />
    );
  };

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface p-2.5",
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
        selected={filters.window}
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
          options={salons.map((salon) => ({
            // Text, so '0468' keeps its leading zero here and in the URL.
            value: salon.salonNumber,
            label: `${salon.salonNumber} · ${salon.storeName}`,
            searchText: salon.storeName,
          }))}
          onChange={(values) => apply({ ...filters, salonNumbers: values })}
        />
      ) : null}

      {secondary.length > 0 ? (
        <MoreFiltersMenu activeCount={secondaryActiveCount}>
          {secondary.map((facet) => (
            <div key={facet} className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">
                {FACET_LABELS[facet]}
                {facet === "district" || facet === "region" ? (
                  <span className="ml-1 font-normal text-subtle-foreground">
                    manager name as reported
                  </span>
                ) : null}
              </p>
              {facetMenu(facet)}
            </div>
          ))}
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
