import { normalizeHeader, stripYearTokens, yearTokens } from "../cells";
import type { ParserWarning } from "../types";
import {
  COMP_SALES_METRICS,
  METRICS_BY_CODE,
  REQUIRED_CORE_METRICS,
  type MetricMapping,
} from "./metric-catalogue";

// Re-exported so every existing import of the vocabulary keeps working.
export * from "./metric-catalogue";

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

/**
 * How many unresolved columns may sit INSIDE the live measure band.
 *
 * The audited sheet separates its live band (U..AR) from a prior-year remnant
 * (BR..BT) with 21 headerless columns carrying abandoned data. A gap that wide
 * is not a separator, it is a boundary — so resolved columns are clustered and
 * only the largest cluster is treated as live. Normal one- and two-column
 * spacers stay comfortably inside the threshold.
 */
const MAX_INTRA_BAND_GAP = 6;

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
export function metricTokens(header: string, extraNoise?: ReadonlySet<string>): string[] {
  return stripYearTokens(header)
    .split(/[\s/]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0)
    .map((token) => SYNONYMS[token] ?? token)
    .filter((token) => !NOISE_TOKENS.has(token) && !(extraNoise?.has(token) ?? false));
}

function sameTokens(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((token, index) => token === b[index]);
}

/** True when a header's tokens match a metric's primary or alternate spelling. */
function matchesMetric(metric: MetricMapping, tokens: string[]): boolean {
  if (sameTokens(metric.headerTokens, tokens)) return true;
  return (metric.altHeaderTokens ?? []).some((alt) => sameTokens(alt, tokens));
}

/** True when a header announces itself as a percentage change. */
export function isPercentChangeHeader(header: string, extraNoise?: ReadonlySet<string>): boolean {
  const tokens = metricTokens(header, extraNoise);
  return tokens.includes("%") && tokens.includes("change");
}

/**
 * SHEET-SPECIFIC RESOLUTION RULES.
 *
 * Every one of these defaults to OFF, and that is deliberate rather than
 * cautious. The `CompReport(MTD) vs 2024` sheet has already been ingested; its
 * 562 facts are live. A change to the shared resolver that altered how that
 * sheet reads would mean the stored figures no longer match what the parser
 * would produce today — a silent divergence between the database and the code
 * that explains it. Opting in per sheet keeps that impossible, and a test
 * asserts the vs-2024 resolution is byte-identical with the options absent.
 */
export interface ResolveMetricOptions {
  /**
   * Tokens dropped before matching, on top of the shared noise list.
   *
   * The year-to-date sheet writes `YTD 2026 Total Revenue`, so `ytd` sits in
   * the middle of a header that is otherwise exactly "Total Revenue". It
   * carries no measure identity — the SHEET says which accumulation window
   * applies, and the parser already refuses a marker whose grain disagrees.
   */
  noiseTokens?: readonly string[];
  /**
   * Take a change column's baseline year from the block it belongs to, when its
   * own header names none.
   *
   * The year-comparison sheet writes `TY vs. 2024 % Change` — self-describing.
   * The year-to-date sheet writes `UV Tans % Change` after `2026 UV Tans` and
   * `2025 UV Tans`, so the comparison is unambiguous from the two columns
   * immediately before it, and refusing it would discard eight real measures
   * over a header style. Applied ONLY when the block carries exactly two years:
   * one year gives nothing to compare, three or more is a genuine ambiguity.
   */
  inferChangeBasisYearFromBlock?: boolean;
  /**
   * Drop a change column whose baseline year has no base figure on this sheet.
   *
   * The rule that resolves the year-to-date sheet's contradictory `AJ`/`AK`
   * pair. `AK` is headed "TY vs. 2024 % Change" while the column it is computed
   * from is headed "2025 Total Revenue", and the sheet holds no 2024 figure for
   * any measure. Kept, it would publish a 2024 comparison this report cannot
   * support; dropped, the sheet simply offers the 2025 comparison it does.
   */
  dropChangeWithoutBaseline?: boolean;
  /**
   * Columns known not to be measures, which must not break the live band.
   *
   * The band is found by clustering resolved columns on adjacency, and a gap
   * wider than a few columns is treated as a boundary — that is what excludes a
   * stale template remnant sitting far to the right. But the year-to-date sheet
   * puts a twenty-four-column trailing-window block INSIDE its live band, and
   * this parser deliberately reads none of it. Removed from the header list, it
   * leaves a twenty-four-column hole that the clustering rule reads as a
   * boundary — splitting Total Revenue away from the rest and excluding it as a
   * remnant, which is exactly backwards.
   *
   * So these columns are DISCOUNTED when measuring a gap, rather than the
   * threshold being raised. Raising it would also merge the genuine remnant
   * back in, which is the protection the rule exists for.
   */
  bridgeColumns?: ReadonlySet<number>;
  /**
   * Whether to compare resolved positions against the shared observed layout.
   *
   * `MetricMapping.observedColumns` records where each measure sits on the
   * YEAR-COMPARISON sheet. Every other sheet lays the same measures out
   * differently, so the check reports drift for eight measures that are exactly
   * where they belong — noise that would train a reader to skim the warnings,
   * which is the one thing warnings cannot survive. A sheet with its own
   * observed layout runs its own check instead and turns this one off.
   */
  observedColumnDrift?: boolean;
}

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

