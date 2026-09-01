import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils/cn";
import {
  BASELINE_LABELS,
  FACET_TO_FIELD,
  hasActiveFilters,
  serializeReportFilters,
  type ReportFilters,
} from "@/lib/reporting/read/filters";
import type {
  FacetName,
  FacetOption,
  FilterOptions,
  MetricDescriptor,
  SalonPeriodDescriptors,
} from "@/lib/reporting/read/types";

/**
 * SHARED FILTERS, AS LINKS.
 *
 * Every control is an anchor to the same page with a different query string, so
 * the whole bar works without JavaScript, the back button behaves, and the URL
 * a manager copies is exactly what they were looking at. The KPI cards, all
 * three charts and the table read the same parsed filter state, so they cannot
 * disagree about what is being shown.
 *
 * A FACET WITH FEWER THAN TWO VALUES IS NOT RENDERED. In this report every
 * salon is a comp salon and every one reports the same company, so those
 * filters could only ever return everything or nothing. Showing a control that
 * cannot change the view is worse than showing nothing: it invites a click and
 * then looks broken.
 */

/** Facets worth offering, in reading order. */
const FACET_ORDER: FacetName[] = [
  "district",
  "region",
  "company",
  "ownership_group",
  "dma",
  "quintile_group",
];

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

/** The rule from the approved decision: hide 0- and 1-option facets. */
export function usefulFacets(options: FilterOptions): FacetName[] {
  return FACET_ORDER.filter((facet) => (options[facet]?.length ?? 0) > 1);
}

function href(base: string, filters: ReportFilters): string {
  const query = serializeReportFilters(filters).toString();
  return query ? `${base}?${query}` : base;
}

/** Adds or removes one value from a multi-select facet. */
function toggled(values: string[], value: string): string[] {
  return values.includes(value)
    ? values.filter((entry) => entry !== value)
    : [...values, value];
}

function FilterGroup({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </p>
      {hint ? <p className="text-xs text-subtle-foreground">{hint}</p> : null}
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

function Chip({
  href: target,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={target}
      aria-current={active ? "true" : undefined}
      className={cn(
        "rounded-full border px-2.5 py-1 text-xs transition-colors",
        active
          ? "border-transparent bg-primary text-primary-foreground"
          : "border-border bg-surface text-muted-foreground hover:border-border-strong hover:text-foreground",
      )}
    >
      {children}
    </Link>
  );
}

export function FilterBar({
  base,
  filters,
  options,
  metrics,
  availableBaselines,
  salons,
  className,
}: {
  /** The dashboard path, without a query string. */
  base: string;
  filters: ReportFilters;
  options: FilterOptions;
  metrics: MetricDescriptor[];
  /** Baseline years present in the data for the selected metric. */
  availableBaselines: number[];
  /**
   * Salons in the report, for the salon filter.
   *
   * Passed UNFILTERED on purpose: a salon filter built from the already-filtered
   * list could never be widened again, so selecting one salon would remove every
   * other option and trap the view.
   */
  salons: SalonPeriodDescriptors[];
  className?: string;
}) {
  const facets = usefulFacets(options);
  const selectedMetric = filters.metricCodes[0];

  // Grouped by family so a long catalogue stays navigable.
  const families = [...new Set(metrics.map((metric) => metric.family))].sort();

  return (
    <div className={cn("space-y-4 rounded-xl border border-border bg-surface p-4", className)}>
      <FilterGroup title="Measure">
        {families.map((family) => (
          <div key={family} className="flex w-full flex-wrap items-center gap-1.5">
            <span className="mr-1 text-xs capitalize text-subtle-foreground">{family}</span>
            {metrics
              .filter((metric) => metric.family === family)
              .map((metric) => (
                <Chip
                  key={metric.code}
                  active={selectedMetric === metric.code}
                  href={href(base, { ...filters, metricCodes: [metric.code] })}
                >
                  {metric.label}
                </Chip>
              ))}
          </div>
        ))}
      </FilterGroup>

      {availableBaselines.length > 1 ? (
        <FilterGroup title="Compare against">
          {availableBaselines.map((year) => (
            <Chip
              key={year}
              active={filters.baselineYear === year}
              href={href(base, { ...filters, baselineYear: year })}
            >
              {/* 2019 always carries its caveat, wherever it appears. */}
              {BASELINE_LABELS[year] ?? `vs ${year}`}
            </Chip>
          ))}
        </FilterGroup>
      ) : null}

      {facets.map((facet) => {
        const field = FACET_TO_FIELD[facet];
        if (!field) return null;
        const selected = (filters[field] as string[]) ?? [];
        const values = options[facet] as FacetOption[];
        return (
          <FilterGroup
            key={facet}
            title={FACET_LABELS[facet]}
            hint={
              facet === "district" || facet === "region"
                ? "Manager name as reported for this period."
                : undefined
            }
          >
            {values.map((option) => (
              <Chip
                key={option.value}
                active={selected.includes(option.value)}
                href={href(base, {
                  ...filters,
                  [field]: toggled(selected, option.value),
                } as ReportFilters)}
              >
                {option.value}
                <span className="ml-1 text-[10px] opacity-70">{option.salonCount}</span>
              </Chip>
            ))}
          </FilterGroup>
        );
      })}

      {salons.length > 1 ? (
        <FilterGroup
          title="Salon"
          hint="Numbers are the business key and keep their leading zero."
        >
          {salons.map((salon) => (
            <Chip
              key={salon.salonNumber}
              active={filters.salonNumbers.includes(salon.salonNumber)}
              href={href(base, {
                ...filters,
                salonNumbers: toggled(filters.salonNumbers, salon.salonNumber),
              })}
            >
              <span className="tabular-nums">{salon.salonNumber}</span>
              <span className="ml-1 opacity-70">{salon.storeName}</span>
            </Chip>
          ))}
        </FilterGroup>
      ) : null}

      {hasActiveFilters(filters) ? (
        <div className="flex items-center gap-2 border-t border-border pt-3">
          <Badge tone="neutral">Filters applied</Badge>
          <Link
            href={base}
            className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            Reset to all salons in this report
          </Link>
        </div>
      ) : null}
    </div>
  );
}
