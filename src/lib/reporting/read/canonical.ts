import { DEFAULT_METRIC_CODE, FACET_TO_FIELD, type ReportFilters } from "./filters";
import type { FacetName, FilterOptions, SalonPeriodDescriptors } from "./types";
import { defaultWindow, type PerformanceWindow } from "./windows";

/**
 * MAKING A FILTER SET CONSISTENT WITH THE DATA IT IS POINTED AT.
 *
 * The dashboard's filters are URL-backed, which is the right decision and is
 * also the source of every bug this module exists to fix. A URL is a set of
 * INDEPENDENT values, and the things they name are not independent:
 *
 *   The comparison window decides which part of the workbook is being read,
 *   which decides which measures exist. Ask for a trailing window and Total
 *   Revenue means one thing; ask for `vs 2024` and it means another; ask for a
 *   trailing window with EFT Revenue and it means nothing at all.
 *
 *   A district selection decides which salons exist. A salon selection made
 *   before a district was chosen may name salons that district does not
 *   contain.
 *
 *   A period decides which districts, salons, measures and comparisons exist —
 *   all of them.
 *
 * Resolving each control separately against the data is what produced the
 * reported bug: every control was individually defensible and the combination
 * was incoherent, so the page fell back per control and landed on `Current MTD`
 * on a sheet with no uncompared figures, then honestly reported that it had
 * nothing to show. Fail-closed behaviour is correct and was working; it was
 * being asked the wrong question.
 *
 * SO THE RULE IS: sanitize the whole set at once, against one period's actual
 * catalogue, and prefer a valid default over an honest refusal WHENEVER ONE
 * EXISTS. The refusal is still there — a manager who explicitly selects a
 * measure the source does not report for the selected window still sees
 * "Unavailable", because that is a real answer to a real question. What is gone
 * is the refusal nobody asked for.
 *
 * NOTHING HERE INVENTS A VALUE. Every default is chosen from what the database
 * returned; every dropped value is reported so the page can say so.
 */

/** Facets whose selections narrow which salons a manager may then pick. */
const CASCADING_FACETS: FacetName[] = [
  "district",
  "region",
  "company",
  "ownership_group",
  "dma",
  "quintile_group",
];

/** Reads the descriptor a facet filters on. */
function descriptorFor(
  salon: SalonPeriodDescriptors,
  facet: FacetName,
): string | null {
  switch (facet) {
    case "district":
      return salon.districtLabel;
    case "region":
      return salon.regionLabel;
    case "company":
      return salon.company;
    case "ownership_group":
      return salon.ownershipGroup;
    case "dma":
      return salon.dma;
    case "quintile_group":
      return salon.quintileGroup;
    default:
      return null;
  }
}

/**
 * The salons a manager may currently choose between.
 *
 * Every descriptor filter applies; the salon selection itself does NOT. That
 * asymmetry is the whole idea. A menu built from the already-narrowed list can
 * never be widened again — tick one salon and every other option disappears,
 * leaving the view trapped with no way back except Reset. So the menu is built
 * from what the OTHER filters admit, and the ticks show which of those are on.
 *
 * With nothing selected this is every salon in the period. Select one district
 * and it is that district's salons. Select two and it is the union, because two
 * districts are two things a manager wants to see, not an impossible salon that
 * belongs to both.
 */
export function eligibleSalons(
  salons: SalonPeriodDescriptors[],
  filters: ReportFilters,
): SalonPeriodDescriptors[] {
  return salons.filter((salon) => {
    for (const facet of CASCADING_FACETS) {
      const field = FACET_TO_FIELD[facet];
      if (!field) continue;
      const selected = (filters[field] as string[]) ?? [];
      if (selected.length === 0) continue;
      const value = descriptorFor(salon, facet);
      // A salon whose descriptor was never reported cannot satisfy a filter on
      // it. Treating null as a match would quietly widen the selection.
      if (value === null || !selected.includes(value)) return false;
    }
    if (filters.compSalonOnly !== null && salon.isCompSalon !== filters.compSalonOnly) {
      return false;
    }
    return true;
  });
}

