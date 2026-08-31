import { normalizeHeader, stripYearTokens, yearTokens } from "../cells";
import type { ParserWarning, ReportMetricUnit } from "../types";

/**
 * THE COMP SALES METRIC MAP.
 *
 * Scope is exactly the 16 codes seeded by `20260831001600_reporting_seed_comp_sales`
 * — 8 base measures and their 8 `% change` counterparts. The workbook carries
 * roughly 150 further measures; they are deliberately out of scope until the
 * business confirms what each one means. A parser that ingested them would be
 * inventing metadata, and `report_metrics` is a REVIEWED vocabulary: a column
 * that does not resolve becomes a warning, never a new metric.
 *
 * HEADER TEXT IS THE PRIMARY RESOLVER, position is fallback only. This is not
 * defensiveness for its own sake — the source's column headers roll forward
 * every January ("2026 / 2025" becomes "2027 / 2026"), and measures come and go
 * between template revisions. A positional parser would need editing every year
 * and would silently read a neighbouring column the first time one was
 * inserted.
 *
 * THE YEAR IS NOT PART OF THE CODE. "2026 OTC Revenue" and "2024 OTC Revenue"
 * are the same metric with different `basis_year` values, which is why one
 * metric code covers every baseline the report offers.
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
  kind: "base" | "pct_change";
  /** The base metric a `% change` is a change IN. */
  comparisonOf: string | null;
  /** Token sequence a header must reduce to, once years are stripped. */
  headerTokens: string[];
  /**
   * SOURCE COLUMN FALLBACK POSITIONS.
   *
   * Deliberately EMPTY. Positional fallback is implemented (see
   * `resolveMetricColumns`), but populating it requires the column letters from
   * the real workbook, and the checkpoint-4 dry-run against that file has not
   * been possible — the workbook was not supplied to the build environment.
   * Filling these in from a guess would defeat the purpose of a fallback: a
   * wrong letter reads the wrong column with full confidence. They are
   * populated in a follow-up once the letters are confirmed.
   */
  fallbackColumns: string[];
}

/** Tokens that carry no metric identity and are dropped before matching. */
const NOISE_TOKENS = new Set(["ty", "ly", "cy", "py", "vs", "v", "actual", "and", "the", "of"]);

/** Template revisions abbreviate inconsistently; these are the same word. */
const SYNONYMS: Record<string, string> = {
  rev: "revenue",
  revs: "revenue",
  ttl: "total",
  tot: "total",
  sess: "sessions",
  session: "sessions",
  tan: "tans",
  tanner: "tanners",
  chg: "change",
  chng: "change",
  changes: "change",
  pct: "%",
  percent: "%",
  percentage: "%",
};

/**
 * Reduces a header to the tokens that identify a metric: years removed,
 * abbreviations expanded, noise dropped.
 */
export function metricTokens(header: string): string[] {
  return stripYearTokens(header)
    .split(/[\s/]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0)
    .map((token) => SYNONYMS[token] ?? token)
    .filter((token) => !NOISE_TOKENS.has(token));
}

function sameTokens(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((token, index) => token === b[index]);
}

/** True when a header announces itself as a percentage change. */
export function isPercentChangeHeader(header: string): boolean {
  const tokens = metricTokens(header);
  return tokens.includes("%") && tokens.includes("change");
}

