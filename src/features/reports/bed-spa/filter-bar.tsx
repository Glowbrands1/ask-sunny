"use client";

import { cn } from "@/lib/utils/cn";
import {
  periodToken,
  type BedSpaPeriodOption,
} from "@/lib/reporting/read/bed-spa/period-token";
import { PERFORMANCE_BANDS } from "@/lib/reporting/performance/classification";

import { MultiSelectMenu, SingleSelectMenu, useQueryNavigation } from "../filter-menu";

/**
 * THE FILTER BAR THE THREE NEW TABS SHARE.
 *
 * ONLY THE CONTROLS THE REPORT SUPPORTS ARE RENDERED. A `District` menu on a
 * report that carries no district is a control that either does nothing or
 * empties the page, and both teach a manager to distrust the filters. Each
 * control appears when its options are non-empty, so what is on screen is
 * exactly what this report can answer.
 *
 * FILTER STATE STAYS IN THE URL. These are client components only so they can
 * open a panel and call the router; no selection is held in React state. A
 * pasted link reproduces exactly what somebody was looking at, refresh is
 * honest, and the server remains the only thing that decides what the numbers
 * are.
 *
 * NAVIGATION USES `scroll: false`, through `useQueryNavigation`. These pages are
 * taller than a screen and ticking a salon halfway down must not throw the
 * reader back to the header — the same defect Sales Totals had, and the same
 * fix.
 *
 * THE PERIOD TOKEN CARRIES ITS GRAIN. `mtd:2026-08-31` rather than
 * `2026-08-31`, because MTD, YTD and LTM all end on that day and cover 1x, 8x
 * and 12x the sessions. A bare date names one of the three at random.
 */

export interface BedSpaFilters {
  /** `grain:date`. */
  readonly period: string;
  readonly districts: readonly string[];
  readonly regions: readonly string[];
  readonly salons: readonly string[];
  readonly levels: readonly string[];
  readonly bedTypes: readonly string[];
  readonly equipment: readonly string[];
  readonly bands: readonly string[];
  readonly sort: string | null;
  readonly direction: "asc" | "desc" | null;
}

export const EMPTY_BED_SPA_FILTERS: BedSpaFilters = {
  period: "",
  districts: [],
  regions: [],
  salons: [],
  levels: [],
  bedTypes: [],
  equipment: [],
  bands: [],
  sort: null,
  direction: null,
};

/** The filter state as a query string. One place, so the page can agree. */
export function serializeBedSpaFilters(filters: BedSpaFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.period) params.set("period", filters.period);
  // Omitted entirely when empty, so "everything" is the clean default URL
  // rather than `salons=`.
  const list = (name: string, values: readonly string[]) => {
    if (values.length > 0) params.set(name, values.join(","));
  };
  list("district", filters.districts);
  list("region", filters.regions);
  list("salon", filters.salons);
  list("level", filters.levels);
  list("bedType", filters.bedTypes);
  list("equipment", filters.equipment);
  list("band", filters.bands);
  if (filters.sort) params.set("sort", filters.sort);
  if (filters.direction) params.set("dir", filters.direction);
  return params;
}

/** Reads the filter state out of a URL. Unknown values are dropped, not kept. */
export function parseBedSpaFilters(
  params: Record<string, string | string[] | undefined>,
  available: {
    periods: readonly string[];
    districts?: readonly string[];
    regions?: readonly string[];
    salons?: readonly string[];
    levels?: readonly string[];
    bedTypes?: readonly string[];
    equipment?: readonly string[];
    sortFields?: readonly string[];
  },
): { filters: BedSpaFilters; dropped: string[] } {
  const dropped: string[] = [];

  const one = (name: string): string | null => {
    const raw = params[name];
    const value = Array.isArray(raw) ? raw[0] : raw;
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
  };

  /**
   * A comma-separated list, narrowed to the values this period actually holds.
   *
   * A value the period does not hold is DROPPED rather than applied: applying
   * it would silently return an empty dashboard, which is indistinguishable
   * from "this salon did nothing".
   */
  const many = (name: string, allowed: readonly string[] | undefined, label: string): string[] => {
    const raw = one(name);
    if (!raw) return [];
    const requested = raw.split(",").map((value) => value.trim()).filter(Boolean);
    if (!allowed) return requested;
    const kept = requested.filter((value) => allowed.includes(value));
    if (kept.length !== requested.length) {
      const lost = requested.length - kept.length;
      dropped.push(`${lost} ${label} value${lost === 1 ? "" : "s"} not in this period`);
    }
    return kept;
  };

  const period = one("period");
  const direction = one("dir");
  const sort = one("sort");

  return {
    filters: {
      // Validated by `resolvePeriod`, which reports its own fallback.
      period: period && available.periods.includes(period) ? period : (available.periods[0] ?? ""),
      districts: many("district", available.districts, "district"),
      regions: many("region", available.regions, "region"),
      salons: many("salon", available.salons, "salon"),
      levels: many("level", available.levels, "equipment level"),
      bedTypes: many("bedType", available.bedTypes, "bed type"),
      equipment: many("equipment", available.equipment, "equipment"),
      bands: many(
        "band",
        PERFORMANCE_BANDS.map((band) => band.id),
        "performance",
      ),
      sort:
        sort && (!available.sortFields || available.sortFields.includes(sort)) ? sort : null,
      direction: direction === "asc" || direction === "desc" ? direction : null,
    },
    dropped,
  };
}

