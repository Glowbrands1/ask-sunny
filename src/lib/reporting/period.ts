import { asText, buildIso } from "./cells";
import { ReportParseError } from "./errors";
import type { ParsedPeriod, ReportPeriodGrain } from "./types";
import { columnLetter, isoDate, normalizeCellText, type SheetView } from "./workbook";

/**
 * PERIOD DETECTION.
 *
 * The audit found the period is carried as FORMATTED TEXT (e.g. the contents of
 * cell F1), not as a numeric Excel date. So the text forms below are the
 * primary path; a genuine date cell is also accepted, because a future template
 * revision fixing the cell type should not break ingestion.
 *
 * Four rules, all of them deliberate:
 *
 *   1. NO FALLBACK TO TODAY. There is no `new Date()` in this module. A report
 *      whose period cannot be read is a report that must not be ingested: the
 *      period is the key everything else hangs off, and a wrong one silently
 *      files August's numbers under September.
 *   2. NO TIMEZONE INFERENCE. Components are parsed as integers and assembled
 *      with `Date.UTC`. Nothing consults the host's zone, so the same workbook
 *      parses identically on a laptop in Phoenix and a container in Ireland.
 *   3. AMBIGUITY IS A FAILURE, NOT A CHOICE. If the header band contains two
 *      markers naming different dates, parsing fails rather than picking one.
 *   4. MALFORMED FAILS LOUDLY. `02/30/2026` is refused, not rolled forward.
 */

/** How a period marker was found, for diagnostics. */
export interface PeriodDetection {
  period: ParsedPeriod;
  /** Cell reference the marker was read from, e.g. "F1". */
  cell: string;
}

const MONTH_NAMES: Record<string, number> = {
  january: 1, jan: 1,
  february: 2, feb: 2,
  march: 3, mar: 3,
  april: 4, apr: 4,
  may: 5,
  june: 6, jun: 6,
  july: 7, jul: 7,
  august: 8, aug: 8,
  september: 9, sep: 9, sept: 9,
  october: 10, oct: 10,
  november: 11, nov: 11,
  december: 12, dec: 12,
};

/** An explicit grain token in the marker text, when it carries one. */
function grainToken(text: string): ReportPeriodGrain | null {
  const compact = text.toLowerCase().replace(/[^a-z]/g, "");
  // "mtd", "m t d", "monthtodate" all collapse to a form containing "mtd" or
  // "monthtodate". Checked before "ytd" so "MTD vs YTD" is not read as YTD.
  if (compact.includes("monthtodate") || /(^|[^a-z])mtd([^a-z]|$)/.test(text.toLowerCase())) {
    return "mtd";
  }
  if (compact.includes("yeartodate") || /(^|[^a-z])ytd([^a-z]|$)/.test(text.toLowerCase())) {
    return "ytd";
  }
  return null;
}

/**
 * The date inside a marker string, or null.
 *
 * Only these forms are accepted. A two-digit year is refused rather than
 * windowed into a century, because guessing 26 -> 2026 is a guess.
 */
export function parseMarkerDate(text: string): string | null {
  const cleaned = normalizeCellText(text);

  // 08/30/2026 or 8-30-2026 — US month-first, matching the source workbook.
  const slashed = /(?:^|[^\d])(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:[^\d]|$)/.exec(cleaned);
  if (slashed) {
    return buildIso(Number(slashed[3]), Number(slashed[1]), Number(slashed[2]));
  }

  // 2026-08-30
  const iso = /(?:^|[^\d])(\d{4})-(\d{2})-(\d{2})(?:[^\d]|$)/.exec(cleaned);
  if (iso) {
    return buildIso(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  }

  // August 30, 2026  /  30 August 2026
  const monthFirst = /\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/.exec(cleaned);
  if (monthFirst) {
    const month = MONTH_NAMES[monthFirst[1].toLowerCase()];
    if (month) return buildIso(Number(monthFirst[3]), month, Number(monthFirst[2]));
  }
  const dayFirst = /\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})\b/.exec(cleaned);
  if (dayFirst) {
    const month = MONTH_NAMES[dayFirst[2].toLowerCase()];
    if (month) return buildIso(Number(dayFirst[3]), month, Number(dayFirst[1]));
  }

  return null;
}

