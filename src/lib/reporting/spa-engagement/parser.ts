import { ReportParseError } from "../errors";
import type { DetectionResult } from "../parser";
import { isAuthorizedCompany, storeNameKey } from "../store-identity";
import { isoDate, type SheetView, type WorkbookView } from "../workbook";
import {
  rankAscending,
  rankDescending,
  SPA_ENGAGEMENT_RANK_METRICS,
} from "./metric-map";

/**
 * ============================================================================
 * THE SPA ENGAGEMENT PARSER
 * ============================================================================
 *
 * `Spa Sessions per Unique Tanner per Spa Bed`, delivered chain-wide with a
 * roster, an equipment inventory and a 28-day daily series alongside the
 * ranked summary.
 *
 * THE SHAPE, from the real workbook:
 *
 *     "All Summary"        R1C2 "Spa Sessions per Unique Tanner per Spa Bed:
 *                               9/1 - 9/1"
 *                          R2..R7  Corp / Fran / All, then their averages
 *                          R9      the WEIGHTS, above the three Rank columns
 *                          R10     the salon header
 *                          R11..   one row per salon, with three ranks and an
 *                                  Overall Rank
 *     "All DM Ranking"     the same measures and the same weights, by DM
 *     "Equipment Counts"   one row per store per spa equipment type, with a
 *                          unit count — this is what `# of Spa Beds` sums
 *     "Unique by Day"      28 days x store: unique tanners, unique spa
 *                          tanners, visits, spa visits
 *     "Roster"             THE ONLY PLACE A SALON NUMBER APPEARS in any of the
 *                          three new reports, plus the operating company
 *
 * THE ROSTER IS WHY THIS PARSER CAN SCOPE AT ALL. `All Summary` carries an
 * `Ownership` column holding `Corp` / `Fran` — which is a franchise flag, not a
 * company. So company membership comes from the Roster's `Corp` column, and the
 * canonical salon number from its `SalonNumber` column (zero-padded text:
 * `0468` must never become `468`). The roster is read FIRST and everything
 * afterwards is filtered through it.
 *
 * THE PERIOD NEEDS TWO SOURCES, because the title carries no year: it reads
 * `9/1 - 9/1`. The year is taken from the `Unique by Day` sheet's real date
 * cells, by finding the year in which that sheet's own coverage ends on the
 * title's month and day. If no year matches, or more than one does, the period
 * is UNREADABLE and the delivery is refused — there is no `new Date()` here and
 * no "assume the current year".
 *
 * THE RANKS ARE REPRODUCED, NOT INVENTED. Weights are read from the sheet and
 * the methodology is the workbook's own; see `metric-map.ts` for the derivation
 * and `parser.test.ts` for the proof against all 248 published rows.
 */

export const SPA_ENGAGEMENT_PARSER_KEY = "spa_engagement_unique_tanner";
/** Bump when a change alters the figures this parser produces. */
export const SPA_ENGAGEMENT_PARSER_VERSION = 1;
export const SPA_ENGAGEMENT_FAMILY = "spa_engagement";

export const SPA_ENGAGEMENT_SUMMARY_SHEET = "All Summary";
export const SPA_ENGAGEMENT_DM_SHEET = "All DM Ranking";
export const SPA_ENGAGEMENT_EQUIPMENT_SHEET = "Equipment Counts";
export const SPA_ENGAGEMENT_DAILY_SHEET = "Unique by Day";
export const SPA_ENGAGEMENT_ROSTER_SHEET = "Roster";

const HEADER_SCAN_ROWS = 20;

/** One roster row: the bridge from a store name to a canonical identity. */
export interface ParsedRosterEntry {
  readonly storeName: string;
  /** Zero-padded text, exactly as the roster wrote it. */
  readonly salonNumber: string;
  /** The operating company, from the roster's `Corp` column. */
  readonly company: string;
  readonly ownershipGroup: string | null;
  readonly districtLabel: string | null;
  readonly regionLabel: string | null;
  readonly city: string | null;
  readonly state: string | null;
  /** `Corp` / `Fran`. */
  readonly corpOrFran: string | null;
  readonly openedAt: string | null;
}

/** One salon's engagement row, with the workbook's own published ranks. */
export interface ParsedSpaEngagementSalon {
  readonly storeName: string;
  readonly salonNumber: string | null;
  readonly company: string;
  readonly districtLabel: string | null;
  readonly regionLabel: string | null;
  /** `Corp` / `Fran`, as `All Summary` reports it. */
  readonly ownership: string | null;
  readonly spaSessions: number | null;
  readonly totalUniqueTanners: number | null;
  readonly uniqueSpaTanners: number | null;
  readonly spaBeds: number | null;
  /** The workbook's own value; the parser also recomputes and compares. */
  readonly reportedSpaSessionsPerBed: number | null;
  readonly reportedSpaSessionsPerUniquePerBed: number | null;
  readonly reportedUniqueSpaTannerPct: number | null;
  /** Ranks as the workbook published them, over the whole chain. */
  readonly reportedRanks: Readonly<Record<string, number | null>>;
  readonly reportedOverallRank: number | null;
  /** Ranks this parser recomputed from the chain population. */
  readonly computedRanks: Readonly<Record<string, number | null>>;
  readonly computedWeightedScore: number | null;
  readonly computedOverallRank: number | null;
  readonly sourceRow: number;
}

