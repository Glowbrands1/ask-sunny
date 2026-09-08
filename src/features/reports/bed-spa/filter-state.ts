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
  /*
   * ONE PARAMETER PER VALUE, not one parameter holding a joined list.
   *
   * This used to be `values.join(",")`, and the District and Region values in
   * these reports are MANAGER NAMES written surname-first — `Cotton, Sarah`.
   * Every one of them contains the separator. Selecting a district produced
   * `district=Cotton%2C+Sarah`, which parsed back as two values, `Cotton` and
   * `Sarah`, neither of which the period recognised. Both were dropped, the
   * filter came back empty, and the dashboard showed all fifteen salons however
   * many boxes were ticked.
   *
   * Repeating the parameter removes the separator from the problem entirely,
   * rather than choosing a different character and hoping no label ever
   * contains that one either. `URLSearchParams.getAll` and Next's own
   * `searchParams` both give the values back as a list.
   *
   * Still omitted entirely when empty, so "everything" is a clean URL and
   * Select All is the ABSENCE of the parameter rather than a list of all three.
   */
  const list = (name: string, values: readonly string[]) => {
    for (const value of values) params.append(name, value);
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
   * A repeated parameter, narrowed to the values this period actually holds.
   *
   * A value the period does not hold is DROPPED rather than applied: applying
   * it would silently return an empty dashboard, which is indistinguishable
   * from "this salon did nothing".
   *
   * AN EXACT MATCH BEATS SPLITTING, and that single rule is what lets one
   * parser read both shapes of URL:
   *
   *   `district=Cotton%2C+Sarah`   one value the period recognises. Kept whole,
   *                                because the comma is part of a manager's
   *                                name and not a separator.
   *   `level=FAST,INSTANT`         a bookmark from before the serializer
   *                                repeated the parameter. Neither part
   *                                contains a comma, so splitting is the right
   *                                reading and the old link keeps working.
   *
   * So a value is checked against the allowlist verbatim FIRST, and only a
   * value the period does not recognise is split and its parts re-checked.
   * Getting that order wrong is the whole bug: splitting first turned every
   * district into two names that matched nothing.
   */
  const many = (name: string, allowed: readonly string[] | undefined, label: string): string[] => {
    const raw = params[name];
    const presented = (Array.isArray(raw) ? raw : raw === undefined ? [] : [raw])
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
    if (presented.length === 0) return [];

    /*
     * A REPEATED PARAMETER IS ALREADY DELIMITED, so its values are never split.
     * Only a LONE value is a candidate for the legacy joined reading, and only
     * when the period does not recognise it as it stands.
     *
     * Splitting an array element as well would be both unnecessary and
     * misleading: `district=Cotton%2C+Sarah&district=Invented%2C+Nobody` would
     * report TWO unrecognised districts for one unrecognised selection,
     * because the failing name would be torn into a surname and a forename.
     */
    const requested: string[] = presented.flatMap((value) => {
      if (allowed?.includes(value)) return [value];
      if (Array.isArray(raw)) return [value];
      const parts = value.split(",").map((part) => part.trim()).filter(Boolean);
      return parts.length > 0 ? parts : [value];
    });

    // A value presented twice is one selection, not two.
    const unique = [...new Set(requested)];
    if (!allowed) return unique;

    const kept = unique.filter((value) => allowed.includes(value));
    if (kept.length !== unique.length) {
      const lost = unique.length - kept.length;
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

/**
 * The salon-level facets, as the shape every report row already has.
 *
 * Structural rather than a named row type, because the three reports carry
 * different measures and only these three fields are filtered on.
 */
export interface SalonFacets {
  readonly salonNumber: string | null;
  readonly districtLabel: string | null;
  readonly regionLabel: string | null;
}

/**
 * Whether the district, region and salon filters admit one salon.
 *
 * ONE IMPLEMENTATION, SHARED BY THE THREE PAGES. It was three identical
 * copies — Bed Usage, SPA Wellness and Spa Engagement each wrote the same
 * three conditions — which is three places for the district filter to be
 * subtly different and no single place to test it.
 *
 * AN EMPTY FILTER ADMITS EVERYTHING. That is what makes Select All the absence
 * of a parameter rather than a list of every value, and it is why a broken
 * parse showed the whole estate instead of an empty dashboard: the filter did
 * not fail, it simply never arrived.
 *
 * A NULL LABEL IS NOT A MATCH. A salon whose district the Comp Report has not
 * loaded for this period is excluded by a district filter rather than admitted
 * by default — being unattributed is not the same as belonging to whichever
 * district was picked.
 */
export function admitsSalon(
  filters: Pick<BedSpaFilters, "districts" | "regions" | "salons">,
  salon: SalonFacets,
): boolean {
  if (
    filters.districts.length > 0 &&
    (salon.districtLabel === null || !filters.districts.includes(salon.districtLabel))
  ) {
    return false;
  }
  if (
    filters.regions.length > 0 &&
    (salon.regionLabel === null || !filters.regions.includes(salon.regionLabel))
  ) {
    return false;
  }
  if (
    filters.salons.length > 0 &&
    (salon.salonNumber === null || !filters.salons.includes(salon.salonNumber))
  ) {
    return false;
  }
  return true;
}