/** A column dropped because another already claimed its metric and basis year. */
export interface DuplicateColumnPair {
  kept: ResolvedMetricColumn;
  dropped: ResolvedMetricColumn;
}

export interface MetricResolution {
  resolved: ResolvedMetricColumn[];
  /**
   * Duplicate pairs, surfaced so the PARSER can compare their values. Header
   * text alone cannot tell a harmless redundant copy from a stale mis-headed
   * column, and the audited workbook contains both.
   */
  duplicates: DuplicateColumnPair[];
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
export function resolveMetricColumns(
  headers: HeaderCell[],
  options: ResolveMetricOptions = {},
): MetricResolution {
  const resolved: ResolvedMetricColumn[] = [];
  const unresolved: HeaderCell[] = [];
  const separators: string[] = [];
  const warnings: ParserWarning[] = [];
  const extraNoise = options.noiseTokens ? new Set(options.noiseTokens) : undefined;

  /** Most recent base metric resolved by header, for block association. */
  let currentBlock: MetricMapping | null = null;
  /** The years that block has been seen at, so a bare change can find its baseline. */
  let currentBlockYears: number[] = [];

  for (const cell of headers) {
    const header = cell.header.trim();
    if (header.length === 0) {
      separators.push(cell.letter);
      continue;
    }

    const tokens = metricTokens(header, extraNoise);
    const years = yearTokens(header);

    if (isPercentChangeHeader(header, extraNoise)) {
      // A fully-qualified change header resolves on its own.
      const direct = COMP_SALES_METRICS.find(
        (metric) => metric.kind === "pct_change" && matchesMetric(metric, tokens),
      );
      /**
       * The baseline, from the header where it says so and otherwise from the
       * block.
       *
       * ONLY A HEADER THAT NAMES ITS OWN MEASURE MAY BORROW A YEAR, and that
       * restriction is the whole safety of the rule. `UV Tans % Change` says
       * which measure it changes and simply omits the year, so the block two
       * columns to its left settles it. `EFT Tans % Change` also omits the year
       * — but EFT Tans is not a supported measure, so its own value columns
       * never resolved and the block still holds whatever measure came before
       * it. Letting that borrow a year attaches an unsupported measure's change
       * to a supported one: on the real sheet it silently made `EFT Tans
       * % Change` into the Spa Sessions change, and eleven more like it into
       * the Total Tans change.
       *
       * A bare change header for an unsupported measure therefore stays
       * unresolved, exactly as it was before this option existed.
       *
       * The block must also be the one this change belongs to, and must have
       * been seen at exactly two years: one current side and one baseline, the
       * OLDER being what a change compares against.
       */
      const borrowable =
        options.inferChangeBasisYearFromBlock === true &&
        direct !== undefined &&
        currentBlock !== null &&
        direct.comparisonOf === currentBlock.code &&
        currentBlockYears.length === 2;
      const basisYear = percentChangeBasisYear(header) ?? (borrowable ? Math.min(...currentBlockYears) : null);
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
      (metric) => metric.kind === "base" && matchesMetric(metric, tokens),
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

    // A new measure starts a new block; the same measure again extends it, so
    // its years accumulate and a bare change column after them can find its
    // baseline.
    if (currentBlock?.code !== base.code) currentBlockYears = [];
    currentBlock = base;
    if (base.basisYearRequired) currentBlockYears.push(years[0]);
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
  const duplicates: DuplicateColumnPair[] = [];
  for (const entry of resolved) {
    const key = `${entry.mapping.code}|${entry.basisYear ?? "none"}`;
    const existing = seen.get(key);
    if (existing) {
      duplicates.push({ kept: existing, dropped: entry });
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

  // THE LIVE BAND.
  //
  // Resolved columns are clustered on adjacency, and only the largest cluster
  // counts. The audited workbook is why: its live measures sit in U..AR, then
  // 21 headerless columns of abandoned data, then a prior-year remnant in
  // BR..BT headed "2025 Spa Sessions" / "2023 Spa Sessions" /
  // "TY vs 2023 % Change".
  //
  // That remnant is the dangerous case, and neither earlier guard catches it:
  // the headers resolve cleanly, and because its basis years (2025, 2023)
  // differ from the live block's (2026, 2024) the duplicate-column check sees
  // no collision. Without this clustering it would be ingested silently as
  // real spa-session history.
  //
  // Ties keep the LEFTMOST cluster, because template debris accumulates to the
  // right of the live band, never to the left of it.
  const inBand: ResolvedMetricColumn[] = [];
  if (deduped.length > 0) {
    const sorted = [...deduped].sort((a, b) => a.column - b.column);
    const bridge = options.bridgeColumns;
    const clusters: ResolvedMetricColumn[][] = [[sorted[0]]];
    for (let index = 1; index < sorted.length; index += 1) {
      // Columns the caller has already accounted for do not widen the gap.
      let gap = 0;
      for (let column = sorted[index - 1].column + 1; column < sorted[index].column; column += 1) {
        if (!bridge?.has(column)) gap += 1;
      }
      if (gap > MAX_INTRA_BAND_GAP) clusters.push([sorted[index]]);
      else clusters[clusters.length - 1].push(sorted[index]);
    }
    const largest = clusters.reduce((best, cluster) =>
      cluster.length > best.length ? cluster : best,
    );
    for (const cluster of clusters) {
      if (cluster === largest) {
        inBand.push(...cluster);
        continue;
      }
      for (const entry of cluster) {
        warnings.push({
          code: "out_of_band_column",
          message:
            `Column ${entry.letter} ("${entry.header}") resolves to ` +
            `"${entry.mapping.label}" but sits outside the contiguous measure ` +
            `band, separated from it by a wide run of unheaded columns. It was ` +
            `EXCLUDED as a probable prior-year template remnant. If it is in ` +
            `fact live, the mapping must be reviewed before ingestion.`,
          column: entry.letter,
        });
        unresolved.push({ column: entry.column, letter: entry.letter, header: entry.header });
      }
    }
  }

  /**
   * A CHANGE WITH NO BASELINE ON THIS SHEET.
   *
   * Applied after the band is settled, because "does this sheet hold that
   * figure" can only be answered once the live band is known.
   *
   * This is what resolves the year-to-date sheet's contradictory pair. Column
   * AK is headed "TY vs. 2024 % Change"; the column it is arithmetically
   * computed from is headed "2025 Total Revenue"; and AG, two columns earlier,
   * is headed "YTD 2025 Total Revenue" and holds a DIFFERENT figure. Two labels
   * contradict each other and no reading of the header text settles which is
   * stale. What is certain is that the sheet carries no 2024 figure for any
   * measure — so a 2024 comparison cannot be checked, cannot be charted beside
   * its baseline, and would be published on the strength of a header that its
   * own neighbour contradicts. It is dropped and reported.
   */
  const survivors = new Set(inBand);
  if (options.dropChangeWithoutBaseline) {
    const baseYears = new Set<string>();
    for (const entry of inBand) {
      if (entry.mapping.kind === "base" && entry.basisYear !== null) {
        baseYears.add(`${entry.mapping.code}|${entry.basisYear}`);
      }
    }
    for (const entry of inBand) {
      if (entry.mapping.kind !== "pct_change" || entry.basisYear === null) continue;
      const measure = entry.mapping.comparisonOf ?? entry.mapping.code.replace(/_pct_change$/, "");
      if (baseYears.has(`${measure}|${entry.basisYear}`)) continue;
      survivors.delete(entry);
      warnings.push({
        code: "unresolved_column",
        message:
          `Column ${entry.letter} ("${entry.header}") is a change against ` +
          `${entry.basisYear}, but this sheet reports no ${entry.basisYear} figure for ` +
          `"${entry.mapping.label}". The comparison cannot be verified against its own ` +
          `baseline, so the column was EXCLUDED rather than published on its header alone.`,
        column: entry.letter,
      });
      unresolved.push({ column: entry.column, letter: entry.letter, header: entry.header });
    }
  }
  const finalBand = inBand.filter((entry) => survivors.has(entry));

  // Drift signal. Header matching has already decided; this only says the
  // template moved, so a reviewer can confirm the move was intended.
  for (const entry of options.observedColumnDrift === false ? [] : finalBand) {
    const expected = entry.mapping.observedColumns[String(entry.basisYear ?? "")];
    if (expected && expected !== entry.letter) {
      warnings.push({
        code: "unexpected_metric_column",
        message:
          `"${entry.mapping.label}" (basis ${entry.basisYear ?? "none"}) resolved at ` +
          `column ${entry.letter}; it was previously observed at ${expected}. ` +
          `Resolved by header, so the figure is correct — the template has shifted.`,
        column: entry.letter,
      });
    }
  }

  // A supported metric absent from the sheet is worth saying out loud: it is
  // how template drift becomes visible before it becomes missing data.
  const presentCodes = new Set(finalBand.map((entry) => entry.mapping.code));
  for (const code of REQUIRED_CORE_METRICS) {
    if (!presentCodes.has(code)) {
      warnings.push({
        code: "missing_metric_header",
        message: `No column resolved to the core metric "${METRICS_BY_CODE.get(code)?.label ?? code}".`,
      });
    }
  }

  return { resolved: finalBand, duplicates, unresolved, separators, warnings };
}
