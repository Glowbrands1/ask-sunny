import { StatusChip, type StatusTone } from "@/components/ui/marquee";
import {
  FAST_ADVISORY_NOTE,
  PERFORMANCE_BANDS_BY_ID,
  type PerformanceBand,
} from "@/lib/reporting/performance/classification";

/**
 * ============================================================================
 * A PERFORMANCE BAND, AS THE ARTIFACT'S STATUS CHIP
 * ============================================================================
 *
 * The Marquee Reports artifact names this the point of the Bed Usage tab: "What
 * this tab adds is a four-state status vocabulary — Outperforming Peers, Below
 * Market, Significantly Underperforming, and Tracked for Capacity. That
 * vocabulary is the page's whole point, and it is currently plain text in a
 * column."
 *
 * It was a rounded `Badge` in the pipeline-status tones — `ready`, `attention`,
 * `failed` — which are the tones a knowledge document's INGESTION takes. A spa
 * bed running 25% under the chain and a PDF that failed to index were reading
 * as the same kind of fact.
 *
 * WHY THIS WRAPS THE SHARED CHIP RATHER THAN RESTYLING THE BADGE. The Google
 * Reviews artifact reuses this exact ladder on its leaderboard, and says why:
 * "the same four fills and glyphs as the report tabs, so a chip means the same
 * thing wherever a DM sees it." `StatusChip` is that shared object; this module
 * is only the part that is specific to these reports — which band maps to which
 * rung, and the one state that is not a performance verdict at all.
 *
 * THE TONE IS STILL DERIVED FROM THE BAND'S OWN `tone`, exactly as `bandTone`
 * did, so the bands and the rungs stay declared in one place
 * (`classification.ts`) and a fifth band cannot arrive without a rung.
 */
const TONE_FOR_BAND: Record<
  ReturnType<() => (typeof PERFORMANCE_BANDS_BY_ID)[PerformanceBand]["tone"]>,
  StatusTone
> = {
  positive: "outperforming",
  neutral: "atMarket",
  caution: "belowMarket",
  negative: "under",
};

/**
 * THE CHIP'S SHORTER LABEL, AND WHY THE CANONICAL ONE IS UNTOUCHED.
 *
 * `PERFORMANCE_BANDS` holds the approved business vocabulary and it stays
 * exactly as it is: it names the filter options, the menu entries and anything
 * exported, where the full phrase is the right one. "SIGNIFICANTLY
 * UNDERPERFORMING" set in 8.5px caps is 27 characters in a table column, and
 * the artifact draws "Significantly under" for that reason.
 *
 * So this is a DISPLAY form for the chip only, keyed off the same ids. It is not
 * a rename, and nothing derives meaning from it.
 */
const CHIP_LABEL: Record<PerformanceBand, string> = {
  outperforming: "Outperforming peers",
  at_market: "At market",
  below_market: "Below market",
  significantly_underperforming: "Significantly under",
};

export function BandStatusChip({
  band,
  /**
   * False when this row's shortfall must not be presented as a finding.
   *
   * The FAST rule: its reductions are intentional, so the band is shown as a
   * FIGURE in the v Chain column and never badged as a verdict here. Passed in
   * rather than recomputed, because the pages already resolve it through
   * `isReportableFinding` and two answers to the same question is how a chart
   * and a table come to disagree about one row.
   */
  reportable,
  /** True for the FAST level, which takes the quietest rung in the set. */
  advisoryOnly = false,
}: {
  band: PerformanceBand | null;
  reportable: boolean;
  advisoryOnly?: boolean;
}) {
  if (!reportable) {
    /*
     * TRACKED FOR CAPACITY IS A RUNG, NOT AN ABSENCE. It was plain grey text,
     * which read as "this cell failed to render" beside four coloured badges.
     * The artifact gives it the warm neutral chip and the ◇ glyph — present in
     * the ladder, visibly not a verdict.
     */
    if (advisoryOnly) {
      return (
        <StatusChip tone="capacity" title={FAST_ADVISORY_NOTE}>
          Tracked for capacity
        </StatusChip>
      );
    }
    /*
     * NO BENCHMARK IS NOT A BAD BENCHMARK. A level the source gave no chain
     * figure for is unclassified, and any chip at all would invent a verdict —
     * so this stays text, and says which of the two it is.
     */
    return <span className="text-[11px] text-muted-foreground">No comparison</span>;
  }

  if (band === null) {
    return <span className="text-[11px] text-muted-foreground">No comparison</span>;
  }

  return (
    <StatusChip tone={TONE_FOR_BAND[PERFORMANCE_BANDS_BY_ID[band].tone]}>
      {CHIP_LABEL[band]}
    </StatusChip>
  );
}
