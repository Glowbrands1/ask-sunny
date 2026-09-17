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
 * THE YEAR-COMPARISON BLOCKS ON THE SAME SHEET
 * ============================================================================
 *
 * The 14 September review: "The comparison is set to vs. 2024, not 2025."
 *
 * Windows are discovered from stored facts, and no month-to-date sheet produced
 * a 2025 basis year: `CompReport(MTD) vs 2024` carries no 2025 column at all,
 * and this sheet's 2025 columns were outside the 24 rolling codes this map was
 * first written for. So the report fell back to the newest year it did hold.
 *
 * WHAT THE SHEET ACTUALLY PUBLISHES. Four complete 2026/2025/change triples,
 * audited across all fifteen salon rows of the 10 September 2026 delivery:
 *
 *     AF  Est. 2026 Total Revenue   AG  2025 Total Revenue   AH  TY vs. 2025 % Change
 *     BV  2026 Unique Tanners       BW  2025 Unique Tanners  BX  Unique Tanners % Change
 *     BY  2026 Total Tans           BZ  2025 Total Tans      CA  Total Tans % Change
 *     FF  2026 EFT Revenue          FG  2025 EFT Revenue     FH  EFT Revenue % Change
 *
 * Current side present on 15/15 and 2025 baseline present on 15/15 for every
 * one of the four. The published change reconciles against its own pair on
 * 15/15: Total Revenue rounded to four places, the other three at full
 * precision. THE STORED VALUE IS THE SOURCE'S OWN — nothing is recomputed, and
 * the rounding difference is why that matters.
 *
 * An earlier pass mapped only Total Revenue and said the rest stayed "out of
 * scope until the business confirms what it means". That was right about the
 * sheet's other three hundred columns and wrong about these three: they are the
 * same four measures the year-comparison sheet already publishes, under the
 * same reviewed codes, and leaving them out is what made EFT Revenue and Unique
 * Tanners vanish from the `vs 2025` headline row while Total Tans rendered as
 * "Unavailable".
 *
 * ---------------------------------------------------------------------------
 * TWO HEADER SHAPES, ONE STRUCTURE
 * ---------------------------------------------------------------------------
 *
 * The current side is `Est. <year> Total Revenue` for revenue and
 * `<year> <measure>` for the rest; the change column names the year
 * (`TY vs. 2025 % Change`) for revenue and only the measure
 * (`Total Tans % Change`) for the rest. Underneath, all four are the same
 * thing: THREE ADJACENT COLUMNS — current year, baseline year, the change
 * between them — so the structure is what resolution keys on and the header
 * wording is matched loosely enough to cover both spellings.
 *
 * A BARE CHANGE HEADER TAKES ITS YEAR FROM ITS OWN BLOCK, never from a
 * neighbour's. `Total Tans % Change` names no year, but the two columns
 * immediately left of it are 2026 and 2025 Total Tans — the same measure — so
 * the baseline is read off them. A change header whose measure does not match
 * the pair beside it resolves nothing, which is what keeps `EFT Tans % Change`
 * from attaching itself to Total Tans the way it once did on the other sheet.
 *
 * ---------------------------------------------------------------------------
 * WHY THE CURRENT YEAR MUST BE THE REPORT'S OWN
 * ---------------------------------------------------------------------------
 *
 * This sheet repeats an abandoned template block a hundred columns right, with
 * the SAME STRUCTURE and the same measure names:
 *
 *     GI  Est. 2016 Total Revenue   GJ  2015 Total Revenue   GK  TY vs. LY % Change
 *     HV  2016 Unique Tanners       HW  2015 Unique Tanners  HX  Unique Tanners % Change
 *     HY  2016 Total Tans           HZ  2015 Total Tans      IA  Total Tans % Change
 *     KW  2016 EFT Revenue          KX  2015 EFT Revenue     KY  EFT Revenue % Change
 *
 * Structure alone cannot tell the two apart — the debris is a perfect copy of
 * the shape. What separates them is that a comparison's CURRENT side is the
 * year this report is about: 2026 here, 2016 there. So a triple is accepted
 * only when its current-side year equals the period's own fiscal year, read
 * from the workbook's period marker rather than from a constant. That excludes
 * 2016 / 2015 / 2011 by construction, needs no allowlist of dead years, and
 * keeps working when the live block rolls to 2027.
 *
 * THE 2024 BLOCK IS STILL EXCLUDED, and now for a reason the rule states
 * itself: `AI 2026 Revenue (if >24 mos. old)` is not Total Revenue — it is
 * Total Revenue for salons older than 24 months, a different population that
 * happens to equal AF on every row of this delivery. It does not match the
 * current-side pattern, so the triple never completes. `vs 2024` is read from
 * `CompReport(MTD) vs 2024`, which publishes it at full precision where this
 * sheet rounds.
 */

/** A measure this sheet's year-comparison blocks may report. */
interface BaselineMeasure {
  /** The reviewed metric code, shared with the year-comparison sheet. */
  readonly code: string;
  /** The measure name as the headers write it, normalised. */
  readonly header: string;
}

/**
 * THE FOUR, and no more.
 *
 * These are exactly the measures the Salon Performance landing row shows, and
 * exactly the ones the other month-to-date sheet already publishes under these
 * codes. The sheet's remaining three hundred columns — PPTA, LPTA, club
 * movements, labour hours — stay out of scope until the business confirms what
 * they mean, as they always have.
 */
export const BASELINE_MEASURES: readonly BaselineMeasure[] = [
  { code: "total_revenue", header: "total revenue" },
  { code: "eft_revenue", header: "eft revenue" },
  { code: "total_tans", header: "total tans" },
  { code: "unique_tanners", header: "unique tanners" },
];

