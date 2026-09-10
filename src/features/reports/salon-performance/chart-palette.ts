/**
 * THE VALIDATED CHART PALETTE.
 *
 * These values were chosen by running a contrast and colour-vision validator
 * rather than by eye, and the results are recorded here because two of them are
 * refusals.
 *
 * ============================================================================
 * WHAT THE CURRENT MARQUEE ARTIFACTS SETTLED
 * ============================================================================
 *
 * The three pinned artifacts replace the no-hue lightness ramp this file used
 * to describe, and they do it with their own validator's table rather than a
 * preference. Reproduced, because it is the argument:
 *
 *   ROLE          VALUE     CHECK                    WHY
 *   Revenue bars  #ef6079   all six checks pass      "Coral clears the
 *                                                     lightness band, the
 *                                                     chroma floor and contrast
 *                                                     on peach."
 *   2025 marker   #1c1f29   protan dE 35.2           "A 3px tick with a white
 *                                                     ring, not a second bar."
 *   Increase      #2f6b4f   protan dE 9.6 · pass     "Deeper and bluer than a
 *                                                     standard green on
 *                                                     purpose."
 *   Decrease      #ef6079   protan dE 9.6 vs green   The default data fill.
 *   Brand yellow  #ffcc00   1.47:1 — NOT A FILL      Stays in the chrome; it
 *                                                     never encodes a value.
 *
 * THE NEAR-BLACK WAS EXPLICITLY REFUSED AS A DATA FILL. It "failed both the
 * lightness and chroma checks — technically legible, but reading as grey rather
 * than as a colour". That is the value the previous freeze's `--measure-series`
 * ramp used for the reading that mattered, so this is a direct supersession
 * rather than an addition, and `docs/marquee-design-freeze.md` records it.
 *
 * The rule that keeps the coral from doing two jobs travels with it: "in a
 * chart, coral is the data. In the interface, coral is attention. A bar and a
 * status pill are different objects." Which is why the fill below resolves
 * `--measure-data` and not `--followup-attention`, even though the two hold the
 * same value today — a rebrand may move one without the other, and the
 * follow-up colour is pinned by test to follow-up surfaces only.
 *
 * ============================================================================
 * WHAT DID NOT CHANGE
 * ============================================================================
 *
 * The three structural decisions the earlier validation produced all survive,
 * because the artifacts reach the same conclusions:
 *
 *   RANKING USES ONE COLOUR FOR EVERY BAR. Salons have no natural order, so
 *   shading them by size would double-encode bar length as hue and burn the
 *   only free channel on information the chart already shows. The artifact's
 *   tenth item says the same thing more sharply: "a colour that follows rank
 *   instead of the salon is a colour that lies."
 *
 *   THE BASELINE COMPARISON IS ORDINAL, NOT CATEGORICAL. The artifact folds it
 *   further — the prior year stops being a bar at all and becomes a tick on the
 *   current one, which is what let three charts become two. Where a baseline
 *   still needs a fill it takes the recessive warm neutral: the past should
 *   recede, and reading as grey IS the intent there.
 *
 *   MOVERS ENCODE POLARITY BY POSITION FIRST — bars diverging left and right of
 *   a zero axis. Position is a stronger visual channel than hue, and the
 *   artifact keeps colour as the second cue for exactly this reason: at protan
 *   dE 9.6 the green and the coral are close, so "direction across zero and the
 *   signed number both carry the reading. Even at protan dE 9.6 the chart has
 *   to work in greyscale, and it does."
 *
 *   GREEN IS THE EXCEPTION, NEVER THE DEFAULT. It marks an increase and nothing
 *   else. "Green never becomes a section or category colour."
 *
 * The application has no dark mode, so there is no dark palette to select.
 */

/**
 * Slot 1. The fill every bar in a ranking takes — one colour, never varied by
 * rank or by band.
 */
export const SERIES_PRIMARY = "var(--measure-data)";

/** The track a bar runs in: the coral's own pale tint. */
export const SERIES_TRACK = "var(--measure-data-track)";

/** The current year in a baseline comparison. The data fill. */
export const SERIES_CURRENT = "var(--measure-data)";

/** The baseline year. Deliberately recessive: the past should not compete. */
export const SERIES_BASELINE = "var(--measure-series-recessive)";

/**
 * A NAMED COMPARISON DRAWN ON THE BAR ITSELF.
 *
 * The prior period as a tick with a white ring, or a reference average as a
 * dashed rule. Near-black because it is the widest separation from the coral
 * the palette offers (protan dE 35.2), so it reads over a filled bar without
 * taking area from the measure.
 */
export const SERIES_BENCHMARK = "var(--measure-benchmark)";

/** The good direction, where the business has stated which one that is. */
export const SERIES_INCREASE = "var(--delta-up)";

/** The other direction. The data fill again, so coral does one job per chart. */
export const SERIES_DECREASE = "var(--measure-data)";

/** The zero rule on a diverging track. */
export const SERIES_ZERO = "var(--measure-zero)";

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
