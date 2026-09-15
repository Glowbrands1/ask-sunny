import {
  PERFORMANCE_BANDS,
  type PerformanceBand,
} from "./classification";
import { SALON_STATUS_TEXT, type SalonStatus } from "../read/bed-spa/combined";

/**
 * ============================================================================
 * EVERY STATUS LABEL IN THE APP, AND WHICH KIND OF STATUS IT IS
 * ============================================================================
 *
 * THE REQUEST, from the 14 September review: "The reports use multiple sets of
 * status labels, including OUTPERFORMING PEERS / AT MARKET / BELOW MARKET /
 * SIGNIFICANTLY UNDERPERFORMING, along with 'TRACKED FOR CAPACITY'. I recommend
 * selecting one consistent four-tier scale and using it throughout the app
 * wherever possible."
 *
 * ============================================================================
 * WHAT THE AUDIT FOUND, AND WHY NO THRESHOLD MOVED
 * ============================================================================
 *
 * There is ALREADY one four-tier benchmark scale, and it is already shared:
 * `PERFORMANCE_BANDS` in `classification.ts` declares the four bands once, and
 * `BandStatusChip` renders them identically on Bed Usage, Spa Wellness, Spa
 * Engagement and the Google Reviews leaderboard. Nothing needed unifying there
 * and nothing here changes a threshold — the two ladders that feed the bands
 * (bed usage vs the chain, spa vs installed peers) use different cut-offs for a
 * reason recorded in that module, and the review did not ask for a change to
 * either.
 *
 * WHAT THE REVIEW ACTUALLY SPOTTED is that four DIFFERENT KINDS of state were
 * being read as one vocabulary. "Tracked for capacity" sits in the same column
 * as "Below market" and looks like a fifth performance tier; it is not one. So
 * this module names the categories and assigns every label to exactly one,
 * which is the thing that was missing.
 *
 *   BENCHMARK   A comparison against a population. FOUR TIERS, ALWAYS THESE
 *               FOUR, in this order. The only category a new label may not be
 *               added to without an approved threshold to go with it.
 *
 *   CAPACITY    A deliberate operational position, not a verdict. "Tracked for
 *               capacity" is the FAST rule: those removals are intentional and
 *               "are not treated as a negative KPI", so the row carries a
 *               figure and never a finding. Forcing it into the benchmark scale
 *               would report a decision the business already took as a failure.
 *
 *   OPERATIONAL A plainly-named reading of a salon from several reports at
 *               once — `SalonStatus` on the combined view. These are
 *               DESCRIPTIONS rather than rankings: "Traffic, weak conversion"
 *               says what two figures do, not how good the salon is, and there
 *               is no order among them.
 *
 *   DATA        A statement about the figures rather than about the business.
 *               "No comparison", "Not reported", an implausible PPTA. Every one
 *               of these must be visibly NOT a performance verdict, because the
 *               whole failure mode they exist to prevent is a gap being read as
 *               a bad result.
 *
 * ============================================================================
 * THE RULE THIS ENCODES
 * ============================================================================
 *
 * A label may belong to exactly one category, and only the BENCHMARK category
 * is a scale. A test asserts both, so a fifth performance tier cannot be added
 * without someone meaning it, and a capacity or data state cannot drift into
 * the performance ladder by being given a coloured chip.
 */

export type StatusCategory = "benchmark" | "capacity" | "operational" | "data";

export interface StatusVocabularyEntry {
  /** Stable id. The band id, the salon-status id, or a data-state key. */
  readonly id: string;
  readonly category: StatusCategory;
  /** What a reader sees. */
  readonly label: string;
  /** Rank within a scale, 1 = best. Null for categories that are not scales. */
  readonly order: number | null;
  /** Where it is declared, so the mapping can be checked against the source. */
  readonly declaredIn: string;
}

/** THE FOUR-TIER BENCHMARK SCALE. The only ordered category. */
export const BENCHMARK_TIERS: readonly StatusVocabularyEntry[] = PERFORMANCE_BANDS.map(
  (band) => ({
    id: band.id,
    category: "benchmark" as const,
    label: band.label,
    order: band.order,
    declaredIn: "lib/reporting/performance/classification.ts",
  }),
);

/** Capacity states: deliberate positions, never verdicts. */
export const CAPACITY_STATES: readonly StatusVocabularyEntry[] = [
  {
    id: "tracked_for_capacity",
    category: "capacity",
    label: "Tracked for capacity",
    order: null,
    declaredIn: "features/reports/bed-spa/status-chip.tsx (FAST rule)",
  },
];

/** Operational readings: descriptions of a salon, with no order among them. */
export const OPERATIONAL_STATES: readonly StatusVocabularyEntry[] = (
  Object.keys(SALON_STATUS_TEXT) as SalonStatus[]
).map((id) => ({
  id,
  category: "operational" as const,
  label: SALON_STATUS_TEXT[id].label,
  order: null,
  declaredIn: "lib/reporting/read/bed-spa/combined.ts",
}));

/** Data-quality states: statements about the figures, never about the business. */
export const DATA_STATES: readonly StatusVocabularyEntry[] = [
  {
    id: "no_comparison",
    category: "data",
    label: "No comparison",
    order: null,
    declaredIn: "features/reports/bed-spa/status-chip.tsx",
  },
  {
    id: "not_reported",
    category: "data",
    label: "Not reported",
    order: null,
    declaredIn: "features/reports/sales-totals, bed-spa tables",
  },
  {
    id: "ppta_data_issue",
    category: "data",
    label: "Data issue",
    order: null,
    declaredIn: "lib/reporting/ppta.ts",
  },
  {
    id: "small_peer_sample",
    category: "data",
    // Either side can be the small one, so the label no longer says "peer".
    label: "Small comparison sample",
    order: null,
    declaredIn: "lib/reporting/read/bed-spa/spa-wellness-analytics.ts",
  },
];

export const STATUS_VOCABULARY: readonly StatusVocabularyEntry[] = [
  ...BENCHMARK_TIERS,
  ...CAPACITY_STATES,
  ...OPERATIONAL_STATES,
  ...DATA_STATES,
];

/** The category a status id belongs to, or null when it is not in the vocabulary. */
export function statusCategoryOf(id: string): StatusCategory | null {
  return STATUS_VOCABULARY.find((entry) => entry.id === id)?.category ?? null;
}

/** True when this id is one of the four benchmark tiers. */
export function isBenchmarkTier(id: string): id is PerformanceBand {
  return statusCategoryOf(id) === "benchmark";
}