/** `Est. 2026 Total Revenue` / `2026 Total Tans` — the current side. */
const CURRENT_SIDE = /^(?:est )?(\d{4}) (.+)$/;

/** `2025 Total Revenue` — the baseline figure. */
const BASELINE_SIDE = /^(\d{4}) (.+)$/;

/** `TY vs. 2025 % Change` — a change column that names its own baseline year. */
const CHANGE_WITH_YEAR = /^ty vs (\d{4}) % change$/;

/** `Total Tans % Change` — a change column that names only its measure. */
const CHANGE_WITH_MEASURE = /^(.+?) % change$/;

/** Column positions confirmed in the audited workbook. Drift signal only. */
export const OBSERVED_BASELINE_COLUMNS: Record<string, string> = {
  "total_revenue|2026": "AF",
  "total_revenue|2025": "AG",
  "total_revenue_pct_change|2025": "AH",
  "unique_tanners|2026": "BV",
  "unique_tanners|2025": "BW",
  "unique_tanners_pct_change|2025": "BX",
  "total_tans|2026": "BY",
  "total_tans|2025": "BZ",
  "total_tans_pct_change|2025": "CA",
  "eft_revenue|2026": "FF",
  "eft_revenue|2025": "FG",
  "eft_revenue_pct_change|2025": "FH",
};

export interface ResolvedBaselineColumn {
  /** A reviewed base code, or that code with `_pct_change`. */
  readonly code: string;
  readonly basisYear: number;
  readonly column: number;
  readonly letter: string;
  readonly header: string;
}

export interface BaselineResolution {
  resolved: ResolvedBaselineColumn[];
  warnings: ParserWarning[];
}

export interface ResolveBaselineOptions {
  /**
   * The year this report is about, from its own period marker.
   *
   * REQUIRED, with no default. A default would be a year in the source, which
   * is the class of constant this whole module exists to avoid — and it is the
   * only thing separating the live block from the abandoned copy of it.
   */
  readonly currentYear: number;
}

/** Matches a measure name, allowing the source's minor spacing variations. */
function baselineMeasureFor(text: string): BaselineMeasure | null {
  const cleaned = text.replace(/\s+/g, " ").trim();
  return BASELINE_MEASURES.find((measure) => measure.header === cleaned) ?? null;
}

/**
 * Resolves the year-comparison triples from header text.
 *
 * A triple that does not complete yields NOTHING, not a half comparison. A
 * baseline with no change column, or a change column whose measure disagrees
 * with the pair beside it, is a block this parser does not recognise — and
 * filing either half would put a year in the window picker that no figure
 * supports.
 */
export function resolveBaselineColumns(
  headers: RollingHeaderCell[],
  options: ResolveBaselineOptions,
): BaselineResolution {
  const warnings: ParserWarning[] = [];
  const byColumn = new Map<number, RollingHeaderCell>();
  for (const cell of headers) byColumn.set(cell.column, cell);

  const resolved: ResolvedBaselineColumn[] = [];
  const seen = new Set<string>();

  const read = (column: number): { text: string; cell: RollingHeaderCell } | null => {
    const cell = byColumn.get(column);
    if (!cell || cell.header.trim() === "") return null;
    return { text: normalizeRollingHeader(cell.header), cell };
  };

  for (const cell of headers) {
    const currentText = normalizeRollingHeader(cell.header);
    const current = CURRENT_SIDE.exec(currentText);
    if (!current) continue;

    const currentYear = Number(current[1]);
    const measure = baselineMeasureFor(current[2]);
    if (!measure) continue;

    /*
     * THE LIVE BLOCK IS THE ONE ABOUT THIS YEAR. The abandoned template copy
     * has the same structure with 2016 on its current side, so this single
     * comparison is what separates them — silently, because debris is not a
     * fault worth reporting on every ingestion.
     */
    if (currentYear !== options.currentYear) continue;

    const baselineRead = read(cell.column + 1);
    const baseline = baselineRead ? BASELINE_SIDE.exec(baselineRead.text) : null;
    if (!baselineRead || !baseline) continue;
    if (baselineMeasureFor(baseline[2])?.code !== measure.code) continue;

    const basisYear = Number(baseline[1]);
    if (basisYear >= currentYear) continue;

    const changeRead = read(cell.column + 2);
    if (!changeRead) continue;

    const withYear = CHANGE_WITH_YEAR.exec(changeRead.text);
    const withMeasure = CHANGE_WITH_MEASURE.exec(changeRead.text);
    const changeMatches =
      withYear !== null
        ? Number(withYear[1]) === basisYear
        : withMeasure !== null && baselineMeasureFor(withMeasure[1])?.code === measure.code;

    if (!changeMatches) {
      warnings.push({
        code: "unassociated_percent_change",
        message:
          `${measure.code} has ${currentYear} and ${basisYear} figures at ` +
          `${cell.letter}..${baselineRead.cell.letter}, but the column beside them ` +
          `("${changeRead.cell.header}") is not that comparison's change, so the block was ` +
          `not read.`,
        column: changeRead.cell.letter,
      });
      continue;
    }

    const entries: ResolvedBaselineColumn[] = [
      { code: measure.code, basisYear: currentYear, column: cell.column, letter: cell.letter, header: cell.header },
      {
        code: measure.code,
        basisYear,
        column: baselineRead.cell.column,
        letter: baselineRead.cell.letter,
        header: baselineRead.cell.header,
      },
      {
        code: `${measure.code}_pct_change`,
        basisYear,
        column: changeRead.cell.column,
        letter: changeRead.cell.letter,
        header: changeRead.cell.header,
      },
    ];

    for (const entry of entries) {
      const key = `${entry.code}|${entry.basisYear}`;
      // A measure could legitimately appear in two blocks against two baselines;
      // its current-side figure is then resolved twice. First wins.
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
