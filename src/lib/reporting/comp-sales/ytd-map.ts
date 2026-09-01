import type { ParserWarning } from "../types";
import { yearTokens } from "../cells";
import {
  isPercentChangeHeader,
  resolveMetricColumns,
  type HeaderCell,
  type MetricResolution,
  type ResolveMetricOptions,
} from "./metric-map";

/**
 * COLUMN MAPPING FOR `CompReport(YTD)`.
 *
 * The year-to-date sheet reports the same eight measures as the year-comparison
 * sheet, against 2025 rather than 2024, and it does so with three header habits
 * the shared resolver had no reason to know about until now. Each rule below
 * exists because of something the audit FOUND in the file, and the audit's
 * evidence is recorded with it — a rule whose reason is not written down is a
 * rule the next person will delete.
 *
 * WHAT THE AUDIT ESTABLISHED, measured across all fifteen salon rows:
 *
 *   AF = AA + AD, and row 34 heads AF "YTD 2026 Total Revenue" while row 1
 *   heads it "Est. 2026 Total Revenue". It is the actual year-to-date total,
 *   not a projection. Row 34 is the salon band's own header row and is the one
 *   this parser reads.
 *
 *   AH = AF / AG − 1 on 15/15 rows. So AF/AG/AH is a coherent 2026-vs-2025
 *   triple, and it is the comparison this sheet can support.
 *
 *   AK = AI / AJ − 1 on 15/15 rows, where AI = AF exactly. So AK's baseline is
 *   AJ — which is headed "2025 Total Revenue" while AK is headed "TY vs. 2024
 *   % Change". Two contradictory year labels for one comparison. AG and AJ hold
 *   DIFFERENT figures on 15/15 rows, so they are not two names for one number,
 *   and AG is larger on 9 rows and smaller on 6 — no consistent relationship
 *   that would identify what AJ is. It is unidentifiable, and both columns are
 *   excluded. See `dropChangeWithoutBaseline` in `metric-map.ts`.
 *
 *   No 2019 or 2024 FIGURE column exists anywhere on the sheet. 2025 is the
 *   only baseline it carries.
 *
 *   Every 2025 column differs from its 2026 partner on 15/15 rows, so none of
 *   them is a stale copy — the failure mode the year-comparison sheet had.
 */

/**
 * The grain word, dropped before matching.
 *
 * `YTD 2026 Total Revenue` is "Total Revenue" with the sheet's own accumulation
 * window written into the header. The window is a property of the SHEET, and
 * the parser already refuses a period marker whose grain disagrees with it, so
 * the token carries no measure identity here. `mtd` is dropped with it: the
 * year-to-date sheet still carries a stale `OTC Revenue MTD` column in its
 * repeat block, and treating that as a distinct measure rather than as an
 * out-of-band remnant would be worse.
 */
const YTD_NOISE_TOKENS = ["ytd", "mtd"] as const;

/**
 * The columns this sheet is expected to hold, from the audit.
 *
 * Drift detection only. Nothing is read by position — every figure is resolved
 * by header text, and this list exists so a template that moves says so.
 */
export const OBSERVED_YTD_COLUMNS: Record<string, string> = {
  "total_revenue|2026": "AF",
  "total_revenue|2025": "AG",
  "total_revenue_pct_change|2025": "AH",
  "uv_tans|2026": "BJ",
  "uv_tans|2025": "BK",
  "uv_tans_pct_change|2025": "BL",
  "sunless_tans|2026": "BM",
  "sunless_tans|2025": "BN",
  "sunless_tans_pct_change|2025": "BO",
  "spa_sessions|2026": "BP",
  "spa_sessions|2025": "BQ",
  "spa_sessions_pct_change|2025": "BR",
  "unique_tanners|2026": "BV",
  "unique_tanners|2025": "BW",
  "unique_tanners_pct_change|2025": "BX",
  "total_tans|2026": "BY",
  "total_tans|2025": "BZ",
  "total_tans_pct_change|2025": "CA",
  "otc_revenue|2026": "DO",
  "otc_revenue|2025": "DP",
  "otc_revenue_pct_change|2025": "DQ",
  "eft_revenue|2026": "ET",
  "eft_revenue|2025": "EU",
  "eft_revenue_pct_change|2025": "EV",
};

