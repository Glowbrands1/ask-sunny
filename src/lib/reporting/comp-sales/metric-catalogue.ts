import type { ReportMetricUnit } from "../types";

/**
 * THE COMP SALES METRIC VOCABULARY, AS DATA.
 *
 * Split out of `metric-map.ts` so the vocabulary can be imported by code that
 * must never pull a spreadsheet library with it. `metric-map` holds the header
 * RESOLUTION logic, which needs the cell coercions, which need the workbook
 * adapter, which needs ExcelJS. The dashboard's URL parser only needs to know
 * which metric codes exist and which of them are base measures — importing the
 * resolver to answer that would have put ExcelJS in a browser bundle.
 *
 * Nothing here imports anything but a type, and that is the point.
 */

export interface MetricMapping {
  /** Canonical code. Must already exist in `public.report_metrics`. */
  code: string;
  /** Catalogue label, for diagnostics and drift reports. */
  label: string;
  family: string;
  unit: ReportMetricUnit;
  basisYearRequired: boolean;
  /** Null where "better" is genuinely undefined. Matches the catalogue. */
  higherIsBetter: boolean | null;
  /** `rolling` is vocabulary only: never header-resolved from this list. */
  kind: "base" | "pct_change" | "rolling";
  /** The base metric a `% change` is a change IN. */
  comparisonOf: string | null;
  /** Token sequence a header must reduce to, once years are stripped. */
  headerTokens: string[];
  /**
   * COLUMN POSITIONS CONFIRMED IN THE AUDITED WORKBOOK, keyed by basis year.
   *
   * This replaces the placeholder `fallbackColumns` field, and the rename is
   * the point: the real workbook argued against positional RESOLUTION.
   *
   * Header matching resolved 24 of 24 supported measure columns in the audited
   * file, so a positional path would never have been reached. Meanwhile the
   * only headerless-but-populated columns in that sheet (AU..BO) are abandoned
   * template debris — precisely what a positional read would have picked up
   * with full confidence. A fallback that fires exactly where the data is
   * untrustworthy is worse than no fallback.
   *
   * So these letters are used for ONE thing: a drift signal. When a metric
   * resolves at a different column than recorded here, header matching still
   * wins and an `unexpected_metric_column` warning says the template moved.
   * Nothing here ever resolves a column on its own.
   */
  observedColumns: Record<string, string>;
}

/**
 * Column letters confirmed in `Comp Report 2026 08 30`, sheet
 * `CompReport(MTD) vs 2024`, keyed by metric code then basis year.
 *
 * Recorded for drift detection only — see `MetricMapping.observedColumns`.
 */
const OBSERVED_COLUMNS: Record<string, Record<string, string>> = {
  otc_revenue: { "2026": "U", "2024": "V", "2019": "AV" },
  otc_revenue_pct_change: { "2024": "W", "2019": "AW" },
  eft_revenue: { "2026": "X", "2024": "Y", "2019": "AY" },
  eft_revenue_pct_change: { "2024": "Z", "2019": "AZ" },
  total_revenue: { "2026": "AA", "2024": "AB", "2019": "BB" },
  total_revenue_pct_change: { "2024": "AC", "2019": "BC" },
  uv_tans: { "2026": "AD", "2024": "AE", "2019": "BE" },
  uv_tans_pct_change: { "2024": "AF", "2019": "BF" },
  sunless_tans: { "2026": "AG", "2024": "AH", "2019": "BH" },
  sunless_tans_pct_change: { "2024": "AI", "2019": "BI" },
  // Spa Sessions has no 2019 block in the audited sheet.
  spa_sessions: { "2026": "AJ", "2024": "AK" },
  spa_sessions_pct_change: { "2024": "AL" },
  unique_tanners: { "2026": "AM", "2024": "AN", "2019": "BK" },
  unique_tanners_pct_change: { "2024": "AO", "2019": "BL" },
  total_tans: { "2026": "AP", "2024": "AQ", "2019": "BN" },
  total_tans_pct_change: { "2024": "AR", "2019": "BO" },
};

const BASE_METRICS: Omit<MetricMapping, "kind" | "comparisonOf">[] = [
  {
    code: "otc_revenue",
    label: "OTC Revenue",
    family: "revenue",
    unit: "currency",
    basisYearRequired: true,
    higherIsBetter: true,
    headerTokens: ["otc", "revenue"],
    observedColumns: {},
  },
  {
    code: "eft_revenue",
    label: "EFT Revenue",
    family: "revenue",
    unit: "currency",
    basisYearRequired: true,
    higherIsBetter: true,
    headerTokens: ["eft", "revenue"],
    observedColumns: {},
  },
  {
    code: "total_revenue",
    label: "Total Revenue",
    family: "revenue",
    unit: "currency",
    basisYearRequired: true,
    higherIsBetter: true,
    headerTokens: ["total", "revenue"],
    observedColumns: {},
  },
  {
    code: "uv_tans",
    label: "UV Tans",
    family: "volume",
    unit: "count",
    basisYearRequired: true,
    higherIsBetter: true,
    headerTokens: ["uv", "tans"],
    observedColumns: {},
  },
  {
    code: "sunless_tans",
    label: "Sunless Tans",
    family: "volume",
    unit: "count",
    basisYearRequired: true,
    higherIsBetter: true,
    headerTokens: ["sunless", "tans"],
    observedColumns: {},
  },
  {
    code: "spa_sessions",
    label: "Spa Sessions",
    family: "volume",
    unit: "count",
    basisYearRequired: true,
    higherIsBetter: true,
    headerTokens: ["spa", "sessions"],
    observedColumns: {},
  },
  {
    code: "unique_tanners",
    label: "Unique Tanners",
    family: "volume",
    unit: "count",
    basisYearRequired: true,
    higherIsBetter: true,
    headerTokens: ["unique", "tanners"],
    observedColumns: {},
  },
  {
    code: "total_tans",
    label: "Total Tans",
    family: "volume",
    unit: "count",
    basisYearRequired: true,
    higherIsBetter: true,
    headerTokens: ["total", "tans"],
    observedColumns: {},
  },
];

