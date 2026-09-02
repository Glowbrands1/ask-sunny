import type { ReportMetricUnit, ReportPeriodGrain } from "../types";

/**
 * DATA CONTRACTS FOR THE SALON PERFORMANCE DASHBOARD.
 *
 * Every chart in 6B consumes one of these shapes. They are defined before any
 * chart exists so the questions that matter — what may be summed, how many
 * salons are behind a number, whether a direction is even defined — are settled
 * in types rather than negotiated per component.
 *
 * Two rules are encoded structurally rather than documented:
 *
 *   `companyWide: false` is a LITERAL type on every aggregate. This source is a
 *   recipient slice, so no aggregate computed from it is company-wide, and
 *   nothing can set the flag true without a compile error.
 *
 *   `salonCount` is REQUIRED on every aggregate. A number without its
 *   denominator is the thing that turns a 15-salon figure into an apparent
 *   chain total, so the type refuses to carry one without the other.
 */

/** One ingested report: what it covers, when it arrived, where it came from. */
export interface ReportScope {
  ingestionId: string;
  periodId: string;
  grain: ReportPeriodGrain;
  periodStart: string;
  periodEnd: string;
  /** The period string exactly as the workbook stated it. */
  periodLabel: string;
  fiscalYear: number;
  /** Counted from the live facts, never read from a summary column. */
  salonCount: number;
  factCount: number;
  metricCount: number;
  ingestedAt: string | null;
  parserKey: string;
  parserVersion: number;
  /** Always false. This workbook is one recipient's filtered copy. */
  companyWide: false;
}

/** Provenance for the "Data source & quality" drawer. Never on the main view. */
export interface ReportSourceQuality {
  ingestionId: string;
  sourceCode: string;
  sourceName: string;
  sourceKind: string;
  reportFamily: string;
  originalFilename: string;
  /** Lowercase hex SHA-256 of the artifact as received. */
  fileSha256: string;
  storageBucket: string;
  /** Object key only. A signed URL is minted server-side, on demand, elsewhere. */
  storagePath: string;
  sizeBytes: number;
  receivedAt: string | null;
  ingestedAt: string | null;
  sourceSheetNames: string[];
  /**
   * Which reviewed mapping read THIS ingestion.
   *
   * On the contract rather than taken from the report scope, because a period
   * holds several ingestions — the two month-to-date sheets are separate parser
   * runs against the same workbook — and the scope names the period's most
   * recent one. A provenance panel sitting under figures from the other sheet
   * would then name the wrong parser, which is the one field in it nobody would
   * think to doubt.
   */
  parserKey: string;
  parserVersion: number;
  warningCount: number;
  /** Grouped by code, so 17 warnings read as "7 stale headers, 10 duplicates". */
  warningsByCode: { code: string; count: number; messages: string[] }[];
  /**
   * Skipped-row counts are NOT persisted by the current schema — the parser
   * reports them, the ingestion row does not store them. Null until a parser
   * version bump adds the column; the drawer says so rather than showing 0,
   * because 0 and "not recorded" are different facts.
   */
  skippedRowsByReason: { reason: string; count: number }[] | null;
}

/** A period a user may select. */
export interface PeriodOption {
  periodId: string;
  grain: ReportPeriodGrain;
  periodEnd: string;
  periodLabel: string;
  salonCount: number;
}

/** One selectable value within a filter facet. */
export interface FacetOption {
  value: string;
  /** How many salons in the period carry it. */
  salonCount: number;
}

export type FacetName =
  | "district"
  | "region"
  | "company"
  | "ownership_group"
  | "dma"
  | "quintile_group"
  | "pricing_plan"
  | "market_consolidation"
  | "comp_salon";

/**
 * Facets present in a period, with their values.
 *
 * A facet with no values in the data is ABSENT rather than empty — the UI must
 * not render a filter that can only return nothing.
 */
export type FilterOptions = Partial<Record<FacetName, FacetOption[]>>;

/** A supported metric, joined to what the selected period actually holds. */
export interface MetricDescriptor {
  code: string;
  label: string;
  family: string;
  unit: ReportMetricUnit;
  /** Null where "better" is genuinely undefined. Never rendered as a colour. */
  higherIsBetter: boolean | null;
  basisYearRequired: boolean;
  /** For a `% change` metric, the code it is a change in. */
  comparisonOfCode: string | null;
  description: string;
  /** Ascending. `spa_sessions` simply has no 2019 entry. */
  availableBasisYears: number[];
  factCount: number;
  salonCount: number;
  /**
   * The workbook sheet these facts came from.
   *
   * Lineage the ingestion wrote, carried up to the read layer because it is
   * what decides which comparisons a measure can offer. Both month-to-date
   * sheets describe the same period, so without it a `Last 3 Months` window
   * and a `vs 2024` window look equally available on either one. Empty string
   * for a definition read from the vocabulary rather than from facts.
   */
  sourceSheet: string;
}

export type AggregationKind = "sum" | "mean" | "median" | "min" | "max" | "count";

/**
 * An aggregate over a metric for one basis year.
 *
 * `value` is null when the unit forbids the requested aggregation; the reason
 * is carried alongside so the tile can explain itself rather than show a blank.
 */
export interface MetricAggregate {
  metricCode: string;
  basisYear: number | null;
  kind: AggregationKind;
  value: number | null;
  /** Required: a figure without its denominator invites a company-wide reading. */
  salonCount: number;
  companyWide: false;
  /** Set when `value` is null. User-facing. */
  unavailableReason?: string;
}

/** One salon's value for a metric — the row behind ranking and drill-down. */
export interface SalonMetricValue {
  salonNumber: string;
  storeName: string;
  basisYear: number | null;
  value: number;
  sourceSheet: string;
  sourceColumn: string;
}

/** A salon's descriptors for the selected period, as reported. */
export interface SalonPeriodDescriptors {
  salonNumber: string;
  storeName: string;
  /** A MANAGER'S NAME in this source. Descriptive history, never an identity. */
  districtLabel: string | null;
  regionLabel: string | null;
  company: string | null;
  ownershipGroup: string | null;
  dma: string | null;
  pricingPlan: string | null;
  isCompSalon: boolean | null;
  quintileGroup: string | null;
  /** Reported by the source against the whole chain. Never recomputed here. */
  revenueRank: number | null;
  salonAgeYears: number | null;
  avgClientAge: number | null;
  spaPieces: number | null;
}
