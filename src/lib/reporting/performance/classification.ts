/**
 * ============================================================================
 * PERFORMANCE CLASSIFICATION — TWO LADDERS, ONE PRECEDENCE RULE
 * ============================================================================
 *
 * Both reports classify a percentage difference into four bands, and the two
 * ladders use DIFFERENT thresholds. Bed usage compares a salon's per-bed usage
 * with the chain; spa wellness compares a salon's sessions with the peers who
 * have the same equipment installed. Tanning equipment is commodity capacity
 * where a two-point gap is meaningful, and spa equipment is discretionary with
 * far more variance per site, so the approved bands are wider. Keeping them as
 * two named ladders rather than one parameterised function is what stops a
 * later edit from "simplifying" them into a single set of numbers.
 *
 * WHY THE BANDS ARE WRITTEN AS AN ORDERED LADDER RATHER THAN AS RANGES.
 *
 * The approved tables state the bands as overlapping ranges — bed usage reads
 * "≥ +2% Outperforming" then "-2% to +2% At Market" then "-2% to -8% Below
 * Market". Read as ranges, exactly +2% and exactly -2% each belong to two
 * bands, and a boundary value would classify differently depending on which
 * comparison an implementation happened to write first. That is not a
 * theoretical problem: JB's FASTEST level lands at +2.11% and its INSTANT at
 * +3.08% in the August report, and a -2.00% would be one rounding step away
 * from flipping a salon between two colours on a dashboard.
 *
 * So the ladder is evaluated top to bottom and the FIRST match wins:
 *
 *     >= +2   -> Outperforming Peers
 *     >= -2   -> At Market
 *     >  -8   -> Below Market
 *     else    -> Significantly Underperforming
 *
 * Note the third rung is STRICTLY greater than -8, which is what makes exactly
 * -8% "Significantly Underperforming" rather than "Below Market". That reading
 * comes from the approved table's own final row, which is written "≤ -8%".
 *
 * EVERYTHING HERE TAKES A PERCENTAGE, NOT A RATIO. The bed usage workbook
 * reports `v Chain` as a MULTIPLE of the chain average (1.0 = at chain), so it
 * is converted once, at the parser boundary, by `percentFromRatio`. Doing that
 * conversion at each call site is how a 2.03 would eventually be classified as
 * "+2.03%" — outperforming by two points instead of by a hundred and three.
 */

/** The four approved bands, in the order a reader ranks them. */
export type PerformanceBand =
  | "outperforming"
  | "at_market"
  | "below_market"
  | "significantly_underperforming";

export interface PerformanceBandDescriptor {
  readonly id: PerformanceBand;
  readonly label: string;
  /** Better / neutral / worse, for colour without asserting more than that. */
  readonly tone: "positive" | "neutral" | "caution" | "negative";
  /** Rank for sorting, 1 = best. */
  readonly order: number;
}

export const PERFORMANCE_BANDS: readonly PerformanceBandDescriptor[] = [
  { id: "outperforming", label: "Outperforming Peers", tone: "positive", order: 1 },
  { id: "at_market", label: "At Market", tone: "neutral", order: 2 },
  { id: "below_market", label: "Below Market", tone: "caution", order: 3 },
  {
    id: "significantly_underperforming",
    label: "Significantly Underperforming",
    tone: "negative",
    order: 4,
  },
];

export const PERFORMANCE_BANDS_BY_ID: Readonly<Record<PerformanceBand, PerformanceBandDescriptor>> =
  Object.fromEntries(PERFORMANCE_BANDS.map((band) => [band.id, band])) as Readonly<
    Record<PerformanceBand, PerformanceBandDescriptor>
  >;

/** One rung: a floor, whether the floor itself is included, and the verdict. */
interface Rung {
  readonly floor: number;
  readonly inclusive: boolean;
  readonly band: PerformanceBand;
}

/**
 * BED USAGE, versus the chain. From `docs`-approved table:
 * ≥ +2% outperforming, -2%..+2% at market, -2%..-8% below market, ≤ -8% worse.
 */
export const BED_USAGE_LADDER: readonly Rung[] = [
  { floor: 2, inclusive: true, band: "outperforming" },
  { floor: -2, inclusive: true, band: "at_market" },
  { floor: -8, inclusive: false, band: "below_market" },
];

/**
 * SPA WELLNESS, versus the peer average for the SAME installed equipment.
 * ≥ +10% outperforming, -5%..+10% at market, -5%..-15% below market, ≤ -15%.
 */
export const SPA_PEER_LADDER: readonly Rung[] = [
  { floor: 10, inclusive: true, band: "outperforming" },
  { floor: -5, inclusive: true, band: "at_market" },
  { floor: -15, inclusive: false, band: "below_market" },
];

/** Walks a ladder top to bottom; the first rung that admits the value wins. */
function classify(ladder: readonly Rung[], percent: number): PerformanceBand {
  for (const rung of ladder) {
    if (rung.inclusive ? percent >= rung.floor : percent > rung.floor) return rung.band;
  }
  return "significantly_underperforming";
}

