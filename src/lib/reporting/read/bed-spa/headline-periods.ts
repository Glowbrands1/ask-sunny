import type { BedSpaPeriod } from "./types";
import { periodLabel, spaEngagementPeriodLabel } from "./period-token";

/**
 * ============================================================================
 * THE SPA ENGAGEMENT HEADLINE ROW NAMES ITS PERIODS (QA, 24 Nov 2026)
 * ============================================================================
 *
 * The headline Spa Conversion Rate joins Bed Usage traffic and SPA Wellness sessions, so it is computed for the
 * newest period those two both cover (`newestSharedPeriod`), on purpose: keyed to this report's own period it would be
 * N/A forever. The Spa Sessions, Unique Spa Tanner % and Spa Per Unique % cards beside it are this report's own
 * period. QA saw "3,504 sessions through Sep 17" beside August conversion figures, in one row that read as one period.
 *
 * Keeping the page's intent (each figure for the window it can honestly be computed for, "says which one that is"),
 * every card now names its period, and when the two differ the row says so before the first figure.
 */
export interface SpaHeadlinePeriods {
  /** This report's period, for the Spa Sessions and reach / frequency cards. */
  readonly engagement: string;
  /** The conversion rate's period, or null when no shared period exists (the card says why). */
  readonly conversion: string | null;
  /** True when the row holds figures from two different windows. */
  readonly mixed: boolean;
  /** The sentence over the row when it is mixed; null otherwise. */
  readonly notice: string | null;
}

const samePeriod = (a: BedSpaPeriod, b: BedSpaPeriod) =>
  a.grain === b.grain && a.periodStart === b.periodStart && a.periodEnd === b.periodEnd;

export function spaHeadlinePeriods(engagement: BedSpaPeriod, conversion: BedSpaPeriod | null): SpaHeadlinePeriods {
  const engagementLabel = spaEngagementPeriodLabel(engagement.grain, engagement.periodStart, engagement.periodEnd);
  if (!conversion) return { engagement: engagementLabel, conversion: null, mixed: false, notice: null };
  const mixed = !samePeriod(engagement, conversion);
  const conversionLabel = mixed
    ? periodLabel(conversion.grain, conversion.periodStart, conversion.periodEnd)
    : engagementLabel;
  return {
    engagement: engagementLabel,
    conversion: conversionLabel,
    mixed,
    notice: mixed
      ? `These cards cover two periods. Spa Conversion Rate is for ${conversionLabel}, the newest period Bed Usage and Spa Wellness both cover. Spa Sessions, Unique Spa Tanner % and Spa Per Unique % are for ${engagementLabel}, this report's period.`
      : null,
  };
}
