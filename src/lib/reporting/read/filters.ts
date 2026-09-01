import { METRICS_BY_CODE } from "../comp-sales/metric-catalogue";
import { SALON_NUMBER_PATTERN } from "../salon-number";
import type { FacetName } from "./types";
import { isWindowToken } from "./windows";

/**
 * FILTER STATE LIVES IN THE URL.
 *
 * Not in a client store, and deliberately so: shared filters across every view
 * come free, a link a district manager pastes into Teams reproduces exactly
 * what they were looking at, the back button behaves, and the page can be
 * rendered on the server with no hydration dance.
 *
 * Everything arriving from a query string is untrusted. Metric codes are
 * checked against the reviewed catalogue, years against a plausible range,
 * salon numbers against the schema's own text key. An unrecognised value is
 * DROPPED and reported in `ignored`, never passed through to a query — that is
 * what stops a crafted parameter from reaching anything, and it also means a
 * stale bookmark degrades to a sane view instead of an error page.
 */

/** The four metrics the KPI row shows unless the user chooses otherwise. */
export const HEADLINE_METRIC_CODES = [
  "total_revenue",
  "eft_revenue",
  "total_tans",
  "unique_tanners",
] as const;

/**
 * The comparison the dashboard opens on.
 *
 * 2024, not 2019: the 2019 block's comparison population is still unconfirmed,
 * so it is only ever an explicit choice. Stored as a WINDOW TOKEN rather than a
 * year, because a window can also be a rolling one the source computed — see
 * `./windows`. A bare year is a valid token, so every link shared before
 * windows existed still resolves.
 */
export const DEFAULT_WINDOW_TOKEN = "2024";

/** The year `defaultWindow` looks for first when resolving what to open on. */
export const PREFERRED_BASELINE_YEAR = 2024;

/** The year the report treats as current. Read from the data, not assumed. */
export const CURRENT_BASIS_YEAR = 2026;

/** The one measure the charts and the table show. Never more than one. */
export const DEFAULT_METRIC_CODE = "total_revenue";

export type RankingSort = "value" | "change" | "salon";
export type SortDirection = "asc" | "desc";

export interface ReportFilters {
  /** ISO date. Null means "the most recent period available". */
  periodEnd: string | null;
  /**
   * The selected performance window, as its token.
   *
   * Resolved against the windows the report actually offers, in `./windows`.
   * Kept as a token here so this module stays pure: what a report holds is a
   * question for the database, not for a query-string parser.
   */
  window: string;
  /** Metrics selected for the KPI row / charts. Never empty. */
  metricCodes: string[];
  districts: string[];
  regions: string[];
  companies: string[];
  ownershipGroups: string[];
  dmas: string[];
  quintiles: string[];
  /** Null = no preference; true = comp salons only; false = non-comp only. */
  compSalonOnly: boolean | null;
  salonNumbers: string[];
  sort: RankingSort;
  direction: SortDirection;
}

/**
 * The default view.
 *
 * DEEPLY FROZEN, and the freeze is load-bearing rather than decorative. An
 * earlier revision built parsed filters with `{ ...DEFAULT_FILTERS }`, which
 * copies the object but SHARES its arrays — so `salonNumbers.push(...)` while
 * parsing one request permanently polluted the default for every request after
 * it, in a long-lived server process. `freshFilters()` below now copies each
 * array, and freezing this object makes the old mistake throw instead of
 * silently corrupting state.
 */
export const DEFAULT_FILTERS: ReportFilters = Object.freeze({
  periodEnd: null,
  window: DEFAULT_WINDOW_TOKEN,
  compSalonOnly: null,
  sort: "value",
  direction: "desc",
  districts: Object.freeze([]) as unknown as string[],
  regions: Object.freeze([]) as unknown as string[],
  companies: Object.freeze([]) as unknown as string[],
  ownershipGroups: Object.freeze([]) as unknown as string[],
  dmas: Object.freeze([]) as unknown as string[],
  quintiles: Object.freeze([]) as unknown as string[],
  salonNumbers: Object.freeze([]) as unknown as string[],
  metricCodes: Object.freeze([DEFAULT_METRIC_CODE]) as unknown as string[],
});

