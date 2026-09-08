import type { SpaEngagementSalonRow } from "./types";

/**
 * ============================================================================
 * SPA ENGAGEMENT ANALYTICS — FOUR FORMULAS, KEPT APART
 * ============================================================================
 *
 * Each formula is one function with the approved name in its own name. There is
 * no shared "engagement ratio" helper taking a divisor flag, because that is
 * precisely the shape in which Spa Per Unique % and Spa Sessions per Unique
 * Tanner per Spa Bed become the same code with a different argument — and then
 * the same label with a different meaning.
 *
 *     spaPerUniquePercent            sessions / unique
 *     spaSessionsPerBed              sessions / beds
 *     spaSessionsPerUniquePerBed     sessions / unique / beds
 *     uniqueSpaTannerPercent         unique spa tanners / unique
 *
 * All four verified against the workbook's own columns for all 248 salons with
 * zero mismatches. The first is Madeline's store-execution measure and the
 * workbook does not carry a column for it; the other three are the source's own
 * and are checked against it.
 *
 * EVERY ONE RETURNS NULL RATHER THAN ZERO on a missing or zero denominator. A
 * salon with no spa beds has no sessions-per-bed figure; reporting 0 would put
 * it at the bottom of a ranking of stores that do have beds.
 */

/** `Spa Sessions / Total Unique Tanners`. A FRACTION: 0.446 is 44.6%. */
export function spaPerUniquePercent(
  spaSessions: number | null | undefined,
  totalUniqueTanners: number | null | undefined,
): number | null {
  return ratio(spaSessions, totalUniqueTanners);
}

/** `Spa Sessions / # of Spa Beds`. */
export function spaSessionsPerBed(
  spaSessions: number | null | undefined,
  spaBeds: number | null | undefined,
): number | null {
  return ratio(spaSessions, spaBeds);
}

/**
 * `Spa Sessions / Total Unique Tanners / # of Spa Beds`.
 *
 * THE BED-NORMALIZED FIGURE, and NOT Spa Per Unique %. For NE Grand Island on
 * 1 September 2026: 33 sessions, 74 unique tanners, 4 beds. This is 0.1115.
 * Spa Per Unique % is 0.446. Labelling this one as that would report a store
 * converting 45% of its customers as converting 11%.
 */
export function spaSessionsPerUniquePerBed(
  spaSessions: number | null | undefined,
  totalUniqueTanners: number | null | undefined,
  spaBeds: number | null | undefined,
): number | null {
  const perUnique = ratio(spaSessions, totalUniqueTanners);
  return ratio(perUnique, spaBeds);
}

/** `Unique Spa Tanners / Total Unique Tanners`. A FRACTION. */
export function uniqueSpaTannerPercent(
  uniqueSpaTanners: number | null | undefined,
  totalUniqueTanners: number | null | undefined,
): number | null {
  return ratio(uniqueSpaTanners, totalUniqueTanners);
}

/** A quotient, or null when it is not defined. Never zero as a stand-in. */
function ratio(
  numerator: number | null | undefined,
  denominator: number | null | undefined,
): number | null {
  if (numerator === null || numerator === undefined) return null;
  if (denominator === null || denominator === undefined) return null;
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) return null;
  if (denominator <= 0) return null;
  return numerator / denominator;
}

/** One salon with all four figures derived. */
export interface SpaEngagementSalonSummary extends SpaEngagementSalonRow {
  readonly spaPerUniquePercent: number | null;
  readonly spaSessionsPerBed: number | null;
  readonly spaSessionsPerUniquePerBed: number | null;
  readonly uniqueSpaTannerPercent: number | null;
}