/**
 * Bed usage performance against the chain, from a PERCENTAGE difference.
 *
 * Null in, null out. A level with no chain benchmark is unclassified, not
 * "significantly underperforming" — the absence of a comparison is not a bad
 * comparison, and colouring it red would invent a finding.
 */
export function classifyVersusChain(percent: number | null): PerformanceBand | null {
  if (percent === null || !Number.isFinite(percent)) return null;
  return classify(BED_USAGE_LADDER, percent);
}

/** Spa equipment performance against the like-for-like peer average. */
export function classifyVersusPeers(percent: number | null): PerformanceBand | null {
  if (percent === null || !Number.isFinite(percent)) return null;
  return classify(SPA_PEER_LADDER, percent);
}

/**
 * `v Chain` as the bed usage workbook reports it -> a percentage difference.
 *
 * The workbook's column holds a RATIO: 2.0258 for a salon running at twice the
 * chain's per-bed usage, 0.9648 for one just below it. Verified against all
 * 2,907 equipment rows of the August 2026 report, where the column equals the
 * row's `Per Bed` divided by the chain's per-bed figure for that LEVEL to
 * within floating-point noise.
 *
 * A ratio of 0 is a real answer — no usage at all against a chain that has some
 * — and converts to -100%. A negative or non-finite ratio cannot arise from a
 * well-formed report and yields null rather than a fabricated percentage.
 */
export function percentFromRatio(ratio: number | null | undefined): number | null {
  if (ratio === null || ratio === undefined) return null;
  if (!Number.isFinite(ratio) || ratio < 0) return null;
  return (ratio - 1) * 100;
}

/** A percentage difference between two figures, or null when it is undefined. */
export function percentDifference(
  value: number | null | undefined,
  benchmark: number | null | undefined,
): number | null {
  if (value === null || value === undefined) return null;
  if (benchmark === null || benchmark === undefined) return null;
  if (!Number.isFinite(value) || !Number.isFinite(benchmark)) return null;
  // A zero benchmark makes the difference undefined rather than infinite. The
  // caller shows "no comparison", which is the truth.
  if (benchmark === 0) return null;
  return (value / benchmark - 1) * 100;
}

/**
 * ============================================================================
 * THE FAST RULE
 * ============================================================================
 *
 * FAST equipment is being removed on purpose. The approved rules say so
 * plainly: "FAST removals are intentional and are not treated as a negative
 * KPI", and FAST is monitored for capacity, volume migration and whether the
 * premium levels absorb the demand it used to carry.
 *
 * So a FAST row still gets a `v Chain` figure — the arithmetic is the source's,
 * not ours, and hiding it would be its own distortion — but it is marked
 * `advisory`, and NOTHING may raise it as a performance failure. In the August
 * 2026 report JB's FAST level runs at -28.5% against the chain across twenty
 * beds; treated as a KPI that is the single worst number on the page, and it is
 * the intended consequence of a decision already taken.
 *
 * Implemented as a predicate on the LEVEL rather than as a flag a caller
 * remembers to pass, so a new chart cannot forget it.
 */
export const FAST_LEVEL = "FAST";

/** True when a level's shortfall against the chain must not raise an alert. */
export function isAdvisoryOnlyLevel(level: string | null | undefined): boolean {
  return (level ?? "").trim().toUpperCase() === FAST_LEVEL;
}

/**
 * Whether a classification may be presented as a finding for this level.
 *
 * A FAST row classifying below market is suppressed as a FINDING and kept as a
 * FIGURE. An outperforming FAST row is not suppressed: the rule exists so a
 * deliberate removal is not read as failure, not so good news is hidden.
 */
export function isReportableFinding(
  level: string | null | undefined,
  band: PerformanceBand | null,
): boolean {
  if (band === null) return false;
  if (band === "outperforming" || band === "at_market") return true;
  return !isAdvisoryOnlyLevel(level);
}

/**
 * Why a FAST row is exempt, in one sentence, for a tooltip or a table cell.
 *
 * Returned rather than written at each call site so the explanation a manager
 * reads is identical everywhere it appears.
 */
export const FAST_ADVISORY_NOTE =
  "FAST reductions are intentional. This level is tracked for capacity and for whether FASTER, FASTEST and INSTANT absorb former FAST demand — not as a performance shortfall.";

/**
 * IS THIS BAND BEHIND ITS BENCHMARK?
 *
 * The one question the flagged-measure treatment asks. The approved direction
 * spends colour on exactly one thing — a measure somebody has to look at — and
 * a chart bar, a table cell and a KPI figure describing the same row must not
 * be able to disagree about whether that is the case.
 *
 * DERIVED FROM THE BAND'S OWN `tone` rather than by listing the two ids, so a
 * fifth band added later cannot arrive without an answer to this. `caution` and
 * `negative` are behind; `positive` and `neutral` are not, and neither takes
 * colour — direction is not target, and green is out of the system entirely.
 *
 * Null is NOT behind. A row with no benchmark is unclassified, and colouring
 * the absence of a comparison would invent a finding.
 */
export function isBehindBenchmark(band: PerformanceBand | null | undefined): boolean {
  if (band === null || band === undefined) return false;
  const { tone } = PERFORMANCE_BANDS_BY_ID[band];
  return tone === "caution" || tone === "negative";
}