/**
 * The options that make the shared resolver read this sheet.
 *
 * Every one is opt-in, so the year-comparison sheet — whose 562 facts are
 * already live — resolves exactly as it did before this file existed.
 */
export const YTD_RESOLVE_OPTIONS: ResolveMetricOptions = {
  noiseTokens: YTD_NOISE_TOKENS,
  // `UV Tans % Change` follows `2026 UV Tans` and `2025 UV Tans`. The baseline
  // is unambiguous from the two columns before it; refusing it for naming no
  // year would discard eight real measures over a header style.
  inferChangeBasisYearFromBlock: true,
  // The AJ/AK rule. See the module comment above.
  dropChangeWithoutBaseline: true,
  // The shared observed layout is the year-comparison sheet's. This sheet has
  // its own, checked by the parser against `OBSERVED_YTD_COLUMNS`.
  observedColumnDrift: false,
};

/**
 * Resolves the year-to-date sheet's measure columns.
 *
 * The trailing-window headers are removed BEFORE resolution, not left to be
 * caught downstream. Left in, `Last 3 Months % Change` is a change header with
 * no year, so the block-inference rule would attach it to whatever measure
 * block precedes it — Total Revenue — at the block's baseline year, making it
 * an exact duplicate of the real change column. The duplicate rule would then
 * drop it, and the right answer would come out for the wrong reason: remove the
 * real column and one of eight trailing columns silently becomes the Total
 * Revenue change. Excluding them by name means that cannot happen.
 */
export function resolveYtdColumns(
  headers: HeaderCell[],
  options: { measuresStartAt?: number } = {},
): MetricResolution {
  const measuresStartAt = options.measuresStartAt ?? MEASURE_BAND_START;
  const bandEnd = liveBandEnd(headers, measuresStartAt);
  const inBand = headers.filter((cell) => bandEnd === null || cell.column < bandEnd);

  const trailing = inBand.filter((cell) => isTrailingWindowHeader(cell.header));
  const contradictory = contradictoryYearPairs(inBand);
  const excluded = new Set([
    ...trailing.map((cell) => cell.column),
    ...contradictory.map((cell) => cell.column),
  ]);
  const live = inBand.filter((cell) => !excluded.has(cell.column));
  const resolution = resolveMetricColumns(live, {
    ...YTD_RESOLVE_OPTIONS,
    /**
     * The excluded block sits INSIDE the live band — twenty-four columns of it,
     * between the total-revenue triple and the volume measures. Removed from
     * the header list it leaves a hole the band clustering reads as a boundary,
     * splitting Total Revenue off and discarding it as a remnant. Naming the
     * columns here means the gap is discounted rather than the threshold
     * loosened, so the genuine remnant far to the right is still excluded.
     */
    /**
     * Every headed column inside the band bridges the gap between measures.
     *
     * The clustering rule that finds the live band measures the distance
     * between RESOLVED columns, which works when the supported measures are
     * contiguous — as they are on the year-comparison sheet — and fails here.
     * This sheet puts thirty-nine headed columns of measures nobody has
     * reviewed (Total PPTA, LPTA, UPTA, Total Product and the rest) between
     * Total Tans and OTC Revenue. Unbridged, that gap splits the band and OTC
     * Revenue and EFT Revenue are discarded as a remnant — six real measures
     * lost to a rule meant to catch abandoned ones.
     *
     * A HEADED COLUMN IS PART OF THE TABLE even when we do not read it. The
     * thing that ends a table is the blank column, which `liveBandEnd` finds.
     */
    bridgeColumns: new Set(
      inBand.filter((cell) => cell.header.trim().length > 0).map((cell) => cell.column),
    ),
  });
  return {
    ...resolution,
    warnings: [
      ...bandEndWarnings(headers, bandEnd),
      ...trailingWindowWarnings(inBand),
      ...contradictoryPairWarnings(contradictory),
      ...resolution.warnings,
    ],
  };
}

