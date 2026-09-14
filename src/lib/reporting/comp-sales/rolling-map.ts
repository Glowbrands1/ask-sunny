import { normalizeHeader } from "../cells";
import type { ParserWarning } from "../types";

/**
 * THE ROLLING-WINDOW MAP for `CompReport(MTD)`.
 *
 * Scope is exactly the 24 codes seeded by
 * `20260831001900_reporting_rolling_windows`: two measures × four windows ×
 * (current, prior, % change). That sheet carries 333 columns; everything else on
 * it stays out of scope until the business confirms what it means, exactly as
 * for the first parser.
 *
 * WHY THIS IS A SEPARATE MAP FROM `metric-map`.
 *
 * The two sheets do not share a header vocabulary. `CompReport(MTD) vs 2024`
 * labels its measures by YEAR ("2026 OTC Revenue", "TY vs 2024 % Change"), so
 * that map strips year tokens and matches on the measure name. This sheet labels
 * them by WINDOW ("Current Yr Last 3 mos. Revenue", "Last 12 Months % Change"),
 * where the number is the identity rather than noise. One map trying to do both
 * would have to know which sheet it was on, which is the conditional-parser
 * shape the parser seam exists to avoid.
 *
 * WHY `Revenue` MEANS TOTAL REVENUE. The source header says plain "Revenue",
 * which is ambiguous on a sheet carrying OTC, EFT and Total. The workbook is a
 * values-only export with no formulas, so the mapping was settled structurally,
 * against the Total Tans columns as a control (their headers name the measure):
 *
 *   rolling / MTD figure      last 3 mo      last 12 mo
 *   Total Tans (control)          3.80          15.39
 *   Revenue vs Total Revenue      4.01          14.67
 *   Revenue vs OTC Revenue       10.42          36.88
 *   Revenue vs EFT Revenue        6.38          22.98
 *
 * The revenue ratios track the labelled control; OTC and EFT are three to four
 * times out. See the migration for the full note.
 *
 * A WINDOW IS NOT A HISTORY. Every figure here is one number the source
 * calculated. Twelve of them are not twelve months of reports, and nothing
 * downstream may plot them as a path.
 */

/** Months the source reports, in the order it reports them. */
export const ROLLING_WINDOWS = [3, 6, 9, 12] as const;
export type RollingWindowMonths = (typeof ROLLING_WINDOWS)[number];

export type RollingSide = "current" | "prior" | "pct_change";

export interface RollingMeasure {
  /** Metric-code stem, matching the seeded catalogue. */
  code: string;
  label: string;
  family: string;
  /**
   * How the header names it, normalised.
   *
   * `""` for revenue is not an oversight: the source writes "Current Yr Last 3
   * mos. Revenue" and "Last 3 Months % Change", naming the measure in one and
   * omitting it in the other.
   */
  headerMeasure: string;
}

export const ROLLING_MEASURES: RollingMeasure[] = [
  {
    code: "total_revenue",
    label: "Total Revenue",
    family: "revenue",
    headerMeasure: "revenue",
  },
  {
    code: "total_tans",
    label: "Total Tans",
    family: "volume",
    headerMeasure: "total tans",
  },
];

/** `total_revenue` + 3 + `current` -> `total_revenue_last_3m_current`. */
export function rollingMetricCode(
  measureCode: string,
  months: number,
  side: RollingSide,
): string {
  return `${measureCode}_last_${months}m_${side}`;
}

/**
 * COLUMN POSITIONS CONFIRMED IN THE AUDITED WORKBOOK.
 *
 * Recorded for DRIFT DETECTION ONLY, never to resolve a column — the same
 * decision as `metric-map.observedColumns`, and for the same reason: the only
 * headerless-but-populated regions of these sheets are abandoned template
 * debris, so a positional fallback would fire exactly where the data cannot be
 * trusted.
 */
