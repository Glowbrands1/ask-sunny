import {
  PERFORMANCE_BANDS_BY_ID,
  type PerformanceBand,
} from "@/lib/reporting/performance/classification";

/**
 * Formatting for the Bed Usage and Spa reports.
 *
 * Separate from the Comp Report's and Sales Totals' formatters because the
 * units differ: nothing here is money, and the two kinds of small ratio these
 * reports carry need different precision from each other.
 */

/** `48584` -> `48,584`. Counts are whole things. */
export function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return Number.isInteger(value)
    ? value.toLocaleString("en-US")
    : value.toLocaleString("en-US", { maximumFractionDigits: 1 });
}

/** `170.47` -> `170.5`. Per-bed usage, where one decimal is the useful grain. */
export function formatPerBed(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

/**
 * A PERCENTAGE DIFFERENCE, always signed: `-10.6%`, `+2.1%`, `0.0%`.
 *
 * The sign is not decoration. "10.6%" against a chain benchmark reads as a
 * share; "-10.6%" reads as a shortfall, which is what it is.
 */
export function formatDelta(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "N/A";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toLocaleString("en-US", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}%`;
}

/**
 * A FRACTION rendered as a percentage: `0.13159` -> `13.2%`.
 *
 * Takes a fraction because that is how every rate in these reports is stored —
 * the source writes them that way and the schema keeps them that way, so the
 * conversion happens once, here, at the point of display.
 */
export function formatRate(
  value: number | null | undefined,
  digits = 1,
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "N/A";
  return `${(value * 100).toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}%`;
}

/**
 * A SMALL RATIO, at the precision the workbook publishes it: `0.1115`.
 *
 * Spa Sessions per Unique Tanner per Spa Bed lands between 0.02 and 0.25 across
 * the estate, so two decimals would collapse a third of the range into one
 * value. Four is what the source itself shows.
 */
export function formatSmallRatio(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  });
}

/** `8.25` -> `8.25`. Sessions per bed, where two decimals is the source's own. */
export function formatRatio(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** `7` of `248` -> `7 of 248`. A rank without its population is not a rank. */
export function formatRank(
  rank: number | null | undefined,
  population: number | null | undefined,
): string {
  if (rank === null || rank === undefined) return "—";
  return population ? `${rank} of ${formatCount(population)}` : String(rank);
}

/*
 * `bandTone` USED TO LIVE HERE, mapping a band onto a `Badge` tone — `ready`,
 * `attention`, `failed`. Those are the tones a knowledge document's INGESTION
 * takes, so a spa bed running 25% under the chain read as the same kind of fact
 * as a PDF that failed to index.
 *
 * The current Marquee artifacts give the four bands their own object: a chip
 * with a fill, a glyph and the state in words, shared with the Google Reviews
 * leaderboard so the vocabulary is identical in both places. It lives in
 * `status-chip.tsx`, which still derives the rung from the band's own `tone` so
 * the bands and their colours remain declared once in `classification.ts`.
 */

/** The band's approved label, or a dash. */
export function bandLabel(band: PerformanceBand | null): string {
  return band === null ? "—" : PERFORMANCE_BANDS_BY_ID[band].label;
}