/** First day of `periodEnd`'s month for mtd; 1 January for ytd. */
function startFor(grain: ReportPeriodGrain, periodEnd: string): string {
  const [year, month] = periodEnd.split("-").map(Number);
  return grain === "mtd"
    ? isoDate(new Date(Date.UTC(year, month - 1, 1)))
    : isoDate(new Date(Date.UTC(year, 0, 1)));
}

/**
 * Assembles a period from a marker's text.
 *
 * `expectedGrain` comes from the parser that owns the sheet. A marker carrying
 * an explicit grain that DISAGREES is a failure: `CompReport(MTD)` holding a
 * year-to-date marker means the workbook is not the report we think it is.
 */
export function periodFromMarker(
  text: string,
  expectedGrain: ReportPeriodGrain,
): ParsedPeriod | null {
  const periodEnd = parseMarkerDate(text);
  if (!periodEnd) return null;

  const stated = grainToken(text);
  if (stated && stated !== expectedGrain) {
    throw new ReportParseError(
      "period_unreadable",
      `The reporting period is labelled "${stated.toUpperCase()}" but this parser reads ` +
        `${expectedGrain.toUpperCase()} sheets. Refusing to ingest rather than file the ` +
        `figures under the wrong accumulation window.`,
      { details: [`marker grain: ${stated}`, `parser grain: ${expectedGrain}`] },
    );
  }

  const year = Number(periodEnd.slice(0, 4));
  return {
    grain: expectedGrain,
    periodEnd,
    periodStart: startFor(expectedGrain, periodEnd),
    fiscalYear: year,
    // Verbatim, so a disputed period can be checked without reopening the file.
    labelRaw: normalizeCellText(text),
  };
}

/**
 * Scans the band above the header row for a period marker.
 *
 * The documented location is F1, so it is checked first and wins ties. After
 * that the scan is row-major over a bounded region — bounded so a huge sheet
 * cannot turn detection into a full-sheet crawl, and row-major so the result is
 * deterministic rather than dependent on iteration order.
 *
 * Every marker found is collected. Disagreement fails.
 */
export function detectPeriod(
  sheet: SheetView,
  options: { headerRow: number; expectedGrain: ReportPeriodGrain; preferredCell?: { row: number; column: number } },
): PeriodDetection {
  const { headerRow, expectedGrain } = options;
  const preferred = options.preferredCell ?? { row: 1, column: 6 }; // F1

  const maxColumn = Math.min(sheet.columnCount, 40);
  const found: PeriodDetection[] = [];

  const consider = (row: number, column: number) => {
    const text = asText(sheet.cell(row, column));
    if (text === null) return;
    const period = periodFromMarker(text, expectedGrain);
    if (!period) return;
    const cell = `${columnLetter(column)}${row}`;
    if (found.some((entry) => entry.cell === cell)) return;
    found.push({ period, cell });
  };

  consider(preferred.row, preferred.column);
  for (let row = 1; row < Math.max(headerRow, 2); row += 1) {
    for (let column = 1; column <= maxColumn; column += 1) {
      consider(row, column);
    }
  }

  if (found.length === 0) {
    throw new ReportParseError(
      "period_unreadable",
      "No reporting period could be read from the sheet's header band. The period " +
        "must be stated as a date the parser recognises; ingestion will not " +
        "substitute the current date.",
      { details: [`searched rows 1-${Math.max(headerRow - 1, 1)}, columns A-${columnLetter(maxColumn)}`] },
    );
  }

  const distinct = [...new Set(found.map((entry) => entry.period.periodEnd))];
  if (distinct.length > 1) {
    throw new ReportParseError(
      "period_unreadable",
      "The sheet's header band names more than one reporting period, so the period " +
        "is ambiguous. Refusing to choose one.",
      { details: distinct.map((end, index) => `candidate ${index + 1}: ${end}`) },
    );
  }

  return found[0];
}
