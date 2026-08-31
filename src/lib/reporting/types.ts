/**
 * The database-independent result of parsing one report.
 *
 * NOTHING HERE KNOWS ABOUT SUPABASE. A parser reads bytes and returns this
 * object; a later `ReportingRepository` is what turns it into rows. Keeping the
 * boundary here is what makes the parser testable without a database and makes
 * the same parser reusable if the store ever changes.
 *
 * Field names mirror the deployed schema's columns closely enough to make the
 * mapping obvious, but the types are the parser's own: strings for dates (ISO
 * `yyyy-mm-dd`, no time, no zone) so that no timezone can be inferred on the
 * way through, and `salonNumber` as the join key rather than a uuid the parser
 * cannot know.
 */

/** Mirrors `public.report_period_grain`. */
export type ReportPeriodGrain = "mtd" | "ytd";

/** Mirrors `public.report_metric_unit`. */
export type ReportMetricUnit =
  | "currency"
  | "count"
  | "hours"
  | "ratio"
  | "percent"
  | "rank"
  | "years";

export interface ParsedPeriod {
  grain: ReportPeriodGrain;
  /** ISO `yyyy-mm-dd`. The LAST DAY COVERED, not the last day of the month. */
  periodEnd: string;
  /** ISO `yyyy-mm-dd`. */
  periodStart: string;
  /** Must equal the calendar year of `periodEnd`; the schema checks it too. */
  fiscalYear: number;
  /** The period string exactly as it appeared in the workbook. */
  labelRaw: string;
}

export interface ParsedSalon {
  /** TEXT, zero-padding preserved. `0468` is never `468`. */
  salonNumber: string;
  storeName: string;
  /** 'Ref: Owner' — carried for reconciliation, never used for matching. */
  ownerRef: string | null;
  /** 'Ref: UID' — as above. */
  ownerUid: string | null;
  /** ISO `yyyy-mm-dd` when the workbook supplies an open/conversion date. */
  openedAt: string | null;
  /** 1-indexed worksheet row this salon was read from. Lineage. */
  sourceRow: number;
}

/**
 * Salon characteristics AS REPORTED FOR THIS PERIOD.
 *
 * `districtLabel` and `regionLabel` hold a manager's personal name in the
 * source. They are descriptive history for the period and are never promoted to
 * an identifier or a join key.
 */
export interface ParsedSalonPeriodAttributes {
  salonNumber: string;
  districtLabel: string | null;
  regionLabel: string | null;
  company: string | null;
  ownershipGroup: string | null;
  dma: string | null;
  pricingPlan: string | null;
  isCompSalon: boolean | null;
  spaPieces: number | null;
  spaInstallDate: string | null;
  quintileGroup: string | null;
  revenueRank: number | null;
  salonAgeYears: number | null;
  avgClientAge: number | null;
  marketConsolidation: string | null;
  nearestCompetitorDistance: number | null;
  sourceRow: number;
}

export interface ParsedFact {
  salonNumber: string;
  /** A code from the seeded catalogue. A parser never invents one. */
  metricCode: string;
  /** Copied from the catalogue so the repository can satisfy the composite FK. */
  metricBasisYearRequired: boolean;
  /**
   * The calendar year the figure describes. For a `% change` metric this is the
   * year being compared AGAINST.
   */
  basisYear: number | null;
  /** Percentages are FRACTIONS: -0.0299 means -2.99%. */
  value: number;
  sourceSheet: string;
  /** Excel column letters, e.g. `AF`. Matches the schema's `^[A-Z]{1,3}$`. */
  sourceColumn: string;
  sourceRow: number;
}