/** Where the measure headers begin, past the descriptor band. */
const MEASURE_BAND_START = 27;

/**
 * The first column past the end of the live measure table.
 *
 * A BLANK HEADER ENDS THE TABLE. On this sheet the live block runs unbroken
 * from AA to FP — one hundred and forty-six headed columns, not one of them
 * empty — then a single blank at FQ, then a stale copy of the whole thing
 * beginning at FR with `OTC Revenue MTD` on a year-to-date sheet and running on
 * to `Est. 2014 Total Revenue` and `2013 Total Revenue`.
 *
 * Using the blank rather than a distance between recognised measures is what
 * lets both halves of this sheet be judged correctly: the live block contains
 * long runs of measures nobody has reviewed, and the remnant is separated by a
 * single column. A distance rule cannot tell those apart; the sheet's own
 * structure can.
 *
 * Null when there is no blank at all, in which case nothing is excluded here
 * and the resolver's own clustering is the only boundary.
 */
export function liveBandEnd(headers: HeaderCell[], from: number): number | null {
  let started = false;
  for (const cell of headers) {
    if (cell.column < from) continue;
    const headed = cell.header.trim().length > 0;
    if (!started) {
      if (headed) started = true;
      continue;
    }
    if (!headed) return cell.column;
  }
  return null;
}

/** Says how much of the sheet lies past the live band, so the cut is visible. */
export function bandEndWarnings(
  headers: HeaderCell[],
  bandEnd: number | null,
): ParserWarning[] {
  if (bandEnd === null) return [];
  const beyond = headers.filter(
    (cell) => cell.column > bandEnd && cell.header.trim().length > 0,
  );
  if (beyond.length === 0) return [];
  return [
    {
      code: "out_of_band_column",
      message:
        `${beyond.length} columns beyond ${beyond[0].letter} were EXCLUDED: the live measure ` +
        `table ends at the blank column before them, and what follows is a stale copy of it ` +
        `— its first headers read "${beyond[0].header}" and, further right, name years long ` +
        `past. Nothing after the break was read.`,
      column: beyond[0].letter,
    },
  ];
}

/**
 * A MEASURE COLUMN WHOSE OWN CHANGE COLUMN NAMES A DIFFERENT YEAR.
 *
 * The structural form of the `AJ`/`AK` problem, stated so it is caught by what
 * the sheet SAYS rather than by a column letter that will move.
 *
 * `AJ` is headed "2025 Total Revenue" and the column immediately after it is
 * headed "TY vs. 2024 % Change" — and the audit confirmed the change really is
 * computed from `AJ`, on all fifteen rows. One of those two labels is stale and
 * nothing in the file says which. Two columns earlier, `AG` is headed "YTD 2025
 * Total Revenue" and `AH` "TY vs. 2025 % Change": labels that agree with each
 * other, and arithmetic that confirms them. So the coherent pair is read and
 * the contradictory one is excluded — both halves of it, because a figure whose
 * year is unknown is not a figure we can file.
 *
 * Excluded BEFORE resolution, deliberately. Left in, `AJ` would arrive as a
 * duplicate of `AG` and the parser's fail-closed duplicate check would reject
 * the whole workbook — refusing a file we understand perfectly well. Removing
 * it here keeps that check meaning what it says: any duplicate that still
 * reaches the live band is drift nobody has accounted for.
 */
