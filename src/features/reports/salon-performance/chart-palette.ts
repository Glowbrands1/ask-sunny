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
 * WHAT THE MARQUEE DIRECTION CHANGED.
 *
 * CORAL IS THE DATA. An earlier revision set both series slots to warm
 * neutrals, on the reasoning that series identity should carry no hue at all.
 * The artifact overrides that and records the working: coral clears the
 * lightness band, the chroma floor and contrast on peach, while near-black
 * FAILED both the lightness and chroma checks — "technically legible, but
 * reading as grey rather than as a colour".
 *
 * IDENTITY STILL DOES NOT REST ON HUE. A ranking is one series, so there is no
 * pair to tell apart; the prior year arrives as a near-black TICK rather than
 * a second colour, which is the widest separation in the palette (protan
 * ΔE 35.2) and reads as a marker rather than as a competing bar.
 *
 * DIRECTION, HOWEVER, IS COLOURED. An earlier revision of this file removed
 * green outright and left a measure neutral until it was short of plan. The
 * Marquee artifact supersedes that: its movers legend reads Increase /
 * Decrease in green and coral, and it sets a rising change figure to #2f6b4f.
 * So `SERIES_UP` exists below.
 *
 * The two ideas coexist without contradiction, and the distinction is the
 * whole point: a SERIES is an identity and takes no hue; a DIRECTION is a
 * reading and takes one. Green never leaks from the second job to the first —
 * it marks a rise, and it is never a series, section or category colour.
 *
 * The application has no dark mode, so there is no dark palette to select.
 */

/** Slot 1. The only colour a single-series chart uses. */
export const SERIES_PRIMARY = "var(--measure-series)";

/**
 * THE PRIOR-YEAR MARKER: a 3px tick with a white ring, not a second bar.
 *
 * Near-black against coral is the widest separation in the palette — the
 * artifact records protan ΔE 35.2 — so last year reads at a glance without
 * competing for area. Uses the palette's existing near-black rather than
 * introducing a second one; the artifact's #1c1f29 and this #141821 are the
 * same decision, and one near-black is enough.
 */
export const SERIES_MARKER = "var(--measure-series-strong)";

/**
 * The empty part of a ranked bar.
 *
 * A coral tint, so the track reads as the same object as the fill rather than
 * as the card showing through — which is what makes a short bar still look
 * like a bar rather than like missing data.
 */
export const SERIES_TRACK = "var(--measure-series-track)";

/** The current year in the baseline comparison. */
export const SERIES_CURRENT = "var(--measure-series)";

/**
 * AN INCREASE. Green, per the artifact, and only ever this.
 *
 * The direction had removed green and encoded series by lightness. The
 * artifact supersedes that: its movers legend reads Increase / Decrease in
 * green and coral, and it sets a rising change figure to #2f6b4f.
 *
 * TWO RULES TRAVEL WITH IT, and both are the artifact's own:
 *
 *   COLOUR IS THE SECOND CUE, NEVER THE FIRST. Which side of zero a bar falls
 *   on and the signed number both carry the reading, so the chart still works
 *   in greyscale and in print. Measured, green against this coral separates at
 *   protan ΔE 17.6 and deutan ΔE 20.1 — but the chart does not depend on that.
 *
 *   GREEN IS THE EXCEPTION, NOT A SECOND ACCENT. It marks a rise and nothing
 *   else. It never becomes a section, category or decorative colour, because
 *   the moment it does, green stops meaning "this went up".
 */
export const SERIES_UP = "var(--delta-up)";

/** The baseline year. Deliberately recessive: the past should not compete. */
export const SERIES_BASELINE = "var(--measure-series-recessive)";

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