/** One district manager's ranked row. */
export interface ParsedSpaEngagementManager {
  readonly districtLabel: string;
  readonly regionLabel: string | null;
  readonly spaSessions: number | null;
  readonly totalUniqueTanners: number | null;
  readonly uniqueSpaTanners: number | null;
  readonly spaBeds: number | null;
  readonly reportedOverallRank: number | null;
  readonly computedOverallRank: number | null;
  readonly sourceRow: number;
}

/** One store's installed count of one spa equipment type. */
export interface ParsedSpaBedInventory {
  readonly storeName: string;
  /** The type as the inventory names it, e.g. `SPA Hydromassage 440 G3 (15)`. */
  readonly typeDescription: string;
  readonly units: number;
  readonly category: string | null;
}

/** One store on one day. */
export interface ParsedDailyEngagement {
  readonly storeName: string;
  /** ISO `yyyy-mm-dd`. */
  readonly date: string;
  readonly uniqueTanners: number | null;
  readonly uniqueSpaTanners: number | null;
  readonly totalVisits: number | null;
  readonly spaVisits: number | null;
}

/** The scope rows the source publishes above the salon block. */
export interface ParsedSpaEngagementScope {
  /** `Corp`, `Fran`, `All`, `Corp Average`, ... verbatim. */
  readonly label: string;
  readonly isAverage: boolean;
  readonly spaSessions: number | null;
  readonly totalUniqueTanners: number | null;
  readonly uniqueSpaTanners: number | null;
  readonly spaBeds: number | null;
}

export interface ParsedSpaEngagementReport {
  readonly parserKey: string;
  readonly parserVersion: number;
  readonly reportFamily: string;
  readonly sourceSheetNames: readonly string[];
  readonly company: string;
  readonly period: {
    /** A range opening on the first of its month is month-to-date. */
    readonly grain: "mtd";
    readonly periodStart: string;
    readonly periodEnd: string;
    readonly fiscalYear: number;
    readonly labelRaw: string;
  };
  /** The weights read off the sheet, by rank-metric code. */
  readonly rankWeights: Readonly<Record<string, number>>;
  /** How many salons the chain-wide ranking was computed over. */
  readonly rankPopulation: number;
  readonly salons: readonly ParsedSpaEngagementSalon[];
  readonly managers: readonly ParsedSpaEngagementManager[];
  readonly scopes: readonly ParsedSpaEngagementScope[];
  readonly bedInventory: readonly ParsedSpaBedInventory[];
  readonly dailyEngagement: readonly ParsedDailyEngagement[];
  readonly roster: readonly ParsedRosterEntry[];
  readonly warnings: readonly string[];
  readonly diagnostics: {
    readonly sourceSalonCount: number;
    readonly rosterRowCount: number;
    readonly dailyDateRange: readonly [string, string] | null;
    /** Salons in the summary whose name is absent from the roster. */
    readonly unrosteredSalons: readonly string[];
  };
}

function text(sheet: SheetView, row: number, column: number): string {
  return sheet.cell(row, column).text.replace(/\s+/g, " ").trim();
}

function headerAt(sheet: SheetView, row: number, column: number): string {
  return text(sheet, row, column).toLowerCase();
}

function numberAt(sheet: SheetView, row: number, column: number): number | null {
  if (column <= 0) return null;
  const cell = sheet.cell(row, column);
  return cell.number !== null && Number.isFinite(cell.number) ? cell.number : null;
}