const BASE_METRICS: Omit<MetricMapping, "kind" | "comparisonOf">[] = [
  {
    code: "otc_revenue",
    label: "OTC Revenue",
    family: "revenue",
    unit: "currency",
    basisYearRequired: true,
    higherIsBetter: true,
    headerTokens: ["otc", "revenue"],
    fallbackColumns: [],
  },
  {
    code: "eft_revenue",
    label: "EFT Revenue",
    family: "revenue",
    unit: "currency",
    basisYearRequired: true,
    higherIsBetter: true,
    headerTokens: ["eft", "revenue"],
    fallbackColumns: [],
  },
  {
    code: "total_revenue",
    label: "Total Revenue",
    family: "revenue",
    unit: "currency",
    basisYearRequired: true,
    higherIsBetter: true,
    headerTokens: ["total", "revenue"],
    fallbackColumns: [],
  },
  {
    code: "uv_tans",
    label: "UV Tans",
    family: "volume",
    unit: "count",
    basisYearRequired: true,
    higherIsBetter: true,
    headerTokens: ["uv", "tans"],
    fallbackColumns: [],
  },
  {
    code: "sunless_tans",
    label: "Sunless Tans",
    family: "volume",
    unit: "count",
    basisYearRequired: true,
    higherIsBetter: true,
    headerTokens: ["sunless", "tans"],
    fallbackColumns: [],
  },
  {
    code: "spa_sessions",
    label: "Spa Sessions",
    family: "volume",
    unit: "count",
    basisYearRequired: true,
    higherIsBetter: true,
    headerTokens: ["spa", "sessions"],
    fallbackColumns: [],
  },
  {
    code: "unique_tanners",
    label: "Unique Tanners",
    family: "volume",
    unit: "count",
    basisYearRequired: true,
    higherIsBetter: true,
    headerTokens: ["unique", "tanners"],
    fallbackColumns: [],
  },
  {
    code: "total_tans",
    label: "Total Tans",
    family: "volume",
    unit: "count",
    basisYearRequired: true,
    higherIsBetter: true,
    headerTokens: ["total", "tans"],
    fallbackColumns: [],
  },
];

/**
 * The 16 supported mappings: each base measure, and its `% change` counterpart
 * derived from it exactly as the seed migration derives the catalogue row.
 */