export function contradictoryYearPairs(headers: HeaderCell[]): HeaderCell[] {
  const filled = headers.filter((cell) => cell.header.trim().length > 0);
  const flagged: HeaderCell[] = [];

  for (let index = 0; index < filled.length - 1; index += 1) {
    const base = filled[index];
    const next = filled[index + 1];
    if (isPercentChangeHeader(base.header)) continue;
    if (!isPercentChangeHeader(next.header)) continue;

    const baseYears = yearTokens(base.header);
    const changeYears = yearTokens(next.header);
    // Both must name exactly one year for there to be a contradiction at all.
    // A change naming none is the ordinary case on this sheet and is resolved
    // from its block; a column naming several is already refused upstream.
    if (baseYears.length !== 1 || changeYears.length !== 1) continue;
    if (baseYears[0] === changeYears[0]) continue;

    flagged.push(base, next);
  }
  return flagged;
}

/** Says which columns were excluded for contradicting themselves, and why. */
export function contradictoryPairWarnings(flagged: HeaderCell[]): ParserWarning[] {
  const warnings: ParserWarning[] = [];
  for (let index = 0; index < flagged.length; index += 2) {
    const base = flagged[index];
    const change = flagged[index + 1];
    if (!base || !change) continue;
    warnings.push({
      code: "unresolved_column",
      message:
        `Columns ${base.letter} ("${base.header}") and ${change.letter} ` +
        `("${change.header}") name different years for one comparison, so which year the ` +
        `figure describes cannot be determined from the sheet. Both were EXCLUDED rather ` +
        `than filed against a guessed year.`,
      column: base.letter,
    });
  }
  return warnings;
}

/**
 * The trailing-window columns, which this sheet carries and this parser does
 * not read.
 *
 * THE SHEET HAS AL..BI, headed identically to the rolling sheet's. They are not
 * ingested, and the reason is measurement rather than caution:
 *
 *   Seven of the eight blocks — revenue at 3, 6 and 9 months, and Total Tans at
 *   3, 6, 9 and 12 — are BYTE-IDENTICAL to the same columns on
 *   `CompReport(MTD)`, across all fifteen salons. They are not year-to-date
 *   figures; they are the same trailing figures printed on a second tab, and
 *   they are already loaded under the month-to-date period.
 *
 *   The eighth, 12-month revenue, differs on all fifteen — by one to two per
 *   cent, with both sheets internally consistent (`AW = AU/AV − 1` on each).
 *   That is not a shifted block: `YTD.AU` matches neither `MTD.AR` nor
 *   `MTD.AS`. So the sheet is not self-consistent about what anchor these
 *   columns use, and there is no reading under which all eight are trustworthy
 *   here.
 *
 * Ingesting them would put the same numbers under a second period and offer a
 * manager "YTD ending Jul 2026 · Last 3 Months" — a combination the source does
 * not compute and the phrase does not describe. The block is reported as
 * excluded, not silently skipped.
 */
export const YTD_EXCLUDED_TRAILING_HEADER = /\blast\s+\d{1,2}\s*(mos?|months?)\b/i;

/**
 * True for any column in the trailing-window block.
 *
 * Every one of the twelve reads "… Last <n> mo/mos/month/months …" — the four
 * revenue triples and the four Total Tans triples alike — and no measure this
 * parser DOES read contains that phrase.
 */
export function isTrailingWindowHeader(header: string): boolean {
  return YTD_EXCLUDED_TRAILING_HEADER.test(header);
}

/** One warning naming the trailing block, so its absence is a decision on the record. */
export function trailingWindowWarnings(headers: HeaderCell[]): ParserWarning[] {
  const columns = headers.filter((cell) => isTrailingWindowHeader(cell.header)).map((c) => c.letter);
  if (columns.length === 0) return [];
  return [
    {
      code: "out_of_band_column",
      message:
        `${columns.length} trailing-window columns (${columns[0]}..${columns[columns.length - 1]}) ` +
        `were EXCLUDED from this year-to-date report. Seven of their eight blocks hold ` +
        `figures identical to the month-to-date sheet's, so they are not year-to-date ` +
        `measures, and the eighth disagrees with that — the sheet is not consistent about ` +
        `what period they cover. They are read from the month-to-date sheet instead.`,
      column: columns[0],
    },
  ];
}