function dateAt(sheet: SheetView, row: number, column: number): string | null {
  if (column <= 0) return null;
  const cell = sheet.cell(row, column);
  if (cell.date) return isoDate(cell.date);
  const raw = cell.text.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

/** The row whose cells carry these headers, and where each one sits. */
function findHeaderRow(
  sheet: SheetView,
  required: readonly string[],
  scanRows = HEADER_SCAN_ROWS,
): { row: number; columns: Map<string, number> } | null {
  const limit = Math.min(scanRows, sheet.rowCount);
  for (let row = 1; row <= limit; row += 1) {
    const columns = new Map<string, number>();
    for (let column = 1; column <= sheet.columnCount; column += 1) {
      const header = headerAt(sheet, row, column);
      if (header.length === 0) continue;
      if (!columns.has(header)) columns.set(header, column);
    }
    if (required.every((header) => columns.has(header))) return { row, columns };
  }
  return null;
}

/**
 * `Spa Sessions per Unique Tanner per Spa Bed: 9/1 - 9/1` -> the month/day pair.
 *
 * NO YEAR IS INVENTED HERE. The title genuinely does not carry one, so this
 * returns month and day components and the caller resolves the year against the
 * daily sheet's real dates.
 */
export function parseEngagementTitleRange(raw: string): {
  startMonth: number;
  startDay: number;
  endMonth: number;
  endDay: number;
  label: string;
} | null {
  const line = raw.replace(/\s+/g, " ").trim();
  const match = /:\s*(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\s*[-–]\s*(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\s*$/.exec(
    line,
  );
  if (!match) return null;
  const startMonth = Number(match[1]);
  const startDay = Number(match[2]);
  const endMonth = Number(match[4]);
  const endDay = Number(match[5]);
  if ([startMonth, endMonth].some((month) => month < 1 || month > 12)) return null;
  if ([startDay, endDay].some((day) => day < 1 || day > 31)) return null;
  return { startMonth, startDay, endMonth, endDay, label: line };
}

/** A real calendar date, or null when the components do not make one. */
function calendarDate(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date.toISOString().slice(0, 10);
}

/** Structural probe. Never throws. */
export function detectSpaEngagement(workbook: WorkbookView): DetectionResult {
  const summary = workbook.sheet(SPA_ENGAGEMENT_SUMMARY_SHEET);
  const titled = workbook.sheetNames.some((name) => {
    const sheet = workbook.sheet(name);
    if (!sheet) return false;
    for (let row = 1; row <= Math.min(3, sheet.rowCount); row += 1) {
      for (let column = 1; column <= Math.min(6, sheet.columnCount); column += 1) {
        if (/spa sessions per unique tanner per spa bed/i.test(text(sheet, row, column))) {
          return true;
        }
      }
    }
    return false;
  });

  if (!titled) {
    return {
      supported: false,
      kind: "unsupported",
      sheetName: null,
      reason: "No sheet carries a `Spa Sessions per Unique Tanner per Spa Bed` heading.",
      markersMissing: ["Spa Sessions per Unique Tanner per Spa Bed heading"],
    };
  }

  const missing: string[] = [];
  if (!summary) {
    missing.push(`${SPA_ENGAGEMENT_SUMMARY_SHEET} sheet`);
  } else {
    const header = findHeaderRow(summary, [
      "salon",
      "spa sessions",
      "total unique tanners",
      "unique spa tanners",
      "# of spa beds",
      "overall rank",
    ]);
    if (!header) missing.push(`${SPA_ENGAGEMENT_SUMMARY_SHEET}: salon header row`);
  }
  if (!workbook.sheet(SPA_ENGAGEMENT_ROSTER_SHEET)) {
    // The roster is not optional: without it nothing can be scoped to a
    // company or given a canonical salon number.
    missing.push(`${SPA_ENGAGEMENT_ROSTER_SHEET} sheet`);
  }

  if (missing.length > 0) {
    return {
      supported: false,
      kind: "template_drift",
      sheetName: summary?.name ?? null,
      reason: `The Spa Engagement report's structure has changed: ${missing.join("; ")}.`,
      markersMissing: missing,
    };
  }

  return {
    supported: true,
    sheetName: SPA_ENGAGEMENT_SUMMARY_SHEET,
    markersMatched: ["Spa Sessions per Unique Tanner per Spa Bed", SPA_ENGAGEMENT_ROSTER_SHEET],
  };
}

/** The roster, keyed on the normalized store name. */
function parseRoster(sheet: SheetView): { entries: ParsedRosterEntry[]; byName: Map<string, ParsedRosterEntry> } {
  const header = findHeaderRow(sheet, ["storelocation", "salonnumber"], 6);
  const entries: ParsedRosterEntry[] = [];
  const byName = new Map<string, ParsedRosterEntry>();
  if (!header) return { entries, byName };

  const at = (name: string) => header.columns.get(name) ?? 0;
  const columns = {
    store: at("storelocation"),
    rm: at("rm"),
    dm: at("dm"),
    // `Corp` is the OPERATING COMPANY ("JB and Associates"); `Corp/Fran` is the
    // franchise flag. Two similarly named columns, entirely different meanings.
    company: at("corp"),
    ownership: at("ownershipgroup"),
    opened: at("dateopened"),
    number: at("salonnumber"),
    city: at("city"),
    state: at("state"),
    corpFran: at("corp/fran"),
  };

  for (let row = header.row + 1; row <= sheet.rowCount; row += 1) {
    const storeName = text(sheet, row, columns.store);
    if (storeName.length === 0) continue;
    /*
     * THE SALON NUMBER STAYS TEXT. `0468` read as a number is `468`, and the
     * next report that reads it correctly creates a second salon for the same
     * store. `cell.text` preserves what the sheet holds; a numeric cell is
     * left-padded back to four digits, which is the width this estate uses.
     */
    const cell = sheet.cell(row, columns.number);
    const salonNumber =
      cell.number !== null && Number.isInteger(cell.number)
        ? String(cell.number).padStart(4, "0")
        : text(sheet, row, columns.number);
    if (salonNumber.length === 0) continue;

    const entry: ParsedRosterEntry = {
      storeName,
      salonNumber,
      company: text(sheet, row, columns.company),
      ownershipGroup: text(sheet, row, columns.ownership) || null,
      districtLabel: text(sheet, row, columns.dm) || null,
      regionLabel: text(sheet, row, columns.rm) || null,
      city: text(sheet, row, columns.city) || null,
      state: text(sheet, row, columns.state) || null,
      corpOrFran: text(sheet, row, columns.corpFran) || null,
      openedAt: dateAt(sheet, row, columns.opened),
    };
    entries.push(entry);
    const key = storeNameKey(storeName);
    // First one wins; a duplicated store name in the roster is an upstream
    // data problem and is reported by the caller rather than resolved here.
    if (!byName.has(key)) byName.set(key, entry);
  }

  return { entries, byName };
}

/**
 * The weights row: the numbers sitting directly above the three Rank columns.
 *
 * Read from the sheet rather than assumed, because the whole point of
 * reproducing the source's ranking is that the source owns the weights. A
 * missing or non-numeric weight is a refusal, not a default of 1/3 — a ranking
 * computed on invented weights would look authoritative and disagree with the
 * report a manager is holding.
 */
function readRankWeights(
  sheet: SheetView,
  headerRow: number,
  rankColumns: readonly { code: string; column: number }[],
): Record<string, number> {
  const weights: Record<string, number> = {};
  const missing: string[] = [];
  for (const entry of rankColumns) {
    const weight = numberAt(sheet, headerRow - 1, entry.column);
    if (weight === null || weight <= 0) {
      missing.push(entry.code);
      continue;
    }
    weights[entry.code] = weight;
  }
  if (missing.length > 0) {
    throw new ReportParseError(
      "template_drift",
      `The ranking weights above the Rank columns could not be read for ${missing.join(", ")}, so the report's own Overall Rank cannot be reproduced.`,
      { details: missing },
    );
  }
  return weights;
}

/**
 * Locates each `Rank` column by the measure column it follows.
 *
 * The header row repeats the literal word `Rank` three times, so it cannot be
 * matched by name. Each Rank column sits immediately to the right of the
 * measure it ranks, which IS a stable structural relationship — and the
 * measure headers are unique.
 */
function resolveRankColumns(
  columns: Map<string, number>,
): { code: string; measureCode: string; column: number }[] {
  return SPA_ENGAGEMENT_RANK_METRICS.map((metric) => {
    const measureColumn = columns.get(metric.sourceHeader) ?? 0;
    return {
      code: metric.code,
      measureCode: metric.measureCode,
      column: measureColumn === 0 ? 0 : measureColumn + 1,
    };
  });
}

/** A row of the ranked salon block, before ranks are recomputed. */
interface RawRankedRow {
  storeName: string;
  ownership: string | null;
  districtLabel: string | null;
  regionLabel: string | null;
  spaSessions: number | null;
  totalUniqueTanners: number | null;
  uniqueSpaTanners: number | null;
  spaBeds: number | null;
  reportedPerBed: number | null;
  reportedPerUniquePerBed: number | null;
  reportedUniquePct: number | null;
  reportedRanks: Record<string, number | null>;
  reportedOverallRank: number | null;
  sourceRow: number;
}

/**
 * Recomputes the three ranks, the weighted score and the Overall Rank.
 *
 * Over the WHOLE population passed in, which is the chain — see the note in
 * `metric-map.ts` about why the ranking population is not narrowed.
 *
 * A row missing one of the three metrics is EXCLUDED FROM THE RANKING rather
 * than ranked last. The workbook excludes the same rows: its footnote reads
 * "Averages only include salons with at least 1 spa bed", and a salon with no
 * spa bed has no bed-normalized figure to rank.
 */
function computeRanks(
  rows: readonly RawRankedRow[],
  weights: Readonly<Record<string, number>>,
): Map<number, { ranks: Record<string, number | null>; score: number | null; overall: number | null }> {
  const metricValues = new Map<string, number[]>();
  const valueOf = (row: RawRankedRow, code: string): number | null => {
    switch (code) {
      case "rank_spa_sessions_per_bed":
        return row.reportedPerBed;
      case "rank_spa_sessions_per_unique_per_bed":
        return row.reportedPerUniquePerBed;
      case "rank_unique_spa_tanner_pct":
        return row.reportedUniquePct;
      default:
        return null;
    }
  };

  for (const metric of SPA_ENGAGEMENT_RANK_METRICS) {
    metricValues.set(
      metric.code,
      rows
        .map((row) => valueOf(row, metric.code))
        .filter((value): value is number => value !== null),
    );
  }

  const scored = new Map<number, { ranks: Record<string, number | null>; score: number | null }>();
  for (const row of rows) {
    const ranks: Record<string, number | null> = {};
    let score: number | null = 0;
    for (const metric of SPA_ENGAGEMENT_RANK_METRICS) {
      const value = valueOf(row, metric.code);
      if (value === null) {
        ranks[metric.code] = null;
        score = null;
        continue;
      }
      const rank = rankDescending(metricValues.get(metric.code)!, value);
      ranks[metric.code] = rank;
      if (score !== null) score += (weights[metric.code] ?? 0) * rank;
    }
    scored.set(row.sourceRow, { ranks, score });
  }

  const scores = [...scored.values()]
    .map((entry) => entry.score)
    .filter((score): score is number => score !== null);

  const out = new Map<
    number,
    { ranks: Record<string, number | null>; score: number | null; overall: number | null }
  >();
  for (const [sourceRow, entry] of scored) {
    out.set(sourceRow, {
      ranks: entry.ranks,
      score: entry.score,
      overall: entry.score === null ? null : rankAscending(scores, entry.score),
    });
  }
  return out;
}

/**
 * Full parse. Throws `ReportParseError` when the report cannot be trusted.
 *
 * `company` defaults to the authorized company; it is a test seam, never a way
 * for a caller to widen the slice.
 */
export function parseSpaEngagement(
  workbook: WorkbookView,
  options: { company?: string } = {},
): ParsedSpaEngagementReport {
  const detection = detectSpaEngagement(workbook);
  if (!detection.supported) {
    throw new ReportParseError(
      detection.kind === "template_drift" ? "template_drift" : "unsupported_workbook",
      detection.reason,
      { details: detection.markersMissing },
    );
  }

  const warnings: string[] = [];
  const sheetNames: string[] = [];
  const wanted = options.company ?? null;
  const keep = (company: string) =>
    wanted === null ? isAuthorizedCompany(company) : company.trim() === wanted.trim();

  // ---------------------------------------------------------------- roster ---
  const rosterSheet = workbook.sheet(SPA_ENGAGEMENT_ROSTER_SHEET)!;
  const roster = parseRoster(rosterSheet);
  if (roster.entries.length === 0) {
    throw new ReportParseError(
      "template_drift",
      `The "${SPA_ENGAGEMENT_ROSTER_SHEET}" sheet produced no rows, so no salon can be given a canonical number or a company.`,
    );
  }
  sheetNames.push(rosterSheet.name);

  /** Store names this delivery says belong to the authorized company. */
  const authorized = new Map<string, ParsedRosterEntry>();
  for (const entry of roster.entries) {
    if (keep(entry.company)) authorized.set(storeNameKey(entry.storeName), entry);
  }
  if (authorized.size === 0) {
    throw new ReportParseError(
      "authorized_company_absent",
      `The roster names ${roster.entries.length} salons and none of them belongs to ${wanted ?? "the authorized company"}.`,
    );
  }

  // --------------------------------------------------------- salon summary ---
  const summary = workbook.sheet(SPA_ENGAGEMENT_SUMMARY_SHEET)!;
  const header = findHeaderRow(summary, [
    "salon",
    "spa sessions",
    "total unique tanners",
    "unique spa tanners",
    "# of spa beds",
    "overall rank",
  ])!;
  sheetNames.push(summary.name);

  const at = (name: string) => header.columns.get(name) ?? 0;
  const columns = {
    salon: at("salon"),
    ownership: at("ownership"),
    dm: at("dm"),
    rm: at("rm"),
    sessions: at("spa sessions"),
    unique: at("total unique tanners"),
    spaUnique: at("unique spa tanners"),
    beds: at("# of spa beds"),
    perBed: at("spa sessions per bed"),
    perUniquePerBed: at("spa sessions per unique tanner per spa bed"),
    uniquePct: at("unique spa tanner % of total unique"),
    overallRank: at("overall rank"),
  };

  const rankColumns = resolveRankColumns(header.columns);
  const unresolvedRank = rankColumns.filter((entry) => entry.column === 0);
  if (unresolvedRank.length > 0) {
    throw new ReportParseError(
      "template_drift",
      `The Rank columns could not be located because their measure columns are absent: ${unresolvedRank.map((entry) => entry.measureCode).join(", ")}.`,
    );
  }
  const rankWeights = readRankWeights(summary, header.row, rankColumns);

  // ---------------------------------------------------------------- period ---
  let titleRange: ReturnType<typeof parseEngagementTitleRange> = null;
  for (let row = 1; row < header.row && titleRange === null; row += 1) {
    for (let column = 1; column <= Math.min(6, summary.columnCount); column += 1) {
      const candidate = parseEngagementTitleRange(text(summary, row, column));
      if (candidate) {
        titleRange = candidate;
        break;
      }
    }
  }
  if (!titleRange) {
    throw new ReportParseError(
      "period_unreadable",
      `The "${SPA_ENGAGEMENT_SUMMARY_SHEET}" sheet carries no "<title>: M/D - M/D" period heading.`,
    );
  }

  // --------------------------------------------------------- daily series ---
  const dailySheet = workbook.sheet(SPA_ENGAGEMENT_DAILY_SHEET);
  const dailyEngagement: ParsedDailyEngagement[] = [];
  let dailyRange: [string, string] | null = null;
  if (dailySheet) {
    const dailyHeader = findHeaderRow(dailySheet, ["date", "storelocation", "uniquetanners"], 4);
    if (!dailyHeader) {
      warnings.push(
        `The "${SPA_ENGAGEMENT_DAILY_SHEET}" sheet's header could not be located, so the daily series was not ingested.`,
      );
    } else {
      const dailyAt = (name: string) => dailyHeader.columns.get(name) ?? 0;
      const dailyColumns = {
        date: dailyAt("date"),
        store: dailyAt("storelocation"),
        unique: dailyAt("uniquetanners"),
        spaUnique: dailyAt("uniquespatanners"),
        visits: dailyAt("totalvisits"),
        spaVisits: dailyAt("spavisits"),
      };
      let earliest: string | null = null;
      let latest: string | null = null;
      for (let row = dailyHeader.row + 1; row <= dailySheet.rowCount; row += 1) {
        const date = dateAt(dailySheet, row, dailyColumns.date);
        if (!date) continue;
        if (earliest === null || date < earliest) earliest = date;
        if (latest === null || date > latest) latest = date;

        const storeName = text(dailySheet, row, dailyColumns.store);
        // `Corp` and `Fran` appear as pseudo-stores in this sheet; they are
        // roll-ups, not salons, and are excluded by the roster lookup below.
        const entry = authorized.get(storeNameKey(storeName));
        if (!entry) continue;
        dailyEngagement.push({
          storeName: entry.storeName,
          date,
          uniqueTanners: numberAt(dailySheet, row, dailyColumns.unique),
          uniqueSpaTanners: numberAt(dailySheet, row, dailyColumns.spaUnique),
          totalVisits: numberAt(dailySheet, row, dailyColumns.visits),
          spaVisits: numberAt(dailySheet, row, dailyColumns.spaVisits),
        });
      }
      if (earliest && latest) dailyRange = [earliest, latest];
      sheetNames.push(dailySheet.name);
    }
  } else {
    warnings.push(
      `The "${SPA_ENGAGEMENT_DAILY_SHEET}" sheet is absent, so the period's year must come from another source.`,
    );
  }

  /*
   * THE YEAR. The title says `9/1 - 9/1` and carries none, so it comes from the
   * daily sheet's real date cells: the year in which that sheet's coverage ENDS
   * on the title's end month and day. One candidate is an answer; none or
   * several is a refusal.
   */
  const candidateYears = new Set<number>();
  if (dailyRange) {
    for (const bound of dailyRange) candidateYears.add(Number(bound.slice(0, 4)));
  }
  const resolved: { start: string; end: string }[] = [];
  for (const year of candidateYears) {
    const end = calendarDate(year, titleRange.endMonth, titleRange.endDay);
    if (!end || (dailyRange && end !== dailyRange[1])) continue;
    // A range that opens in the previous calendar year (a December-to-January
    // window) is expressed by stepping the start year back, never by assuming.
    const sameYearStart = calendarDate(year, titleRange.startMonth, titleRange.startDay);
    const start =
      sameYearStart && sameYearStart <= end
        ? sameYearStart
        : calendarDate(year - 1, titleRange.startMonth, titleRange.startDay);
    if (!start || start > end) continue;
    resolved.push({ start, end });
  }

  if (resolved.length !== 1) {
    throw new ReportParseError(
      "period_unreadable",
      `The report heading "${titleRange.label}" carries no year, and the "${SPA_ENGAGEMENT_DAILY_SHEET}" sheet does not identify exactly one year whose coverage ends on ${titleRange.endMonth}/${titleRange.endDay}. The period cannot be determined and nothing was ingested.`,
      { details: [...candidateYears].map(String) },
    );
  }
  const period = resolved[0];

  // ------------------------------------------------------------ scope rows ---
  const scopes: ParsedSpaEngagementScope[] = [];
  {
    /*
     * The scope block sits above the weights row and labels itself in the
     * column just left of `Spa Sessions`. Read for provenance, and NEVER used
     * to derive a salon figure: `Corp`, `Fran` and `All` cover the whole chain
     * and the average rows are averages over it.
     */
    const labelColumn = Math.max(1, columns.sessions - 1);
    for (let row = 1; row < header.row - 1; row += 1) {
      const label = text(summary, row, labelColumn);
      if (label.length === 0) continue;
      const sessions = numberAt(summary, row, columns.sessions);
      if (sessions === null) continue;
      scopes.push({
        label,
        isAverage: /average/i.test(label),
        spaSessions: sessions,
        totalUniqueTanners: numberAt(summary, row, columns.unique),
        uniqueSpaTanners: numberAt(summary, row, columns.spaUnique),
        spaBeds: numberAt(summary, row, columns.beds),
      });
    }
  }

  // ------------------------------------------------------------ salon rows ---
  const raw: RawRankedRow[] = [];
  const unrostered: string[] = [];
  for (let row = header.row + 1; row <= summary.rowCount; row += 1) {
    const storeName = text(summary, row, columns.salon);
    if (storeName.length === 0) continue;

    const reportedRanks: Record<string, number | null> = {};
    for (const entry of rankColumns) {
      reportedRanks[entry.code] = numberAt(summary, row, entry.column);
    }

    raw.push({
      storeName,
      ownership: text(summary, row, columns.ownership) || null,
      districtLabel: text(summary, row, columns.dm) || null,
      regionLabel: text(summary, row, columns.rm) || null,
      spaSessions: numberAt(summary, row, columns.sessions),
      totalUniqueTanners: numberAt(summary, row, columns.unique),
      uniqueSpaTanners: numberAt(summary, row, columns.spaUnique),
      spaBeds: numberAt(summary, row, columns.beds),
      reportedPerBed: numberAt(summary, row, columns.perBed),
      reportedPerUniquePerBed: numberAt(summary, row, columns.perUniquePerBed),
      reportedUniquePct: numberAt(summary, row, columns.uniquePct),
      reportedRanks,
      reportedOverallRank: numberAt(summary, row, columns.overallRank),
      sourceRow: row,
    });

    if (!roster.byName.has(storeNameKey(storeName))) unrostered.push(storeName);
  }

  if (raw.length === 0) {
    throw new ReportParseError(
      "no_data_rows",
      `The "${SPA_ENGAGEMENT_SUMMARY_SHEET}" sheet's salon block contained no rows.`,
    );
  }

  const computed = computeRanks(raw, rankWeights);

  const salons: ParsedSpaEngagementSalon[] = [];
  for (const row of raw) {
    const rosterEntry = authorized.get(storeNameKey(row.storeName));
    // THE COMPANY GATE, after the ranking. Rank is a chain-wide fact and has to
    // be computed over the chain; only our own rows are kept.
    if (!rosterEntry) continue;
    const ranks = computed.get(row.sourceRow)!;
    salons.push({
      storeName: rosterEntry.storeName,
      salonNumber: rosterEntry.salonNumber,
      company: rosterEntry.company,
      // The summary's DM/RM for the period; the roster's are current state.
      districtLabel: row.districtLabel ?? rosterEntry.districtLabel,
      regionLabel: row.regionLabel ?? rosterEntry.regionLabel,
      ownership: row.ownership,
      spaSessions: row.spaSessions,
      totalUniqueTanners: row.totalUniqueTanners,
      uniqueSpaTanners: row.uniqueSpaTanners,
      spaBeds: row.spaBeds,
      reportedSpaSessionsPerBed: row.reportedPerBed,
      reportedSpaSessionsPerUniquePerBed: row.reportedPerUniquePerBed,
      reportedUniqueSpaTannerPct: row.reportedUniquePct,
      reportedRanks: row.reportedRanks,
      reportedOverallRank: row.reportedOverallRank,
      computedRanks: ranks.ranks,
      computedWeightedScore: ranks.score,
      computedOverallRank: ranks.overall,
      sourceRow: row.sourceRow,
    });
  }

  if (salons.length === 0) {
    throw new ReportParseError(
      "authorized_company_absent",
      `The summary lists ${raw.length} salons and none of them is one of ${wanted ?? "the authorized company"}'s ${authorized.size} rostered salons.`,
    );
  }

  // ------------------------------------------------------------ DM ranking ---
  const managers = parseManagers(workbook, authorized, rankWeights, warnings, sheetNames);

  // --------------------------------------------------------- bed inventory ---
  const bedInventory = parseBedInventory(workbook, authorized, warnings, sheetNames);

  return {
    parserKey: SPA_ENGAGEMENT_PARSER_KEY,
    parserVersion: SPA_ENGAGEMENT_PARSER_VERSION,
    reportFamily: SPA_ENGAGEMENT_FAMILY,
    sourceSheetNames: sheetNames,
    company: wanted ?? salons[0].company,
    period: {
      grain: "mtd",
      periodStart: period.start,
      periodEnd: period.end,
      fiscalYear: Number(period.end.slice(0, 4)),
      labelRaw: titleRange.label,
    },
    rankWeights,
    rankPopulation: raw.length,
    salons,
    managers,
    scopes,
    bedInventory,
    dailyEngagement,
    roster: [...authorized.values()],
    warnings,
    diagnostics: {
      sourceSalonCount: raw.length,
      rosterRowCount: roster.entries.length,
      dailyDateRange: dailyRange,
      unrosteredSalons: [...new Set(unrostered)],
    },
  };
}

/**
 * The DM ranking sheet, kept for the authorized company's district managers.
 *
 * DISTRICTS ARE MANAGER NAMES IN THIS SOURCE, so a district is matched by the
 * name appearing on one of our salons rather than by any code. A manager who
 * runs salons for two companies would appear for both, which is correct: their
 * rank is a chain-wide fact about them.
 */
function parseManagers(
  workbook: WorkbookView,
  authorized: ReadonlyMap<string, ParsedRosterEntry>,
  weights: Readonly<Record<string, number>>,
  warnings: string[],
  sheetNames: string[],
): ParsedSpaEngagementManager[] {
  const sheet = workbook.sheet(SPA_ENGAGEMENT_DM_SHEET);
  if (!sheet) {
    warnings.push(
      `The "${SPA_ENGAGEMENT_DM_SHEET}" sheet is absent, so district-level ranking was not ingested.`,
    );
    return [];
  }
  const header = findHeaderRow(sheet, ["dm", "spa sessions", "# of spa beds", "overall rank"]);
  if (!header) {
    warnings.push(
      `The "${SPA_ENGAGEMENT_DM_SHEET}" sheet's header could not be located, so district-level ranking was not ingested.`,
    );
    return [];
  }
  sheetNames.push(sheet.name);

  const at = (name: string) => header.columns.get(name) ?? 0;
  const columns = {
    dm: at("dm"),
    rm: at("rm"),
    sessions: at("spa sessions"),
    unique: at("total unique tanners"),
    spaUnique: at("unique spa tanners"),
    beds: at("# of spa beds"),
    perBed: at("spa sessions per bed"),
    perUniquePerBed: at("spa sessions per unique tanner per spa bed"),
    uniquePct: at("unique spa tanner % of total unique"),
    overallRank: at("overall rank"),
  };

  const ours = new Set(
    [...authorized.values()]
      .map((entry) => (entry.districtLabel ?? "").toLowerCase())
      .filter((label) => label.length > 0),
  );

  const raw: RawRankedRow[] = [];
  for (let row = header.row + 1; row <= sheet.rowCount; row += 1) {
    const dm = text(sheet, row, columns.dm);
    if (dm.length === 0) continue;
    raw.push({
      storeName: dm,
      ownership: null,
      districtLabel: dm,
      regionLabel: text(sheet, row, columns.rm) || null,
      spaSessions: numberAt(sheet, row, columns.sessions),
      totalUniqueTanners: numberAt(sheet, row, columns.unique),
      uniqueSpaTanners: numberAt(sheet, row, columns.spaUnique),
      spaBeds: numberAt(sheet, row, columns.beds),
      reportedPerBed: numberAt(sheet, row, columns.perBed),
      reportedPerUniquePerBed: numberAt(sheet, row, columns.perUniquePerBed),
      reportedUniquePct: numberAt(sheet, row, columns.uniquePct),
      reportedRanks: {},
      reportedOverallRank: numberAt(sheet, row, columns.overallRank),
      sourceRow: row,
    });
  }

  const computed = computeRanks(raw, weights);
  return raw
    .filter((row) => ours.has((row.districtLabel ?? "").toLowerCase()))
    .map((row) => ({
      districtLabel: row.districtLabel!,
      regionLabel: row.regionLabel,
      spaSessions: row.spaSessions,
      totalUniqueTanners: row.totalUniqueTanners,
      uniqueSpaTanners: row.uniqueSpaTanners,
      spaBeds: row.spaBeds,
      reportedOverallRank: row.reportedOverallRank,
      computedOverallRank: computed.get(row.sourceRow)?.overall ?? null,
      sourceRow: row.sourceRow,
    }));
}

/** The equipment inventory, for the authorized company's stores only. */
function parseBedInventory(
  workbook: WorkbookView,
  authorized: ReadonlyMap<string, ParsedRosterEntry>,
  warnings: string[],
  sheetNames: string[],
): ParsedSpaBedInventory[] {
  const sheet = workbook.sheet(SPA_ENGAGEMENT_EQUIPMENT_SHEET);
  if (!sheet) {
    warnings.push(
      `The "${SPA_ENGAGEMENT_EQUIPMENT_SHEET}" sheet is absent, so the spa bed inventory was not ingested.`,
    );
    return [];
  }
  const header = findHeaderRow(sheet, ["storelocation", "typedescription", "equipmentcount"], 4);
  if (!header) {
    warnings.push(
      `The "${SPA_ENGAGEMENT_EQUIPMENT_SHEET}" sheet's header could not be located, so the spa bed inventory was not ingested.`,
    );
    return [];
  }
  sheetNames.push(sheet.name);

  const at = (name: string) => header.columns.get(name) ?? 0;
  const inventory: ParsedSpaBedInventory[] = [];
  for (let row = header.row + 1; row <= sheet.rowCount; row += 1) {
    const storeName = text(sheet, row, at("storelocation"));
    if (storeName.length === 0) continue;
    const entry = authorized.get(storeNameKey(storeName));
    if (!entry) continue;
    const units = numberAt(sheet, row, at("equipmentcount"));
    if (units === null || units <= 0) continue;
    inventory.push({
      storeName: entry.storeName,
      typeDescription: text(sheet, row, at("typedescription")),
      units,
      category: text(sheet, row, at("category")) || null,
    });
  }
  return inventory;
}