export interface CanonicalizeInput {
  filters: ReportFilters;
  /** Every window the period offers, each naming its own sheet. */
  windows: PerformanceWindow[];
  /**
   * The measures selectable once the window has chosen a sheet.
   *
   * Passed in rather than derived, because deriving it needs the sheet-scoped
   * catalogue and this module is pure. The caller resolves the window first —
   * `resolveWindow` below is the same resolution, exported so it cannot drift.
   */
  selectableMetricCodes: string[];
  /** Facet values the selected period actually holds. */
  facetOptions: FilterOptions;
  /** Every salon in the selected period, unfiltered. */
  salons: SalonPeriodDescriptors[];
  /** Period ends available, so a link naming a retired period recovers. */
  periodEnds: string[];
  /**
   * The reporting history grains that are genuinely available, by id.
   *
   * A LIST, not a boolean. `historyAvailable: true` was the first shape and it
   * was wrong in a way that only appears once a second period is ingested:
   * monthly becomes available, history is therefore "available", and a stale
   * `grain=weekly` sails through — displayed as the active selection over a
   * source that is not produced weekly at all. Availability is per grain, so
   * the check has to be per grain.
   */
  availableGrains: string[];
}

export interface CanonicalizeResult {
  filters: ReportFilters;
  /** The window the sanitized filters resolve to. Never null. */
  window: PerformanceWindow | null;
  /** True when the incoming filters were not already canonical. */
  changed: boolean;
  /**
   * What was dropped, in a form the page can show a manager.
   *
   * Phrased as the thing that was asked for, not as the field name: "a
   * comparison this report does not offer" tells somebody following a stale
   * link what happened; `vs=current` does not.
   */
  dropped: string[];
}

/**
 * The window a filter set resolves to.
 *
 * One implementation, used both to canonicalize and to render, so the control
 * cannot show one window while the figures come from another — which is exactly
 * what produced a `Window` control reading `—` over a dashboard behaving as
 * `Current MTD`.
 */
export function resolveWindow(
  windows: PerformanceWindow[],
  token: string | null,
  preferredYear: number,
): PerformanceWindow | null {
  const named = windows.find((window) => window.id === token);
  if (named) return named;
  if (windows.length === 0) return null;
  return defaultWindow(windows, preferredYear);
}

/**
 * Brings a filter set into agreement with one period's data.
 *
 * The order of the passes is a dependency order, not a preference:
 *
 *   1. PERIOD, because everything else is scoped to it.
 *   2. WINDOW, because it decides which sheet is read.
 *   3. MEASURE, because which measures exist depends on that sheet.
 *   4. FACETS, against the values the period holds.
 *   5. SALONS, against what the sanitized facets leave eligible.
 *   6. HISTORY, which is dropped entirely until it is real.
 */
