import type { CellValue } from "./workbook";
import { isoDate, normalizeCellText } from "./workbook";

/**
 * COERCION RULES, IN ONE PLACE.
 *
 * The governing principle: a cell either yields a value the parser is confident
 * about, or it yields `null`. Nothing here substitutes a default. A missing
 * figure must stay missing all the way to the database, because the schema
 * distinguishes an absent row from a genuine zero and a fabricated zero would
 * destroy that distinction.
 */

/**
 * Placeholder texts that mean "no value" in this source.
 *
 * The real workbook writes `n/a` into descriptor cells that do not apply — a
 * salon with no spa equipment has `n/a` for its install date and pricing plan.
 * Carrying that string through would put the literal text "n/a" in a database
 * column whose emptiness is meaningful, so it is normalised to null here rather
 * than in each caller. Excel error strings are included for the same reason.
 */
const NULL_PLACEHOLDERS = new Set([
  "n/a",
  "na",
  "none",
  "null",
  "-",
  "\u2013",
  "\u2014",
  "#n/a",
  "#div/0!",
  "#ref!",
  "#value!",
  "#name?",
]);

/**
 * True when a cell explicitly states "no value" rather than being empty.
 *
 * The distinction matters for measures: the audited workbook writes `n/a` into
 * the spa %-change column for the eight salons with no spa equipment. That is a
 * deliberate statement that the measure does not apply — the same fact as an
 * empty cell — so it must not be reported as a malformed number. Reporting it
 * as corruption would bury real parse failures under routine non-events.
 */
export function isNullPlaceholder(cell: CellValue): boolean {
  if (cell.kind !== "text") return false;
  return NULL_PLACEHOLDERS.has(normalizeCellText(cell.text).toLowerCase());
}

/** Text, or null when the cell is empty or holds a "no value" placeholder. */
export function asText(cell: CellValue): string | null {
  if (cell.kind === "empty" || cell.kind === "error") return null;
  const text = normalizeCellText(cell.text);
  if (text.length === 0) return null;
  if (NULL_PLACEHOLDERS.has(text.toLowerCase())) return null;
  return text;
}

/**
 * A number, or null.
 *
 * A numeric cell is used as-is. A TEXT cell is parsed only when it is
 * unambiguously a formatted number — currency symbols, thousands separators,
 * accounting parentheses for negatives, a trailing percent sign. Anything else
 * (a dash placeholder, "N/A", a note) yields null rather than a guess.
 *
 * A trailing `%` divides by 100, so text and numeric percentage cells both
 * arrive as the FRACTION the schema stores.
 */
export function asNumber(cell: CellValue): number | null {
  if (cell.kind === "number") return cell.number;
  if (cell.kind !== "text") return null;

  let text = cell.text.trim();
  if (text.length === 0) return null;

  // A lone dash (or en/em dash) is Excel's common "nothing here" placeholder.
  if (/^[-–—]$/.test(text)) return null;

  let negative = false;
  // Accounting negatives: (1,234.56)
  const parenthesised = /^\((.*)\)$/.exec(text);
  if (parenthesised) {
    negative = true;
    text = parenthesised[1].trim();
  }

  let percent = false;
  if (text.endsWith("%")) {
    percent = true;
    text = text.slice(0, -1).trim();
  }

  // Strip a leading currency symbol and thousands separators. Deliberately a
  // narrow set: anything unusual should fail rather than be reinterpreted.
  text = text.replace(/^[$£€]\s?/, "").replace(/,/g, "");

  if (text.startsWith("-")) {
    negative = true;
    text = text.slice(1).trim();
  } else if (text.startsWith("+")) {
    text = text.slice(1).trim();
  }

  if (!/^\d+(\.\d+)?$/.test(text)) return null;

  let value = Number(text);
  if (!Number.isFinite(value)) return null;
  if (percent) value /= 100;
  if (negative) value = -value;
  return value;
}

/**
 * True/false, or null.
 *
 * Comp-salon flags appear as Y/N, Yes/No, TRUE/FALSE or 1/0 depending on who
 * exported the sheet. Anything outside that set is null — an unrecognised flag
 * is not a false.
 */
export function asBoolean(cell: CellValue): boolean | null {
  if (cell.kind === "boolean") return cell.text === "TRUE";
  if (cell.kind === "number") {
    if (cell.number === 1) return true;
    if (cell.number === 0) return false;
    return null;
  }
  const text = asText(cell);
  if (text === null) return null;
  switch (text.toLowerCase()) {
    case "y":
    case "yes":
    case "true":
    case "t":
    case "comp":
      return true;
    case "n":
    case "no":
    case "false":
    case "f":
    case "non-comp":
    case "noncomp":
      return false;
    default:
      return null;
  }
}

/**
 * ISO `yyyy-mm-dd`, or null.
 *
 * A real date cell is read in UTC. A text date is accepted only in the
 * unambiguous forms below; notably `MM/DD/YYYY` is assumed for slashed dates
 * because the source is a US workbook, and a two-digit year is REFUSED rather
 * than windowed into a century.
 */
export function asDateIso(cell: CellValue): string | null {
  if (cell.kind === "date" && cell.date) return isoDate(cell.date);
  const text = asText(cell);
  if (text === null) return null;

  const slashed = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(text);
  if (slashed) {
    return buildIso(Number(slashed[3]), Number(slashed[1]), Number(slashed[2]));
  }

  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (iso) {
    return buildIso(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  }

  return null;
}

/**
 * Builds an ISO date, returning null unless the components are a real calendar
 * date. Round-tripping through `Date.UTC` is what rejects 02/30: JavaScript
 * would silently roll it forward to March 2, and a rolled-forward date is a
 * wrong date rather than a missing one.
 */
export function buildIso(year: number, month: number, day: number): string | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const stamp = Date.UTC(year, month - 1, day);
  const date = new Date(stamp);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return isoDate(date);
}

/**
 * The comparison form for header matching: lowercase, punctuation that varies
 * between template revisions removed, whitespace collapsed.
 *
 * `.` and `:` go because "TY vs. 2024" and "TY vs 2024" are the same header,
 * and "Ref: UID" and "Ref UID" likewise. `%`, `#`, `$`, `/` and `-` are KEPT
 * because they carry meaning: "% Change" is not "Change".
 */
export function normalizeHeader(header: string): string {
  return normalizeCellText(header)
    .toLowerCase()
    .replace(/[.:;,'"()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Every 4-digit year token in a header, in order of appearance. */
export function yearTokens(header: string): number[] {
  const matches = normalizeCellText(header).match(/\b(19|20)\d{2}\b/g);
  if (!matches) return [];
  return matches.map(Number);
}

/** Removes year tokens so a header can be matched against a year-free alias. */
export function stripYearTokens(header: string): string {
  return normalizeHeader(header).replace(/\b(19|20)\d{2}\b/g, " ").replace(/\s+/g, " ").trim();
}