/** A mutable filter set at its defaults, with arrays of its own. */
function freshFilters(): ReportFilters {
  return {
    periodEnd: null,
    window: DEFAULT_WINDOW_TOKEN,
    metricCodes: [],
    districts: [],
    regions: [],
    companies: [],
    ownershipGroups: [],
    dmas: [],
    quintiles: [],
    compSalonOnly: null,
    salonNumbers: [],
    sort: "value",
    direction: "desc",
  };
}

/** Query-string keys. Short, because these end up in pasted links. */
const KEYS = {
  periodEnd: "period",
  window: "vs",
  metricCodes: "metric",
  districts: "district",
  regions: "region",
  companies: "company",
  ownershipGroups: "owner",
  dmas: "dma",
  quintiles: "quintile",
  compSalonOnly: "comp",
  salonNumbers: "salon",
  sort: "sort",
  direction: "dir",
} as const;

/** Maps a facet name to the filter field it drives. */
export const FACET_TO_FIELD: Partial<Record<FacetName, keyof ReportFilters>> = {
  district: "districts",
  region: "regions",
  company: "companies",
  ownership_group: "ownershipGroups",
  dma: "dmas",
  quintile_group: "quintiles",
};

/** Accepts the several shapes Next hands a route for search params. */
export type RawSearchParams =
  | URLSearchParams
  | Record<string, string | string[] | undefined>;

