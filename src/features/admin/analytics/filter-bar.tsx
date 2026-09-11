"use client";

import { RotateCcw } from "lucide-react";

import { cn } from "@/lib/utils/cn";
import { ROLE_LABEL } from "@/lib/permissions";
import {
  DATE_RANGES,
  EMPTY_FILTERS,
  hasActiveFilters,
  serializeFilters,
  type AnalyticsFilters,
} from "@/lib/analytics/filters";
import type { Role } from "@/types";
import { SingleSelectMenu, useQueryNavigation } from "@/features/reports/filter-menu";

/**
 * THE ANALYTICS FILTER BAR.
 *
 * Four controls and a reset, on one line: Period, District, Location, Role.
 * They are the four questions management actually asks in sequence — when, then
 * where, then who — and stopping at four is deliberate. The reference dashboard
 * this was specified against puts every control and every figure on one endless
 * page; the instruction was to be cleaner than that, and a filter bar is the
 * first place a dashboard gets crowded.
 *
 * THE FILTERS ARE THE URL, NOT COMPONENT STATE. Reached through the same
 * `useQueryNavigation` the Comp Report filters use, so a filtered analytics view
 * is a link somebody can send to the DM it concerns, and so switching tabs
 * carries the filters rather than silently dropping them.
 *
 * LEADER IS NOT A CONTROL HERE, and its absence is the design. Filtering to one
 * person is what clicking their row on By Leader does — a dropdown of every
 * leader in the company would be the longest control on the bar and the least
 * used, and the page already offers the same filter as a gesture.
 */
export function AnalyticsFilterBar({
  base,
  filters,
  districts,
  salons,
  roles,
}: {
  base: string;
  filters: AnalyticsFilters;
  districts: string[];
  salons: { id: string; name: string; district: string | null }[];
  roles: Role[];
}) {
  const { apply, pending } = useQueryNavigation(base);

  const push = (next: AnalyticsFilters) => {
    const query = serializeFilters(next);
    apply(new URLSearchParams(query));
  };

  /*
   * THE LOCATION LIST NARROWS WITH THE DISTRICT, and the selected salon is
   * cleared when it does. Leaving a salon selected from another district would
   * produce an empty page whose two controls contradict each other, with nothing
   * on screen explaining why.
   */
  const visibleSalons = filters.district
    ? salons.filter((salon) => salon.district === filters.district)
    : salons;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <SingleSelectMenu
        label="Period"
        options={DATE_RANGES.map((range) => ({
          value: range.key,
          label: range.label,
        }))}
        selected={filters.range}
        onChange={(value) =>
          push({
            ...filters,
            range: value as AnalyticsFilters["range"],
            /* A named period and a custom one cannot both be in force. */
            from: null,
            to: null,
          })
        }
        pending={pending}
      />

      {/*
        A CONTROL WITH ONE OPTION CANNOT CHANGE THE VIEW, so it is not drawn —
        the same rule the Comp Report filter bar follows. With a single district
        on record, a District dropdown is furniture that implies a choice the
        estate does not have.
      */}
      {districts.length > 1 ? (
        <SingleSelectMenu
          label="District"
          options={[
            { value: "", label: "All districts" },
            ...districts.map((district) => ({
              value: district,
              label: district,
            })),
          ]}
          selected={filters.district ?? ""}
          onChange={(value) =>
            push({
              ...filters,
              district: value === "" ? null : value,
              salonId: null,
            })
          }
          pending={pending}
          emptyLabel="All districts"
        />
      ) : null}

      {salons.length > 1 ? (
        <SingleSelectMenu
          label="Location"
          options={[
            { value: "", label: "All locations" },
            ...visibleSalons.map((salon) => ({
              value: salon.id,
              label: salon.name,
              note: salon.district ?? undefined,
              searchText: salon.district ?? undefined,
            })),
          ]}
          selected={filters.salonId ?? ""}
          onChange={(value) =>
            push({ ...filters, salonId: value === "" ? null : value })
          }
          pending={pending}
          emptyLabel="All locations"
        />
      ) : null}

      <SingleSelectMenu
        label="Role"
        options={[
          { value: "", label: "All roles" },
          ...roles.map((role) => ({ value: role, label: ROLE_LABEL[role] })),
        ]}
        selected={filters.role ?? ""}
        onChange={(value) =>
          push({ ...filters, role: value === "" ? null : (value as Role) })
        }
        pending={pending}
        emptyLabel="All roles"
      />

      {/*
        RESET APPEARS ONLY WHEN THERE IS SOMETHING TO RESET. A permanently
        visible Reset on an unfiltered view is a button that does nothing, and
        it trains people to ignore it on the view where it matters.
      */}
      {hasActiveFilters(filters) ? (
        <button
          type="button"
          onClick={() => push(EMPTY_FILTERS)}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5",
            "text-[11.5px] font-medium text-muted-foreground",
            "transition-colors hover:bg-hover-surface hover:text-foreground",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
          )}
        >
          <RotateCcw aria-hidden className="size-3.5" />
          Reset filters
        </button>
      ) : null}
    </div>
  );
}
