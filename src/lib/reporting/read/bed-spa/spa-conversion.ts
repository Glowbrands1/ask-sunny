import type { BedSpaPeriod } from "./types";

/**
 * ============================================================================
 * SPA CONVERSION RATE — AND THE FIVE REASONS IT MUST REFUSE TO ANSWER
 * ============================================================================
 *
 *     Spa Conversion Rate = Monthly Spa Sessions / Monthly Total Tans
 *
 * The metric the whole combined report exists for. Raw spa sessions favour
 * whichever salon has the most customers; dividing by traffic separates
 * EXECUTION from FOOTFALL, which is what turns "MO Kansas City Liberty took the
 * most spa sessions" into "and NE Grand Island converts half again as well".
 *
 * It joins two different reports, and that is the whole risk. Nothing else in
 * this codebase divides one delivery's numerator by another delivery's
 * denominator, and every failure mode of doing so produces a NUMBER rather than
 * an error — a plausible percentage that is quietly meaningless. So this module
 * is written as a decision function that returns either a rate or a REASON, and
 * the reason is shown to the reader:
 *
 *   PERIOD MISMATCH. August spa sessions over September traffic is not a
 *   conversion rate. The two source reports genuinely disagree in the supplied
 *   material — the bed usage report covers 1-31 August and the spa engagement
 *   report covers 1 September — so this is the live case, not a hypothetical.
 *   Both the grain AND the dates must match: month-to-date through 31 August
 *   and year-to-date through 31 August end on the same day and cover eight
 *   times the traffic.
 *
 *   UNRESOLVED SALON. A spa row whose store name could not be matched to a
 *   canonical salon has no traffic figure it can honestly be paired with. See
 *   `store-identity.ts`: the alternative is a fuzzy match, and `KS Lawrence`
 *   and `KS Lawrenceburg` are two real salons eight characters apart.
 *
 *   MISSING TRAFFIC. The salon appears in the spa report and not in the bed
 *   usage report, or its `Salon Tans` was blank. A missing denominator is not
 *   a denominator of zero and it is not a denominator of one.
 *
 *   ZERO TRAFFIC. A closed or newly opened salon. Division by zero is an
 *   infinity, and an infinity rendered as a percentage is `Infinity%` or, worse,
 *   silently clamped to something plausible.
 *
 *   MISSING SESSIONS. No spa figure to convert.
 *
 * `N/A` PLUS THE REASON, never a blank and never a zero. A blank cell reads as
 * "nobody has looked"; a zero reads as "this salon converts nothing", which is
 * a finding somebody would act on.
 */

/** Why a conversion rate could not be computed. */
export type ConversionUnavailableReason =
  | "period_mismatch"
  | "salon_unresolved"
  | "traffic_missing"
  | "traffic_zero"
  | "sessions_missing";

/** One sentence per reason, in the words a manager should read. */
export const CONVERSION_REASON_TEXT: Readonly<Record<ConversionUnavailableReason, string>> = {
  period_mismatch:
    "The Bed Usage and Spa reports loaded for this view cover different periods, so their figures cannot be divided.",
  salon_unresolved:
    "This salon's name could not be matched to a known salon, so its spa sessions and its tanning traffic cannot be paired.",
  traffic_missing: "No Total Tans was reported for this salon in the matching Bed Usage period.",
  traffic_zero:
    "This salon reported no tanning traffic in the matching Bed Usage period, so there is nothing to convert.",
  sessions_missing: "No spa sessions were reported for this salon in this period.",
};

export type SpaConversion =
  | {
      readonly available: true;
      /** A FRACTION. 0.1868 is 18.68%. */
      readonly rate: number;
      readonly spaSessions: number;
      readonly totalTans: number;
    }
  | {
      readonly available: false;
      readonly reason: ConversionUnavailableReason;
      readonly reasonText: string;
      /** Whichever side was known, for a table that still shows the parts. */
      readonly spaSessions: number | null;
      readonly totalTans: number | null;
    };

/**
 * Whether two periods may be divided by one another.
 *
 * BOTH the grain and the two dates. `mtd` through 31 August and `ytd` through
 * 31 August share a `periodEnd` and cover eight times the traffic, so a
 * date-only check passes exactly the comparison that is most wrong.
 */
