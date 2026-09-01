/**
 * THE VALIDATED CHART PALETTE.
 *
 * These values were chosen by running the palette validator against the brand
 * ramp rather than by eye, and the results are recorded here because two of
 * them are refusals.
 *
 * WHAT FAILED, AND WHY IT MATTERS.
 *
 * The five-colour brand chart palette fails as a categorical set on the light
 * surface: `--stc-blush` sits outside the lightness band and reads at 1.55:1
 * contrast, and `--stc-sage` against `--stc-warm-tan-deep` scores ΔE 10.2 for
 * normal vision — under the floor of 15, so full-colour readers struggle to
 * tell them apart before colour blindness is even considered. It is not usable
 * for series identity.
 *
 * No brand pair passes as a DIVERGING pair either. Sage against brick scores
 * ΔE 1.6 under protanopia: to a red-blind reader they are the same colour. The
 * brand is deliberately muted and low-chroma, which is right for the product
 * and wrong for encoding polarity in hue.
 *
 * WHAT THIS LED TO — and it produced better charts, not compromised ones:
 *
 *   RANKING uses ONE colour for every bar. Salons have no natural order, so
 *   shading them by size would double-encode bar length as hue and burn the
 *   only free channel on information the chart already shows.
 *
 *   THE BASELINE COMPARISON is ordinal, not categorical: baseline then current.
 *   So it uses a recessive slate for the baseline and brand tan for the current
 *   year. The validator marks the slate below the chroma floor — that check
 *   exists to stop a categorical hue reading as grey and being confused with
 *   another hue, and here reading as grey IS the intent: the past should recede.
 *   Identity is carried by a legend and direct labels, never by hue alone.
 *   Every other check passes: ΔE 16.6 normal, 12.2 protan, 18.0 tritan, both
 *   above 3:1 contrast.
 *
 *   MOVERS encode polarity by POSITION — bars diverging left and right of a
 *   zero axis — with a single hue. Position is a stronger visual channel than
 *   hue, it removes the colour-blindness risk entirely, and it means the chart
 *   cannot accidentally assert that up is good for a metric whose
 *   `higher_is_better` is unknown.
 *
 * The application has no dark mode, so there is no dark palette to select.
 */

/** Slot 1. The only colour a single-series chart uses. */
export const SERIES_PRIMARY = "var(--stc-warm-tan-deep)";

/** The current year in the baseline comparison. Brand tan, one step lighter. */
export const SERIES_CURRENT = "var(--stc-warm-tan)";

/** The baseline year. Deliberately recessive: the past should not compete. */
export const SERIES_BASELINE = "var(--stc-slate-deep)";

/** Axis and grid chrome, kept quiet. */
export const CHART_AXIS = {
  stroke: "var(--border-strong)",
  tick: { fill: "var(--muted-foreground)", fontSize: 11 },
  tickLine: false,
  axisLine: { stroke: "var(--border)" },
} as const;

export const CHART_GRID = {
  stroke: "var(--border)",
  strokeDasharray: "0",
} as const;

/** 4px rounded data-end, anchored to the baseline. Horizontal bars. */
export const BAR_RADIUS_HORIZONTAL: [number, number, number, number] = [0, 4, 4, 0];

/** A 2px surface gap between adjacent bars. */
export const BAR_GAP = 2;