/** An option a menu offers. */
export interface FilterOption {
  readonly value: string;
  readonly label: string;
  readonly note?: string;
  readonly searchText?: string;
}

export function BedSpaFilterBar({
  base,
  filters,
  periods,
  districts = [],
  regions = [],
  salons = [],
  levels = [],
  bedTypes = [],
  equipment = [],
  /** Whether this report classifies performance at all. */
  showPerformance = false,
  equipmentLabel = "Equipment",
}: {
  base: string;
  filters: BedSpaFilters;
  periods: readonly BedSpaPeriodOption[];
  districts?: readonly FilterOption[];
  regions?: readonly FilterOption[];
  salons?: readonly FilterOption[];
  levels?: readonly FilterOption[];
  bedTypes?: readonly FilterOption[];
  equipment?: readonly FilterOption[];
  showPerformance?: boolean;
  equipmentLabel?: string;
}) {
  const { apply, pending } = useQueryNavigation(base);

  function change(next: Partial<BedSpaFilters>) {
    apply(serializeBedSpaFilters({ ...filters, ...next }));
  }

  const anythingSelected =
    filters.districts.length > 0 ||
    filters.regions.length > 0 ||
    filters.salons.length > 0 ||
    filters.levels.length > 0 ||
    filters.bedTypes.length > 0 ||
    filters.equipment.length > 0 ||
    filters.bands.length > 0;

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2 rounded-[var(--radius-md)] border border-border bg-surface-raised p-2.5",
        pending && "opacity-70",
      )}
    >
      <SingleSelectMenu
        label="Period"
        options={periods.map((period) => ({
          value: periodToken(period),
          label: period.label,
          note: `${period.salonCount} salons`,
        }))}
        selected={filters.period}
        onChange={(value) => change({ period: value })}
        pending={pending}
      />

      {/* Each menu appears only when this report HAS the dimension. A control
          that does nothing teaches a manager to distrust the filters. */}
      {regions.length > 1 ? (
        <MultiSelectMenu
          label="Region"
          options={[...regions]}
          selected={[...filters.regions]}
          onChange={(values) => change({ regions: values, salons: [] })}
          pending={pending}
        />
      ) : null}

      {districts.length > 1 ? (
        <MultiSelectMenu
          label="District"
          options={[...districts]}
          selected={[...filters.districts]}
          // Clearing the salon selection is deliberate: a salon chosen before a
          // district was picked may not be in it, and an invisible contradiction
          // is the hardest kind of wrong for a manager to spot.
          onChange={(values) => change({ districts: values, salons: [] })}
          pending={pending}
        />
      ) : null}

      {salons.length > 1 ? (
        <MultiSelectMenu
          label="Salon"
          searchable
          searchPlaceholder="Search salons"
          options={[...salons]}
          selected={[...filters.salons]}
          onChange={(values) => change({ salons: values })}
          pending={pending}
        />
      ) : null}

      {levels.length > 1 ? (
        <MultiSelectMenu
          label="Equipment level"
          options={[...levels]}
          selected={[...filters.levels]}
          onChange={(values) => change({ levels: values, bedTypes: [] })}
          pending={pending}
        />
      ) : null}

      {bedTypes.length > 1 ? (
        <MultiSelectMenu
          label="Equipment type"
          searchable
          searchPlaceholder="Search equipment"
          options={[...bedTypes]}
          selected={[...filters.bedTypes]}
          onChange={(values) => change({ bedTypes: values })}
          pending={pending}
        />
      ) : null}

      {equipment.length > 1 ? (
        <MultiSelectMenu
          label={equipmentLabel}
          searchable
          searchPlaceholder="Search equipment"
          options={[...equipment]}
          selected={[...filters.equipment]}
          onChange={(values) => change({ equipment: values })}
          pending={pending}
        />
      ) : null}

      {showPerformance ? (
        <MultiSelectMenu
          label="Performance"
          options={PERFORMANCE_BANDS.map((band) => ({
            value: band.id,
            label: band.label,
          }))}
          selected={[...filters.bands]}
          onChange={(values) => change({ bands: values })}
          pending={pending}
        />
      ) : null}

      {anythingSelected ? (
        <button
          type="button"
          onClick={() =>
            change({
              districts: [],
              regions: [],
              salons: [],
              levels: [],
              bedTypes: [],
              equipment: [],
              bands: [],
            })
          }
          className="ml-auto rounded-[var(--radius-sm)] px-2.5 py-1.5 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          {/* Says what it does. "Reset" leaves a reader guessing whether the
              period goes too. */}
          Show all salons
        </button>
      ) : null}
    </div>
  );
}