export function periodsMatch(
  a: BedSpaPeriod | null | undefined,
  b: BedSpaPeriod | null | undefined,
): boolean {
  if (!a || !b) return false;
  return a.grain === b.grain && a.periodStart === b.periodStart && a.periodEnd === b.periodEnd;
}

/** A short, honest description of a period pair that does not match. */
export function describePeriodMismatch(
  traffic: BedSpaPeriod | null | undefined,
  spa: BedSpaPeriod | null | undefined,
): string {
  const label = (period: BedSpaPeriod | null | undefined) =>
    period ? `${period.grain.toUpperCase()} ${period.periodStart} to ${period.periodEnd}` : "none loaded";
  return `Bed Usage covers ${label(traffic)}; the Spa report covers ${label(spa)}.`;
}

export interface SpaConversionInput {
  /** Null when the salon's name could not be matched to a canonical salon. */
  readonly salonNumber: string | null;
  readonly spaSessions: number | null;
  readonly totalTans: number | null;
  readonly trafficPeriod: BedSpaPeriod | null;
  readonly spaPeriod: BedSpaPeriod | null;
}

/**
 * The rate, or the reason there isn't one.
 *
 * THE ORDER OF THE CHECKS IS THE POINT. The period check runs FIRST and applies
 * to the whole view: a conversion computed across mismatched periods is wrong
 * for every salon, so no per-salon detail could rescue it and reporting a
 * per-salon reason would hide a view-level problem behind fifteen small ones.
 * Identity comes next, because a figure attached to the wrong salon is worse
 * than a missing one. Only then are the two figures themselves examined.
 */
export function computeSpaConversion(input: SpaConversionInput): SpaConversion {
  const unavailable = (reason: ConversionUnavailableReason): SpaConversion => ({
    available: false,
    reason,
    reasonText: CONVERSION_REASON_TEXT[reason],
    spaSessions: input.spaSessions,
    totalTans: input.totalTans,
  });

  if (!periodsMatch(input.trafficPeriod, input.spaPeriod)) return unavailable("period_mismatch");
  if (input.salonNumber === null) return unavailable("salon_unresolved");
  if (input.spaSessions === null) return unavailable("sessions_missing");
  if (input.totalTans === null) return unavailable("traffic_missing");
  if (input.totalTans === 0) return unavailable("traffic_zero");
  // A negative denominator cannot come from a well-formed report; treated as
  // missing rather than producing a negative conversion rate.
  if (input.totalTans < 0) return unavailable("traffic_missing");

  return {
    available: true,
    rate: input.spaSessions / input.totalTans,
    spaSessions: input.spaSessions,
    totalTans: input.totalTans,
  };
}

/**
 * The conversion rate across a set of salons.
 *
 * SUMS THE PARTS AND DIVIDES ONCE. Averaging fifteen salons' conversion rates
 * weights a 1,451-tan salon the same as a 7,375-tan one and answers a question
 * nobody asked. Only salons whose own rate is available contribute, so an
 * unmatched salon cannot silently shrink the numerator while its traffic
 * inflates the denominator.
 */
export function aggregateSpaConversion(
  conversions: readonly SpaConversion[],
): SpaConversion {
  const usable = conversions.filter(
    (conversion): conversion is Extract<SpaConversion, { available: true }> =>
      conversion.available,
  );

  if (usable.length === 0) {
    // The commonest reason among the refusals, so the banner can say something
    // specific rather than "no data".
    const counts = new Map<ConversionUnavailableReason, number>();
    for (const conversion of conversions) {
      if (conversion.available) continue;
      counts.set(conversion.reason, (counts.get(conversion.reason) ?? 0) + 1);
    }
    const [reason] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? [
      "sessions_missing" as ConversionUnavailableReason,
    ];
    return {
      available: false,
      reason,
      reasonText: CONVERSION_REASON_TEXT[reason],
      spaSessions: null,
      totalTans: null,
    };
  }

  const spaSessions = usable.reduce((total, conversion) => total + conversion.spaSessions, 0);
  const totalTans = usable.reduce((total, conversion) => total + conversion.totalTans, 0);
  if (totalTans === 0) {
    return {
      available: false,
      reason: "traffic_zero",
      reasonText: CONVERSION_REASON_TEXT.traffic_zero,
      spaSessions,
      totalTans,
    };
  }
  return { available: true, rate: spaSessions / totalTans, spaSessions, totalTans };
}