export const OBSERVED_ROLLING_COLUMNS: Record<string, string> = {
  total_revenue_last_3m_current: "AL",
  total_revenue_last_3m_prior: "AM",
  total_revenue_last_3m_pct_change: "AN",
  total_revenue_last_6m_current: "AO",
  total_revenue_last_6m_prior: "AP",
  total_revenue_last_6m_pct_change: "AQ",
  total_revenue_last_9m_current: "AR",
  total_revenue_last_9m_prior: "AS",
  total_revenue_last_9m_pct_change: "AT",
  total_revenue_last_12m_current: "AU",
  total_revenue_last_12m_prior: "AV",
  total_revenue_last_12m_pct_change: "AW",
  total_tans_last_3m_current: "AX",
  total_tans_last_3m_prior: "AY",
  total_tans_last_3m_pct_change: "AZ",
  total_tans_last_6m_current: "BA",
  total_tans_last_6m_prior: "BB",
  total_tans_last_6m_pct_change: "BC",
  total_tans_last_9m_current: "BD",
  total_tans_last_9m_prior: "BE",
  total_tans_last_9m_pct_change: "BF",
  total_tans_last_12m_current: "BG",
  total_tans_last_12m_prior: "BH",
  total_tans_last_12m_pct_change: "BI",
};

/**
 * How many unresolved columns may sit inside the live rolling band.
 *
 * The audited sheet repeats the ENTIRE rolling block a second time at GO..HC,
 * separated from the live one by roughly a hundred unrelated columns. A gap that
 * wide is a boundary, not a spacer, so resolved columns are clustered and only
 * the largest cluster is treated as live — the same rule, and the same reason, as
 * the 2019 remnant on the other sheet.
 */
export const MAX_ROLLING_BAND_GAP = 8;

/** A header as the resolver receives it. */
export interface RollingHeaderCell {
  column: number;
  letter: string;
  header: string;
}

export interface ResolvedRollingColumn {
  code: string;
  measureCode: string;
  months: RollingWindowMonths;
  side: RollingSide;
  column: number;
  letter: string;
  header: string;
}

/** A header that parsed as a rolling column but names no measure. */
interface BareChangeHeader {
  months: RollingWindowMonths;
  column: number;
  letter: string;
  header: string;
}

interface ParsedRollingHeader {
  months: RollingWindowMonths;
  side: RollingSide;
  /** Null when the header names no measure — a bare "% change". */
  measureCode: string | null;
}

