"use client";

import {
  periodToken,
  type BedSpaPeriodOption,
} from "@/lib/reporting/read/bed-spa/period-token";
import { PERFORMANCE_BANDS } from "@/lib/reporting/performance/classification";

import { MultiSelectMenu, SingleSelectMenu, useQueryNavigation } from "../filter-menu";
import { FilterRow } from "../filter-row";
import {
  serializeBedSpaFilters,
  type BedSpaFilters,
  type FilterOption,
} from "./filter-state";

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

  /*
   * WHICH CONTROLS LEAD, AND WHICH GO BEHIND "MORE FILTERS".
   *
   * Period, District and Salon lead on all three tabs: they are the dimensions
   * a district manager changes to answer a question about their own patch, and
   * the artifact's own filter row leads with exactly these.
   *
   * Region, the two equipment dimensions and the performance band are the
   * secondary set. Every one of them still renders — behind the pill, which
   * counts the ones holding a selection so a narrowed view can never look like
   * a full one.
   */
  const secondary = [
    regions.length > 1 ? (
      <MultiSelectMenu
        key="region"
        label="Region"
        options={[...regions]}
        selected={[...filters.regions]}
        onChange={(values) => change({ regions: values, salons: [] })}
        pending={pending}
      />
    ) : null,
    levels.length > 1 ? (
      <MultiSelectMenu
        key="level"
        label="Equipment level"
        options={[...levels]}
        selected={[...filters.levels]}
        onChange={(values) => change({ levels: values, bedTypes: [] })}
        pending={pending}
      />
    ) : null,
    bedTypes.length > 1 ? (
      <MultiSelectMenu
        key="bed-type"
        label="Equipment type"
        searchable
        searchPlaceholder="Search equipment"
        options={[...bedTypes]}
        selected={[...filters.bedTypes]}
        onChange={(values) => change({ bedTypes: values })}
        pending={pending}
      />
    ) : null,
    equipment.length > 1 ? (
      <MultiSelectMenu
        key="equipment"
        label={equipmentLabel}
        searchable
        searchPlaceholder="Search equipment"
        options={[...equipment]}
        selected={[...filters.equipment]}
        onChange={(values) => change({ equipment: values })}
        pending={pending}
      />
    ) : null,
    showPerformance ? (
      <MultiSelectMenu
        key="performance"
        label="Performance"
        options={PERFORMANCE_BANDS.map((band) => ({
          value: band.id,
          label: band.label,
        }))}
        selected={[...filters.bands]}
        onChange={(values) => change({ bands: values })}
        pending={pending}
      />
    ) : null,
  ].filter(Boolean);

  /* Counted from the URL-backed selections, not from what is on screen. */
  const secondaryActive =
    (filters.regions.length > 0 ? 1 : 0) +
    (filters.levels.length > 0 ? 1 : 0) +
    (filters.bedTypes.length > 0 ? 1 : 0) +
    (filters.equipment.length > 0 ? 1 : 0) +
    (filters.bands.length > 0 ? 1 : 0);

  return (
    <FilterRow
      pending={pending}
      more={secondary.length > 0 ? secondary : undefined}
      activeCount={secondaryActive}
      action={
        anythingSelected ? (
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
            className="rounded-[var(--radius-sm)] px-2.5 py-1.5 text-[11.5px] font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            {/* Says what it does. "Reset" leaves a reader guessing whether the
                period goes too. */}
            Show all salons
          </button>
        ) : null
      }
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
    </FilterRow>
  );
}