/**
 * The 16 supported mappings: each base measure, and its `% change` counterpart
 * derived from it exactly as the seed migration derives the catalogue row.
 */
export const COMP_SALES_METRICS: MetricMapping[] = [
  ...BASE_METRICS.map((metric) => ({
    ...metric,
    kind: "base" as const,
    comparisonOf: null,
    observedColumns: OBSERVED_COLUMNS[metric.code] ?? {},
  })),
  ...BASE_METRICS.map((metric) => ({
    ...metric,
    code: `${metric.code}_pct_change`,
    label: `${metric.label} % Change`,
    unit: "percent" as ReportMetricUnit,
    kind: "pct_change" as const,
    comparisonOf: metric.code,
    // A fully-qualified change header, e.g. "OTC Revenue % Change". The bare
    // "TY vs. 2024 % Change" form resolves by block association instead.
    headerTokens: [...metric.headerTokens, "%", "change"],
    observedColumns: OBSERVED_COLUMNS[`${metric.code}_pct_change`] ?? {},
  })),
];

export const METRICS_BY_CODE = new Map(COMP_SALES_METRICS.map((m) => [m.code, m]));

/**
 * Metrics whose absence means this is not the sheet we think it is.
 *
 * Kept to the three revenue measures rather than all eight: a recipient slice
 * may legitimately omit a volume measure, but a comp sales sheet without
 * revenue is not a comp sales sheet.
 */
export const REQUIRED_CORE_METRICS = ["otc_revenue", "eft_revenue", "total_revenue"] as const;

/* ------------------------------------------------- the rolling vocabulary */

/**
 * THE TRAILING-WINDOW CODES, AS VOCABULARY ONLY.
 *
 * Deliberately NOT added to `COMP_SALES_METRICS`. That list is what the vs-2024
 * header resolver iterates, and putting rolling entries in it would invite the
 * wrong sheet's resolver to match them.
 *
 * They exist here because the INGESTION GATE needs to know every metric code the
 * seeded catalogue holds, not just one parser's. That gap is what rejected a
 * correctly parsed rolling report: `validateParsedReport` looked codes up in
 * `METRICS_BY_CODE`, found none of the twenty-four, and refused all of them as
 * unknown — a hard stop before storage or any database write.
 *
 * Generated from the same convention the migration cross-joins, so the two
 * cannot drift into different sets. `report_metrics` remains the source of
 * truth, and the composite foreign key on `comp_sales_facts` still enforces the
 * basis-year rule regardless of what this file says.
 */
const ROLLING_MEASURE_STEMS = [
  { code: "total_revenue", label: "Total Revenue", family: "revenue", unit: "currency" as ReportMetricUnit },
  { code: "total_tans", label: "Total Tans", family: "volume", unit: "count" as ReportMetricUnit },
];

const ROLLING_MONTHS = [3, 6, 9, 12] as const;

export const ROLLING_VOCABULARY: MetricMapping[] = ROLLING_MEASURE_STEMS.flatMap((measure) =>
  ROLLING_MONTHS.flatMap((months) => [
    ...(["current", "prior"] as const).map((side) => ({
      code: `${measure.code}_last_${months}m_${side}`,
      label: `${measure.label}, ${side === "current" ? "current year" : "prior year"} last ${months} months`,
      family: measure.family,
      unit: measure.unit,
      // A trailing window carries NO basis year: the window IS the period.
      basisYearRequired: false,
      higherIsBetter: true,
      kind: "rolling" as const,
      comparisonOf: null,
      // Never header-resolved from this list; `rolling-map` owns that.
      headerTokens: [],
      observedColumns: {},
    })),
    {
      code: `${measure.code}_last_${months}m_pct_change`,
      label: `Last ${months} Months % Change, ${measure.label}`,
      family: measure.family,
      unit: "percent" as ReportMetricUnit,
      basisYearRequired: false,
      higherIsBetter: true,
      kind: "rolling" as const,
      comparisonOf: measure.code,
      headerTokens: [],
      observedColumns: {},
    },
  ]),
);

/**
 * Every metric code the seeded catalogue holds, across every parser.
 *
 * This is what the ingestion gate must consult. `METRICS_BY_CODE` is the
 * vs-2024 sheet's vocabulary and stays that way: the URL filter parser uses it
 * to decide which measures are SELECTABLE, and a rolling side is not one — a
 * manager picks Total Revenue and the window decides which of the twenty-four is
 * read.
 */
export const KNOWN_METRICS_BY_CODE = new Map<string, MetricMapping>([
  ...COMP_SALES_METRICS.map((metric) => [metric.code, metric] as const),
  ...ROLLING_VOCABULARY.map((metric) => [metric.code, metric] as const),
]);