export function summarizeEngagement(
  salons: readonly SpaEngagementSalonRow[],
): SpaEngagementSalonSummary[] {
  return salons.map((salon) => ({
    ...salon,
    spaPerUniquePercent: spaPerUniquePercent(salon.spaSessions, salon.totalUniqueTanners),
    spaSessionsPerBed: spaSessionsPerBed(salon.spaSessions, salon.spaBeds),
    spaSessionsPerUniquePerBed: spaSessionsPerUniquePerBed(
      salon.spaSessions,
      salon.totalUniqueTanners,
      salon.spaBeds,
    ),
    uniqueSpaTannerPercent: uniqueSpaTannerPercent(
      salon.uniqueSpaTanners,
      salon.totalUniqueTanners,
    ),
  }));
}

/** The KPI figures at the top of the Spa Engagement tab. */
export interface SpaEngagementTotals {
  readonly salonCount: number;
  readonly spaSessions: number | null;
  readonly totalUniqueTanners: number | null;
  readonly uniqueSpaTanners: number | null;
  readonly spaBeds: number | null;
  /** RECOMPUTED from the sums, never averaged across salons. */
  readonly spaPerUniquePercent: number | null;
  readonly uniqueSpaTannerPercent: number | null;
  readonly spaSessionsPerBed: number | null;
  readonly spaSessionsPerUniquePerBed: number | null;
  /** Best chain-wide Overall Rank among the salons in view. */
  readonly bestOverallRank: number | null;
  readonly worstOverallRank: number | null;
}

/**
 * The roll-up across whichever salons are in view.
 *
 * EVERY RATIO IS RECOMPUTED FROM THE SUMS. Averaging fifteen salons' Spa Per
 * Unique % weights a 42-customer salon the same as a 212-customer one; the
 * workbook makes the same distinction itself, publishing both an `All` row of
 * sums and an `All Average` row of per-salon means, and they are different
 * numbers.
 *
 * A CAVEAT ABOUT UNIQUE TANNERS ADDED ACROSS SALONS: a customer who visited two
 * salons is counted in both, so the sum is unique-per-salon rather than unique
 * across the estate. The source has the same property — its own `All` row is
 * the sum of the salon rows — so this matches the report rather than improving
 * on it, and the note travels with the figure wherever it is shown.
 */
export function engagementTotals(
  salons: readonly SpaEngagementSalonSummary[],
): SpaEngagementTotals {
  const sum = (pick: (salon: SpaEngagementSalonSummary) => number | null): number | null => {
    const present = salons
      .map(pick)
      .filter((value): value is number => value !== null && Number.isFinite(value));
    return present.length === 0 ? null : present.reduce((total, value) => total + value, 0);
  };

  const spaSessions = sum((salon) => salon.spaSessions);
  const totalUniqueTanners = sum((salon) => salon.totalUniqueTanners);
  const uniqueSpaTanners = sum((salon) => salon.uniqueSpaTanners);
  const spaBeds = sum((salon) => salon.spaBeds);

  const ranks = salons
    .map((salon) => salon.overallRank)
    .filter((rank): rank is number => rank !== null);

  return {
    salonCount: salons.length,
    spaSessions,
    totalUniqueTanners,
    uniqueSpaTanners,
    spaBeds,
    spaPerUniquePercent: spaPerUniquePercent(spaSessions, totalUniqueTanners),
    uniqueSpaTannerPercent: uniqueSpaTannerPercent(uniqueSpaTanners, totalUniqueTanners),
    spaSessionsPerBed: spaSessionsPerBed(spaSessions, spaBeds),
    spaSessionsPerUniquePerBed: spaSessionsPerUniquePerBed(
      spaSessions,
      totalUniqueTanners,
      spaBeds,
    ),
    bestOverallRank: ranks.length === 0 ? null : Math.min(...ranks),
    worstOverallRank: ranks.length === 0 ? null : Math.max(...ranks),
  };
}

/**
 * The caveat that must travel with any summed Unique Tanners figure.
 *
 * Exported as a constant so the same sentence appears on the KPI card, in the
 * table footnote and in anything the assistant is grounded on.
 */
export const UNIQUE_TANNER_SUM_NOTE =
  "Unique Tanners are unique per salon. A customer who visited two salons is counted in both, so a total across salons is a sum of salon-level uniques rather than a count of distinct people — which is how the source reports it too.";