/** Collapses the punctuation and abbreviation the source varies between rows. */
function normalizeRollingHeader(header: string): string {
  return normalizeHeader(header)
    .replace(/[.,]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function months(value: string): RollingWindowMonths | null {
  const parsed = Number(value);
  return (ROLLING_WINDOWS as readonly number[]).includes(parsed)
    ? (parsed as RollingWindowMonths)
    : null;
}

function measureFor(text: string): string | null {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned === "") return null;
  const match = ROLLING_MEASURES.find((measure) => measure.headerMeasure === cleaned);
  return match ? match.code : null;
}

/**
 * Reads one header.
 *
 * Two shapes, and the source uses `mos.`, `mos`, `mo.` and `Months`
 * interchangeably within the same block — hence one alternation rather than a
 * list of literal headers that would need editing every template revision.
 */
export function parseRollingHeader(header: string): ParsedRollingHeader | null {
  const text = normalizeRollingHeader(header);

  const valueSide = /^(current|prior) yr last (\d{1,2}) (?:mos|months|mo) (.+)$/.exec(text);
  if (valueSide) {
    const window = months(valueSide[2]);
    const measureCode = measureFor(valueSide[3]);
    if (window === null || measureCode === null) return null;
    return {
      months: window,
      side: valueSide[1] === "current" ? "current" : "prior",
      measureCode,
    };
  }

  const change = /^last (\d{1,2}) (?:mos|months|mo)\s*(.*?)% change$/.exec(text);
  if (change) {
    const window = months(change[1]);
    if (window === null) return null;
    // A bare change header names no measure; it is resolved by adjacency below.
    return { months: window, side: "pct_change", measureCode: measureFor(change[2]) };
  }

  return null;
}

export interface RollingResolution {
  resolved: ResolvedRollingColumn[];
  /** Codes that resolved more than once. Every occurrence is excluded. */
  duplicates: { code: string; letters: string[] }[];
  /** Codes the sheet did not offer at all. */
  missing: string[];
  warnings: ParserWarning[];
}

/** Groups columns into runs, splitting where the gap exceeds the band limit. */
function cluster<T extends { column: number }>(items: T[], maxGap: number): T[][] {
  const sorted = [...items].sort((a, b) => a.column - b.column);
  const groups: T[][] = [];
  let current: T[] = [];
  for (const item of sorted) {
    const previous = current[current.length - 1];
    if (previous && item.column - previous.column > maxGap) {
      groups.push(current);
      current = [];
    }
    current.push(item);
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

/**
 * Resolves the rolling band from header text.
 *
 * HEADER TEXT IS THE ONLY RESOLVER. Positions are recorded above and used
 * solely to report drift.
 *
 * A BARE `% change` HEADER IS RESOLVED BY ADJACENCY, not by assumption. The
 * source writes "Last 3 Months % Change" inside the revenue group and "Last 3
 * mo. Total Tans % Change" inside the tans group; reading the first as revenue
 * because revenue comes first in the sheet would be a guess that silently breaks
 * the day the blocks are reordered. Instead a bare change column takes the
 * measure of the nearest preceding value column with the SAME window, and says
 * so in a warning when it cannot.
 */
export function resolveRollingColumns(headers: RollingHeaderCell[]): RollingResolution {
  const warnings: ParserWarning[] = [];
  const identified: (ResolvedRollingColumn | BareChangeHeader)[] = [];

  for (const cell of headers) {
    if (cell.header.trim() === "") continue;
    const parsed = parseRollingHeader(cell.header);
    if (!parsed) continue;

    if (parsed.side === "pct_change" && parsed.measureCode === null) {
      identified.push({
        months: parsed.months,
        column: cell.column,
        letter: cell.letter,
        header: cell.header,
      });
      continue;
    }

    identified.push({
      code: rollingMetricCode(parsed.measureCode as string, parsed.months, parsed.side),
      measureCode: parsed.measureCode as string,
      months: parsed.months,
      side: parsed.side,
      column: cell.column,
      letter: cell.letter,
      header: cell.header,
    });
  }

  // Only the largest run is live. The audited sheet repeats the whole block.
  const groups = cluster(identified, MAX_ROLLING_BAND_GAP);
  const live = groups.sort((a, b) => b.length - a.length)[0] ?? [];

  for (const group of groups) {
    if (group === live || group.length === 0) continue;
    warnings.push({
      code: "out_of_band_column",
      message: `Ignored a repeated rolling block of ${group.length} columns at ${group[0].letter}..${group[group.length - 1].letter}; the live band is ${live.length > 0 ? `${live[0].letter}..${live[live.length - 1].letter}` : "empty"}.`,
    });
  }

  // Resolve bare change headers against their neighbours in the live band.
  const resolved: ResolvedRollingColumn[] = [];
  for (const item of live) {
    if ("code" in item) {
      resolved.push(item);
      continue;
    }
    const sameWindow = live
      .filter(
        (other): other is ResolvedRollingColumn =>
          "code" in other && other.months === item.months && other.column < item.column,
      )
      .sort((a, b) => b.column - a.column)[0];

    if (!sameWindow) {
      warnings.push({
        code: "unassociated_percent_change",
        message: `Column ${item.letter} ("${item.header}") is a ${item.months}-month change with no preceding value column for the same window, so the measure it belongs to is unknown. Excluded.`,
      });
      continue;
    }
    resolved.push({
      code: rollingMetricCode(sameWindow.measureCode, item.months, "pct_change"),
      measureCode: sameWindow.measureCode,
      months: item.months,
      side: "pct_change",
      column: item.column,
      letter: item.letter,
      header: item.header,
    });
  }

  // A code resolving twice is evidence of a template we do not understand.
  // Every occurrence is excluded: picking one would be a coin toss.
  const byCode = new Map<string, ResolvedRollingColumn[]>();
  for (const column of resolved) {
    byCode.set(column.code, [...(byCode.get(column.code) ?? []), column]);
  }

  const duplicates: RollingResolution["duplicates"] = [];
  const kept: ResolvedRollingColumn[] = [];
  for (const [code, columns] of byCode) {
    if (columns.length > 1) {
      duplicates.push({ code, letters: columns.map((column) => column.letter) });
      warnings.push({
        code: "duplicate_metric_column",
        message: `"${code}" resolved at ${columns.map((c) => c.letter).join(", ")}. All were excluded: choosing between identically-headed columns would be a guess.`,
      });
      continue;
    }
    kept.push(columns[0]);
  }

  // Drift: header matching still wins, the mismatch is only reported.
  for (const column of kept) {
    const observed = OBSERVED_ROLLING_COLUMNS[column.code];
    if (observed && observed !== column.letter) {
      warnings.push({
        code: "unexpected_metric_column",
        message: `"${column.code}" resolved at ${column.letter}, previously observed at ${observed}. Header matching was used; the template appears to have moved.`,
      });
    }
  }

  const expected = ROLLING_MEASURES.flatMap((measure) =>
    ROLLING_WINDOWS.flatMap((window) =>
      (["current", "prior", "pct_change"] as RollingSide[]).map((side) =>
        rollingMetricCode(measure.code, window, side),
      ),
    ),
  );
  const found = new Set(kept.map((column) => column.code));
  const missing = expected.filter((code) => !found.has(code));
  for (const code of missing) {
    warnings.push({
      code: "missing_metric_header",
      message: `No column resolved to the rolling measure "${code}".`,
    });
  }

  return {
    resolved: kept.sort((a, b) => a.column - b.column),
    duplicates,
    missing,
    warnings,
  };
}

/**
 * ============================================================================
 * THE YEAR-COMPARISON BLOCK ON THE SAME SHEET
 * ============================================================================
 *
 * The 14 September review: "The comparison is set to vs. 2024, not 2025."
 *
 * A previous pass fixed the SELECTION — `preferredBaselineYear` derives the year
 * before the current one instead of naming 2024 in a constant — and the screen
 * did not change, because there was no 2025 to select. Windows are discovered
 * from stored facts, and no month-to-date sheet contributed a 2025 basis year:
 * `CompReport(MTD) vs 2024` carries no 2025 column at all, and this sheet's
 * 2025 columns were outside the 24 rolling codes this map was written for. The
 * report then fell back to the newest year it did hold, which was 2024.
 *
 * So the fix is data, not selection logic. `CompReport(MTD)` publishes the
 * comparison the business actually asked for:
 *
 *     AF  Est. 2026 Total Revenue        the current side
 *     AG  2025 Total Revenue             the baseline
 *     AH  TY vs. 2025 % Change           the source's own signed change
 *
 * Verified on the 8 September 2026 delivery, across all fifteen salon rows:
 * `AH = round(AF / AG - 1, 4)` on 15/15. The source rounds to four decimal
 * places; the value stored is the source's, not a recomputation.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS DELIBERATELY NOT MAPPED, AND WHY
 * ---------------------------------------------------------------------------
 *
 * THE 2024 BLOCK ON THIS SHEET. Three columns further right sit a second,
 * similar-looking triple:
 *
 *     AI  2026 Revenue (if >24 mos. old)
 *     AJ  2024 Total Revenue
 *     AK  TY vs. 2024 % Change
 *
 * `AK = round(AI / AJ - 1, 4)` on 15/15 too, so it is coherent — and it is
 * still excluded, for two measured reasons rather than caution:
 *
 *   ITS CURRENT SIDE IS A DIFFERENT POPULATION. AI is not Total Revenue; it is
 *   Total Revenue for salons older than 24 months. On this delivery AI equals
 *   AF on all fifteen rows because every salon is old enough, so the difference
 *   is invisible today and would appear without warning the first month a new
 *   salon opens. A window whose "current" and whose "% change" disagree about
 *   which salons they describe is worse than a window that is not offered.
 *
 *   `vs 2024` ALREADY HAS A BETTER SOURCE. `CompReport(MTD) vs 2024` carries
 *   `TY vs 2024 % Change` at full precision, where this sheet rounds to four
 *   places — the two disagree on 15/15 rows in the fifth decimal. That sheet is
 *   declared first, so it wins the window either way; mapping AK here would
 *   store a rounded duplicate that nothing ever reads.
 *
 * The exclusion needs no special case: AI does not match the current-side
 * pattern, so the triple never completes. This note records that it was checked,
 * not that it was overlooked.
 *
 * EVERY OTHER MEASURE'S 2025 COMPARISON. The sheet also carries `2026 UV Tans`
 * / `2025 UV Tans` / `UV Tans % Change` and eight more like it. Their change
 * headers name no year, so the year-anchored rule below does not reach them and
 * they stay out of scope with the other 300-odd columns, exactly as the module
 * note says. Total Revenue is the measure the dashboard opens on, and the one
 * the review named.
 *
 * ---------------------------------------------------------------------------
 * WHY THE CHANGE COLUMN IS THE ANCHOR
 * ---------------------------------------------------------------------------
 *
 * Resolution starts from `TY vs. <year> % Change` and works LEFTWARDS, rather
 * than collecting every `<year> Total Revenue` header it can see. The sheet
 * repeats an abandoned template block at GI..GN — `Est. 2016 Total Revenue`,
 * `2015 Total Revenue`, `2011 Total Revenue` — which a measure-first rule would
 * happily file as 2016, 2015 and 2011 basis years, and which would then appear
 * in the window dropdown as real comparisons. Those columns have no
 * `TY vs. <year> % Change` beside them (the debris writes `TY vs. LY % Change`
 * and `TY vs. L2Yrs % Change`, naming no year), so anchoring on the change
 * column excludes the whole block by construction.
 */

/** The measure this block reports. The only one in scope on this sheet. */
const BASELINE_MEASURE_CODE = "total_revenue";

/** `TY vs. 2025 % Change`. The year is the baseline being compared against. */
const BASELINE_CHANGE_HEADER = /^ty vs (\d{4}) % change$/;

/** `2025 Total Revenue`. The baseline figure itself. */
const BASELINE_VALUE_HEADER = /^(\d{4}) total revenue$/;

/** `Est. 2026 Total Revenue`. The current side of the comparison. */
const BASELINE_CURRENT_HEADER = /^est (\d{4}) total revenue$/;

/** Column positions confirmed in the audited workbook. Drift signal only. */
export const OBSERVED_BASELINE_COLUMNS: Record<string, string> = {
  "total_revenue|2026": "AF",
  "total_revenue|2025": "AG",
  "total_revenue_pct_change|2025": "AH",
};

export interface ResolvedBaselineColumn {
  /** `total_revenue` or `total_revenue_pct_change`. */
  code: string;
  basisYear: number;
  column: number;
  letter: string;
  header: string;
}

export interface BaselineResolution {
  resolved: ResolvedBaselineColumn[];
  warnings: ParserWarning[];
}

/** `total_revenue` + 2025 -> the catalogue key used for drift lookup. */
function baselineKey(code: string, basisYear: number): string {
  return `${code}|${basisYear}`;
}

/**
 * Resolves the year-comparison triple from header text.
 *
 * Returns nothing at all when the triple does not complete. A baseline figure
 * with no change column, or a change column with no baseline beside it, is not
 * half a comparison — it is a block this parser does not recognise, and filing
 * either half would put a year in the window dropdown that no figure supports.
 */
export function resolveBaselineColumns(headers: RollingHeaderCell[]): BaselineResolution {
  const warnings: ParserWarning[] = [];
  const byColumn = new Map<number, RollingHeaderCell>();
  for (const cell of headers) byColumn.set(cell.column, cell);

  const resolved: ResolvedBaselineColumn[] = [];
  const seen = new Set<string>();

  for (const cell of headers) {
    const change = BASELINE_CHANGE_HEADER.exec(normalizeRollingHeader(cell.header));
    if (!change) continue;
    const basisYear = Number(change[1]);

    const baselineCell = byColumn.get(cell.column - 1);
    const baseline = baselineCell
      ? BASELINE_VALUE_HEADER.exec(normalizeRollingHeader(baselineCell.header))
      : null;
    if (!baselineCell || !baseline || Number(baseline[1]) !== basisYear) {
      warnings.push({
        code: "unassociated_percent_change",
        message:
          `Column ${cell.letter} ("${cell.header}") compares against ${basisYear}, but the ` +
          `column to its left is not that year's Total Revenue, so the comparison could not ` +
          `be identified. Excluded.`,
        column: cell.letter,
      });
      continue;
    }

    const currentCell = byColumn.get(cell.column - 2);
    const current = currentCell
      ? BASELINE_CURRENT_HEADER.exec(normalizeRollingHeader(currentCell.header))
      : null;
    if (!currentCell || !current || Number(current[1]) <= basisYear) {
      /*
       * The `2026 Revenue (if >24 mos. old)` case, and the reason it is a
       * warning rather than a silent skip: the block IS a real comparison in
       * the source, and a reader looking at the sheet should be told why the
       * product does not offer it.
       */
      warnings.push({
        code: "unassociated_percent_change",
        message:
          `Column ${cell.letter} ("${cell.header}") has ${basisYear} Total Revenue beside it ` +
          `but no "Est. <year> Total Revenue" current side, so which figures it compares is ` +
          `not established. Excluded.`,
        column: cell.letter,
      });
      continue;
    }

    const currentYear = Number(current[1]);
    const entries: ResolvedBaselineColumn[] = [
      {
        code: BASELINE_MEASURE_CODE,
        basisYear: currentYear,
        column: currentCell.column,
        letter: currentCell.letter,
        header: currentCell.header,
      },
      {
        code: BASELINE_MEASURE_CODE,
        basisYear,
        column: baselineCell.column,
        letter: baselineCell.letter,
        header: baselineCell.header,
      },
      {
        code: `${BASELINE_MEASURE_CODE}_pct_change`,
        basisYear,
        column: cell.column,
        letter: cell.letter,
        header: cell.header,
      },
    ];

    for (const entry of entries) {
      const key = baselineKey(entry.code, entry.basisYear);
      // The current-side figure is shared by every comparison on the sheet, so
      // a second triple would legitimately resolve it again. First wins.
      if (seen.has(key)) continue;
      seen.add(key);
      resolved.push(entry);

      const observed = OBSERVED_BASELINE_COLUMNS[key];
      if (observed && observed !== entry.letter) {
        warnings.push({
          code: "unexpected_metric_column",
          message:
            `"${entry.code}" (basis ${entry.basisYear}) resolved at ${entry.letter}, previously ` +
            `observed at ${observed}. Header matching was used; the template appears to have moved.`,
          column: entry.letter,
        });
      }
    }
  }

  return { resolved: resolved.sort((a, b) => a.column - b.column), warnings };
}