export function canonicalizeReportFilters(
  input: CanonicalizeInput,
  options: { preferredYear: number } = { preferredYear: 2024 },
): CanonicalizeResult {
  const dropped: string[] = [];
  const next: ReportFilters = {
    ...input.filters,
    districts: [...input.filters.districts],
    regions: [...input.filters.regions],
    companies: [...input.filters.companies],
    ownershipGroups: [...input.filters.ownershipGroups],
    dmas: [...input.filters.dmas],
    quintiles: [...input.filters.quintiles],
    salonNumbers: [...input.filters.salonNumbers],
    metricCodes: [...input.filters.metricCodes],
  };

  // 1. PERIOD. A link naming a period that is no longer loaded falls back to
  //    the newest, which the caller has already resolved — so `null` here means
  //    "the newest", and that is what an unqualified dashboard link should mean
  //    forever, not a date frozen into a bookmark.
  if (next.periodEnd !== null && !input.periodEnds.includes(next.periodEnd)) {
    dropped.push("a reporting period that is no longer loaded");
    next.periodEnd = null;
  }

  // 2. WINDOW. The sheet follows from it, so it is resolved before anything
  //    that depends on the sheet.
  const window = resolveWindow(input.windows, next.window, options.preferredYear);
  if (window && window.id !== next.window) {
    dropped.push("a comparison this report does not offer");
  }
  if (window) next.window = window.id;

  // The retired sheet selector. Kept parseable so old links resolve rather than
  // error, but never carried forward: the window names the sheet now, and two
  // controls able to disagree about which sheet is on screen is the bug.
  if (next.view !== null) {
    next.view = null;
  }

  // 3. MEASURE. Exactly one, and it must be one this sheet offers. Total
  //    Revenue when the sheet has it, because that is the approved headline
  //    measure; otherwise the first the sheet does offer.
  const selectable = input.selectableMetricCodes;
  const chosen = next.metricCodes[0] ?? null;
  if (selectable.length > 0 && (chosen === null || !selectable.includes(chosen))) {
    if (chosen !== null) dropped.push("a measure this comparison does not report");
    next.metricCodes = [
      selectable.includes(DEFAULT_METRIC_CODE) ? DEFAULT_METRIC_CODE : selectable[0],
    ];
  }

  // 4. FACETS. A value the period does not hold is dropped rather than applied,
  //    because applying it would silently return an empty dashboard.
  for (const facet of CASCADING_FACETS) {
    const field = FACET_TO_FIELD[facet];
    if (!field) continue;
    const available = new Set((input.facetOptions[facet] ?? []).map((option) => option.value));
    const selected = next[field] as string[];
    const kept = selected.filter((value) => available.has(value));
    if (kept.length !== selected.length) {
      dropped.push(`${selected.length - kept.length} ${facet.replace(/_/g, " ")} value${
        selected.length - kept.length === 1 ? "" : "s"
      } not in this period`);
    }
    (next[field] as string[]) = kept;
  }

  // 5. SALONS. Computed from the SANITIZED facets, so deselecting a district
  //    removes its salons from the selection instead of leaving an invisible
  //    contradiction — a filter that narrows the numbers with no control
  //    showing it, which is the hardest kind of wrong for a manager to spot.
  const eligible = new Set(
    eligibleSalons(input.salons, next).map((salon) => salon.salonNumber),
  );
  const keptSalons = next.salonNumbers.filter((number) => eligible.has(number));
  if (keptSalons.length !== next.salonNumbers.length) {
    const lost = next.salonNumbers.length - keptSalons.length;
    dropped.push(`${lost} salon${lost === 1 ? "" : "s"} outside the selected districts`);
  }
  next.salonNumbers = keptSalons;

  // 6. HISTORY. Checked against the grains that are available INDIVIDUALLY.
  //    Weekly is the case that matters: the Comp Report is not produced weekly,
  //    so weekly never becomes available however many periods arrive, and a
  //    `grain=weekly` in a link must never be displayed as an active choice.
  if (next.grain !== null && !input.availableGrains.includes(next.grain)) {
    dropped.push("a reporting history grain this report cannot support");
    next.grain = null;
  }

  return {
    filters: next,
    window,
    changed: !sameFilters(input.filters, next),
    dropped,
  };
}

/** Field-by-field comparison, so an unchanged URL is left completely alone. */
function sameFilters(a: ReportFilters, b: ReportFilters): boolean {
  const sameList = (x: string[], y: string[]) =>
    x.length === y.length && x.every((value, index) => value === y[index]);
  return (
    a.view === b.view &&
    a.grain === b.grain &&
    a.periodEnd === b.periodEnd &&
    a.window === b.window &&
    a.compSalonOnly === b.compSalonOnly &&
    a.sort === b.sort &&
    a.direction === b.direction &&
    sameList(a.metricCodes, b.metricCodes) &&
    sameList(a.districts, b.districts) &&
    sameList(a.regions, b.regions) &&
    sameList(a.companies, b.companies) &&
    sameList(a.ownershipGroups, b.ownershipGroups) &&
    sameList(a.dmas, b.dmas) &&
    sameList(a.quintiles, b.quintiles) &&
    sameList(a.salonNumbers, b.salonNumbers)
  );
}