export const COMP_SALES_METRICS: MetricMapping[] = [
  ...BASE_METRICS.map((metric) => ({ ...metric, kind: "base" as const, comparisonOf: null })),
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
    fallbackColumns: [],
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

export interface HeaderCell {
  column: number;
  letter: string;
  header: string;
}

export interface ResolvedMetricColumn {
  column: number;
  letter: string;
  header: string;
  mapping: MetricMapping;
  basisYear: number | null;
  resolvedBy: "header" | "position";
}

export interface MetricResolution {
  resolved: ResolvedMetricColumn[];
  /** Headers present but not understood. Ignored, never guessed at. */
  unresolved: HeaderCell[];
  /** Blank headers: separator columns. Expected. */
  separators: string[];
  warnings: ParserWarning[];
}

/**
 * The baseline year a `% change` header compares AGAINST.
 *
 * "TY vs. 2024 % Change" -> 2024. With two years present ("2026 vs 2024 %
 * Change") the year AFTER `vs` is the baseline; without a `vs` the last year
 * token is taken. Zero years is unresolvable, and is reported rather than
 * defaulted.
 */
export function percentChangeBasisYear(header: string): number | null {
  const years = yearTokens(header);
  if (years.length === 0) return null;
  if (years.length === 1) return years[0];

  const normalized = normalizeHeader(header);
  const afterVs = /\bvs\s+((?:19|20)\d{2})\b/.exec(normalized);
  if (afterVs) return Number(afterVs[1]);
  return years[years.length - 1];
}

/**
 * Resolves every column header to a supported metric.
 *
 * BLOCK ASSOCIATION, stated explicitly because it is the one inference here.
 *
 * The sheet groups each measure as a block of adjacent columns — the current
 * year, the baseline year, then the change between them — and the change
 * column's header names only the comparison ("TY vs. 2024 % Change"), not the
 * measure. Such a column is therefore attributed to the NEAREST PRECEDING base
 * metric resolved by header text.
 *
 * The important half is the failure mode: when no base metric precedes it, the
 * column is left UNRESOLVED with an `unassociated_percent_change` warning. It is
 * never attributed to a guess, so a template that reorders the blocks produces
 * a visible warning rather than a percentage filed against the wrong measure.
 */
export function resolveMetricColumns(headers: HeaderCell[]): MetricResolution {
  const resolved: ResolvedMetricColumn[] = [];
  const unresolved: HeaderCell[] = [];
  const separators: string[] = [];
  const warnings: ParserWarning[] = [];

  /** Most recent base metric resolved by header, for block association. */
  let currentBlock: MetricMapping | null = null;

  for (const cell of headers) {
    const header = cell.header.trim();
    if (header.length === 0) {
      separators.push(cell.letter);
      continue;
    }

    const tokens = metricTokens(header);
    const years = yearTokens(header);

    if (isPercentChangeHeader(header)) {
      // A fully-qualified change header resolves on its own.
      const direct = COMP_SALES_METRICS.find(
        (metric) => metric.kind === "pct_change" && sameTokens(metric.headerTokens, tokens),
      );
      const basisYear = percentChangeBasisYear(header);
      const mapping =
        direct ??
        (currentBlock ? METRICS_BY_CODE.get(`${currentBlock.code}_pct_change`) ?? null : null);

      if (!mapping) {
        unresolved.push(cell);
        warnings.push({
          code: "unassociated_percent_change",
          message:
            `Column ${cell.letter} is a "% change" column but no supported base metric ` +
            `precedes it, so the measure it changes is unknown. The column was ignored.`,
          column: cell.letter,
        });
        continue;
      }
      if (basisYear === null) {
        unresolved.push(cell);
        warnings.push({
          code: "unresolved_column",
          message:
            `Column ${cell.letter} is a "% change" column with no baseline year in its ` +
            `header, so the year it compares against is unknown. The column was ignored.`,
          column: cell.letter,
        });
        continue;
      }
      resolved.push({ ...cell, mapping, basisYear, resolvedBy: "header" });
      continue;
    }

    const base = COMP_SALES_METRICS.find(
      (metric) => metric.kind === "base" && sameTokens(metric.headerTokens, tokens),
    );
    if (!base) {
      unresolved.push(cell);
      continue;
    }

    // A base measure that needs a year must carry exactly one.
    if (base.basisYearRequired) {
      if (years.length === 0) {
        unresolved.push(cell);
        warnings.push({
          code: "unresolved_column",
          message:
            `Column ${cell.letter} matches "${base.label}", which is reported per year, ` +
            `but its header names no year. The column was ignored rather than filed ` +
            `against a guessed year.`,
          column: cell.letter,
        });
        continue;
      }
      if (years.length > 1) {
        unresolved.push(cell);
        warnings.push({
          code: "unresolved_column",
          message:
            `Column ${cell.letter} matches "${base.label}" but names ${years.length} years, ` +
            `so which one the figure describes is ambiguous. The column was ignored.`,
          column: cell.letter,
        });
        continue;
      }
    }

    currentBlock = base;
    resolved.push({
      ...cell,
      mapping: base,
      basisYear: base.basisYearRequired ? years[0] : null,
      resolvedBy: "header",
    });
  }

  // Two columns claiming the same metric AND year would violate the fact
  // table's live business key. Keep the first, report the rest.
  const seen = new Map<string, ResolvedMetricColumn>();
  const deduped: ResolvedMetricColumn[] = [];
  for (const entry of resolved) {
    const key = `${entry.mapping.code}|${entry.basisYear ?? "none"}`;
    const existing = seen.get(key);
    if (existing) {
      warnings.push({
        code: "duplicate_metric_column",
        message:
          `Columns ${existing.letter} and ${entry.letter} both resolve to ` +
          `"${entry.mapping.label}" for ${entry.basisYear ?? "no"} basis year. ` +
          `Column ${entry.letter} was ignored to protect the one-fact-per-key rule.`,
        column: entry.letter,
      });
      unresolved.push({ column: entry.column, letter: entry.letter, header: entry.header });
      continue;
    }
    seen.set(key, entry);
    deduped.push(entry);
  }

  // A supported metric absent from the sheet is worth saying out loud: it is
  // how template drift becomes visible before it becomes missing data.
  const presentCodes = new Set(deduped.map((entry) => entry.mapping.code));
  for (const code of REQUIRED_CORE_METRICS) {
    if (!presentCodes.has(code)) {
      warnings.push({
        code: "missing_metric_header",
        message: `No column resolved to the core metric "${METRICS_BY_CODE.get(code)?.label ?? code}".`,
      });
    }
  }

  return { resolved: deduped, unresolved, separators, warnings };
}