function readParam(params: RawSearchParams, key: string): string[] {
  if (params instanceof URLSearchParams) return params.getAll(key);
  const value = params[key];
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

/** Splits comma-separated values, trims, drops blanks, de-duplicates. */
function splitValues(raw: string[]): string[] {
  const parts = raw
    .flatMap((entry) => entry.split(","))
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return [...new Set(parts)];
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A facet value the UI may echo back: bounded length, and no control
 * characters.
 *
 * Written as a code-point scan rather than a regex character class because the
 * range being excluded is exactly the characters that are invisible in source.
 */
function isSafeLabel(value: string): boolean {
  if (value.length === 0 || value.length > 120) return false;
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return false;
  }
  return true;
}

export interface ParsedFilters {
  filters: ReportFilters;
  /**
   * Values that were dropped, so the UI can say "2 filters from this link are
   * no longer available" rather than silently showing something different.
   */
  ignored: string[];
}

export function parseReportFilters(params: RawSearchParams): ParsedFilters {
  const ignored: string[] = [];
  const filters: ReportFilters = freshFilters();

  const periodEnd = splitValues(readParam(params, KEYS.periodEnd))[0];
  if (periodEnd !== undefined) {
    if (ISO_DATE.test(periodEnd)) filters.periodEnd = periodEnd;
    else ignored.push(`${KEYS.periodEnd}=${periodEnd}`);
  }

  const window = splitValues(readParam(params, KEYS.window))[0];
  if (window !== undefined) {
    // Shape only. Whether the report HOLDS this window is decided against the
    // live catalogue, which a pure parser has no business knowing.
    if (isWindowToken(window)) filters.window = window;
    else ignored.push(`${KEYS.window}=${window.slice(0, 24)}`);
  }

  // A parser may not invent a metric, and neither may a URL.
  //
  // Only BASE measures are selectable. A `% change` code used to be pickable as
  // a measure in its own right, which meant a manager could choose "Total
  // Revenue % Change" and then also choose a comparison window — two ways of
  // saying the same thing, able to disagree. The change is now expressed by the
  // window alone, so a `% change` code arriving in a link is dropped and
  // reported rather than honoured.
  for (const code of splitValues(readParam(params, KEYS.metricCodes))) {
    const metric = METRICS_BY_CODE.get(code);
    if (metric && metric.kind === "base") filters.metricCodes.push(code);
    else ignored.push(`${KEYS.metricCodes}=${code.slice(0, 40)}`);
  }
  // Exactly one measure drives the charts and the table.
  filters.metricCodes = filters.metricCodes.slice(0, 1);
  if (filters.metricCodes.length === 0) filters.metricCodes = [DEFAULT_METRIC_CODE];

  const labelFields: [keyof ReportFilters, string][] = [
    ["districts", KEYS.districts],
    ["regions", KEYS.regions],
    ["companies", KEYS.companies],
    ["ownershipGroups", KEYS.ownershipGroups],
    ["dmas", KEYS.dmas],
    ["quintiles", KEYS.quintiles],
  ];
  for (const [field, key] of labelFields) {
    const kept: string[] = [];
    for (const value of splitValues(readParam(params, key))) {
      if (isSafeLabel(value)) kept.push(value);
      else ignored.push(`${key}=${value.slice(0, 24)}`);
    }
    (filters[field] as string[]) = kept;
  }

  const comp = splitValues(readParam(params, KEYS.compSalonOnly))[0];
  if (comp !== undefined) {
    if (comp === "true" || comp === "1") filters.compSalonOnly = true;
    else if (comp === "false" || comp === "0") filters.compSalonOnly = false;
    else ignored.push(`${KEYS.compSalonOnly}=${comp}`);
  }

  for (const value of splitValues(readParam(params, KEYS.salonNumbers))) {
    // The schema's own text key. '0468' survives; nothing else gets through.
    if (SALON_NUMBER_PATTERN.test(value)) filters.salonNumbers.push(value);
    else ignored.push(`${KEYS.salonNumbers}=${value.slice(0, 24)}`);
  }

  const sort = splitValues(readParam(params, KEYS.sort))[0];
  if (sort !== undefined) {
    if (sort === "value" || sort === "change" || sort === "salon") filters.sort = sort;
    else ignored.push(`${KEYS.sort}=${sort}`);
  }

  const direction = splitValues(readParam(params, KEYS.direction))[0];
  if (direction !== undefined) {
    if (direction === "asc" || direction === "desc") filters.direction = direction;
    else ignored.push(`${KEYS.direction}=${direction}`);
  }

  return { filters, ignored };
}

/**
 * Serialises filters back to a query string, omitting anything at its default.
 *
 * Omitting defaults keeps shared links short and, more usefully, makes them
 * stable: two people who have not changed a filter produce the same URL.
 */
export function serializeReportFilters(filters: ReportFilters): URLSearchParams {
  const params = new URLSearchParams();

  if (filters.periodEnd) params.set(KEYS.periodEnd, filters.periodEnd);
  if (filters.window !== DEFAULT_WINDOW_TOKEN) params.set(KEYS.window, filters.window);

  const selected = [...filters.metricCodes].join(",");
  if (selected !== DEFAULT_METRIC_CODE) params.set(KEYS.metricCodes, selected);

  const labelFields: [keyof ReportFilters, string][] = [
    ["districts", KEYS.districts],
    ["regions", KEYS.regions],
    ["companies", KEYS.companies],
    ["ownershipGroups", KEYS.ownershipGroups],
    ["dmas", KEYS.dmas],
    ["quintiles", KEYS.quintiles],
  ];
  for (const [field, key] of labelFields) {
    const values = filters[field] as string[];
    if (values.length > 0) params.set(key, values.join(","));
  }

  if (filters.compSalonOnly !== null) {
    params.set(KEYS.compSalonOnly, String(filters.compSalonOnly));
  }
  if (filters.salonNumbers.length > 0) {
    params.set(KEYS.salonNumbers, filters.salonNumbers.join(","));
  }
  if (filters.sort !== DEFAULT_FILTERS.sort) params.set(KEYS.sort, filters.sort);
  if (filters.direction !== DEFAULT_FILTERS.direction) {
    params.set(KEYS.direction, filters.direction);
  }

  return params;
}

/** True when something narrows the report beyond its own scope. */
export function hasActiveFilters(filters: ReportFilters): boolean {
  return (
    filters.districts.length > 0 ||
    filters.regions.length > 0 ||
    filters.companies.length > 0 ||
    filters.ownershipGroups.length > 0 ||
    filters.dmas.length > 0 ||
    filters.quintiles.length > 0 ||
    filters.salonNumbers.length > 0 ||
    filters.compSalonOnly !== null
  );
}

/** Builds a new filter set with one field changed, for building links. */
export function withFilter<K extends keyof ReportFilters>(
  filters: ReportFilters,
  field: K,
  value: ReportFilters[K],
): ReportFilters {
  return { ...filters, [field]: value };
}