export type ParserWarningCode =
  /** A column's header did not resolve to any known metric or dimension. */
  | "unresolved_column"
  /** A supported metric's header was absent from the sheet. */
  | "missing_metric_header"
  /** A required dimension header was absent. */
  | "missing_dimension_header"
  /** A `% change` column could not be associated with a base metric. */
  | "unassociated_percent_change"
  /** Two columns resolved to the same metric and basis year. */
  | "duplicate_metric_column"
  /** A metric cell held something that is not a number. */
  | "malformed_metric_value"
  /**
   * A descriptor cell held a value the deployed schema would reject (a
   * negative age, a rank below 1, a non-integer piece count). Stored as null
   * rather than passed on to be refused at insert time.
   */
  | "malformed_dimension_value"
  /** A salon number failed the schema's text-key format. */
  | "malformed_salon_number"
  /** The same salon appeared on more than one row. */
  | "duplicate_salon_row"
  /** A column was resolved by position because its header was unrecognisable. */
  | "resolved_by_position"
  /**
   * A column resolved to a supported metric but sits OUTSIDE the contiguous
   * live measure band — separated from it by a wide run of headerless columns.
   * That is the signature of a prior-year template remnant, so it is excluded
   * from the facts and reported loudly for review.
   */
  | "out_of_band_column"
  /**
   * A metric resolved at a different column than the one previously observed in
   * this template. Header matching still won; this is a drift signal only.
   */
  | "unexpected_metric_column"
  /**
   * A column's HEADER CONTRADICTS ITS DATA: it claims one basis year while its
   * values are identical to a column claiming a different one. Proof of a
   * stale header left behind by a template roll-forward. Excluded.
   */
  | "stale_header_suspected"
  /**
   * Two columns claim the same metric and basis year but hold DIFFERENT values,
   * and nothing in the sheet says which is authoritative. Blocking: the parser
   * refuses to decide.
   */
  | "conflicting_metric_column";

export interface ParserWarning {
  code: ParserWarningCode;
  /** User-safe: describes structure, never a figure from the data band. */
  message: string;
  column?: string;
  row?: number;
}

export type SkippedRowReason =
  | "blank_row"
  | "trailing_padding"
  /**
   * A pre-numbered template slot: reference columns populated but no salon
   * number, no store name and no measures. The source template carries a fixed
   * number of rows and a recipient's copy fills only some of them, so these are
   * unused capacity rather than missing data.
   */
  | "template_placeholder"
  | "totals_row"
  | "missing_salon_number"
  | "malformed_salon_number"
  | "duplicate_salon"
  | "missing_store_name";

export interface SkippedRow {
  row: number;
  reason: SkippedRowReason;
}

/** What the parser saw, for the admin screen and for template-drift review. */
export interface ParserDiagnostics {
  sheetSelected: string;
  /** Row carrying the descriptor (A-T) headers. The data band starts below it. */
  headerRow: number;
  /**
   * Row carrying the measure headers. Often ABOVE the descriptor header row:
   * the audited template puts measures on row 1 and descriptors on row 34,
   * with a summary block in between.
   */
  metricHeaderRow: number;
  firstDataRow: number;
  lastDataRow: number;
  columnsScanned: number;
  /** Columns that became facts. */
  resolvedMetricColumns: {
    column: string;
    header: string;
    metricCode: string;
    basisYear: number | null;
    resolvedBy: "header" | "position";
  }[];
  /** Dimension columns that were located. */
  resolvedDimensionColumns: { column: string; header: string; field: string }[];
  /** Headers present but not understood. Ignored, never guessed at. */
  unresolvedColumns: { column: string; header: string }[];
  /** Blank-header separator columns. Expected, not a problem. */
  separatorColumns: string[];
  salonRowsParsed: number;
  factsProduced: number;
  /**
   * True when a finding needs human review before these facts are trusted —
   * currently any unexplained duplicate-column conflict. An ingest route should
   * refuse rather than guess.
   */
  requiresReview: boolean;
}

export interface ParsedReport {
  parserKey: string;
  parserVersion: number;
  reportFamily: string;
  /** Which sheets were actually read. */
  sourceSheetNames: string[];
  period: ParsedPeriod;
  salons: ParsedSalon[];
  salonPeriodAttributes: ParsedSalonPeriodAttributes[];
  facts: ParsedFact[];
  warnings: ParserWarning[];
  skippedRows: SkippedRow[];
  diagnostics: ParserDiagnostics;
}
