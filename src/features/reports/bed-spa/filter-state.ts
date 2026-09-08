import { PERFORMANCE_BANDS } from "@/lib/reporting/performance/classification";

/**
 * THE FILTER STATE, AS PURE FUNCTIONS.
 *
 * Split out of `filter-bar.tsx` because that file is `"use client"` and these
 * are called from the SERVER: each report page parses the URL, resolves the
 * filters against what the period actually holds, and builds the sort links.
 * Next refuses to invoke a client function from a server component — correctly,
 * and at RUNTIME rather than at build time, which is how a first revision of
 * this shipped a page that compiled and then rendered nothing at all.
 *
 * So the split is the fix rather than a `"use server"` escape hatch: nothing
 * here touches the router, the DOM or a hook, and the component that does stays
 * where it is.
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


/** An option a menu offers. Built on the server, rendered on the client. */
export interface FilterOption {
  readonly value: string;
  readonly label: string;
  readonly note?: string;
  readonly searchText?: string;
}
