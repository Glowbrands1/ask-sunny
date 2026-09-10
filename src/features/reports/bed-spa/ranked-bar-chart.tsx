"use client";

import {
  Bar,
  BarChart,
  Cell,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { cn } from "@/lib/utils/cn";
import type { PerformanceBand } from "@/lib/reporting/performance/classification";
import {
  BAR_GAP,
  BAR_RADIUS_HORIZONTAL,
  CHART_AXIS,
  CHART_GRID,
  SERIES_PRIMARY,
} from "@/features/reports/salon-performance/chart-palette";

import {
  formatCount,
  formatDelta,
  formatPerBed,
  formatRate,
  formatRatio,
  formatSmallRatio,
} from "./format";

/**
 * ONE MEASURE, RANKED, AS HORIZONTAL BARS.
 *
 * Horizontal because the category is a salon name or an equipment type, and
 * both are long: rotated vertical labels are the single most common way a
 * ranked chart becomes unreadable at fifteen categories.
 *
 * A RANKING, NOT A TREND. One period is one point in time. Two periods of these
 * reports are two accumulations — MTD and YTD through the same day overlap
 * completely — so joining them with a line would draw a progression the source
 * does not describe. When enough monthly periods accumulate a true month-on-
 * month trend becomes possible, and it will be a new chart rather than a line
 * quietly added to this one.
 *
 * A ROW WITH NO VALUE IS NOT DRAWN AT ZERO. The caller filters them out; a bar
 * of length zero for a salon that did not report reads as a salon that did
 * nothing, which is a different and actionable claim.
 *
 * BARS ARE COLOURED BY BAND WHERE A BAND EXISTS, so the ranking and the
 * classification are one read rather than two. Without a band every bar is the
 * single accent, because colouring by magnitude would assert a judgement the
 * report has not made.
 *
 * THE BENCHMARK IS DRAWN AS A CORAL RULE — the red line — but only where the
 * chart is actually CLASSIFYING against it. See `BAND_FILL` and the
 * `ReferenceLine` below: a line that decides the bands is a threshold, and a
 * line that merely locates the estate average is a locator. Drawing both the
 * same way would tell a manager that falling under a descriptive average is a
 * finding, which is a claim these reports do not make.
 *
 * THE VALUE FORMAT IS A NAME, NOT A FUNCTION. This is a client component and
 * every caller is a server component, so a `formatValue` callback cannot cross
 * the boundary — React refuses to serialize a function, at RUNTIME, which is
 * how a first revision of this compiled cleanly and then rendered an error
 * boundary. Naming the format keeps the choice with the page that knows what
 * the measure is, and keeps the formatting where it can actually run.
 */

/**
 * THE BAND FILLS, ON THE FROZEN MEASURE RAMP.
 *
 * THIS WAS BROKEN AND LOOKED FINE IN THE SOURCE. Two of the four fills named
 * `--stc-warm-tan-deep` and the reference line named `--stc-slate-deep`; both
 * tokens were removed when the approved palette landed. An unresolvable
 * `var()` in an SVG `fill` is not a fallback — it is an invalid attribute, so
 * every At Market bar on Bed Usage, Spa Engagement and Spa Wellness rendered
 * BLACK, and the benchmark line did not draw at all. `theme-semantics` now
 * pins every `var()` in the app against `globals.css` so this cannot recur.
 *
 * WHY THERE ARE FOUR BANDS AND ONLY THREE COLOURS.
 *
 * The direction's rule is that a measure is neutral until it is behind, and
 * then it is coral — so polarity is the thing colour encodes here, and the
 * neutral side varies in LIGHTNESS rather than hue (`#141821` at L* 8 against
 * `#6b696e` at L* 45, dE 36.8).
 *
 * Both behind bands take the SAME coral. The obvious alternative — the coral
 * fill for Below Market and the deeper coral ink for Significantly
 * Underperforming — scores dE 13.7 between the two, under the floor of 15 this
 * report family's own palette validator uses and records in
 * `chart-palette.ts`. A distinction a full-colour reader cannot resolve is not
 * a distinction; it is a second colour that looks like a rendering fault. So
 * the fill says BEHIND and the badge beside it says how far behind, in words.
 *
 * The coral is also the lighter of the two (L* 60 against the neutral's L* 45),
 * which keeps the flag separable from the neutral in greyscale as well as in
 * hue — dE 59.9 — rather than only for readers who see the red.
 */
const BAND_FILL: Record<PerformanceBand, string> = {
  outperforming: "var(--measure-series-strong)",
  at_market: "var(--measure-series)",
  below_market: "var(--measure-flagged)",
  significantly_underperforming: "var(--measure-flagged)",
};

export interface RankedRow {
  /** Stable key. The salon number where there is one, else the label. */
  readonly key: string;
  /** What the axis shows. */
  readonly label: string;
  /** Null rows are the caller's to filter; this chart never draws one. */
  readonly value: number | null;
  /** Colours the bar when present. */
  readonly band?: PerformanceBand | null;
  /** Extra lines for the tooltip, in order. */
  readonly detail?: readonly { label: string; value: string }[];
}

/** Widest label in view, so a long salon name is not clipped. */
function axisWidth(rows: readonly RankedRow[]): number {
  const longest = rows.reduce((widest, row) => Math.max(widest, row.label.length), 0);
  // ~6.2px per character at 11px, clamped so one very long name does not eat
  // the plot area.
  return Math.min(210, Math.max(96, Math.round(longest * 6.2) + 12));
}

/**
 * The formats a ranked measure can be shown in.
 *
 * A closed set rather than a callback, so the choice is serializable. Each name
 * maps to one of the shared formatters in `format.ts`, which is where the
 * precision decisions live — `smallRatio` exists because the bed-normalized
 * engagement measure spans 0.02 to 0.25 and two decimals would collapse a third
 * of that range into one value.
 */
export type RankedValueFormat =
  | "count"
  | "perBed"
  | "delta"
  | "rate"
  | "ratio"
  | "smallRatio"
  /** `#7` from a rank inverted for display. Needs `rankPopulation`. */
  | "rankOf";

function formatterFor(
  format: RankedValueFormat,
  rankPopulation?: number | null,
): (value: number) => string {
  switch (format) {
    case "count":
      return formatCount;
    case "perBed":
      return formatPerBed;
    case "delta":
      return formatDelta;
    case "rate":
      return (value) => formatRate(value);
    case "ratio":
      return formatRatio;
    case "smallRatio":
      return formatSmallRatio;
    case "rankOf":
      return (value) =>
        rankPopulation ? `#${formatCount(rankPopulation - value + 1)}` : formatCount(value);
  }
}

export function RankedBarChart({
  rows,
  valueLabel,
  format,
  rankPopulation,
  /** A benchmark line, e.g. the chain average or the estate rate. */
  reference,
  emptyMessage = "No salon reported this measure for the selected period.",
  className,
}: {
  rows: readonly RankedRow[];
  valueLabel: string;
  format: RankedValueFormat;
  /** Required by the `rankOf` format, ignored by the others. */
  rankPopulation?: number | null;
  reference?: { value: number; label: string } | null;
  emptyMessage?: string;
  className?: string;
}) {
  const formatValue = formatterFor(format, rankPopulation);
  const drawable = rows.filter(
    (row): row is RankedRow & { value: number } =>
      row.value !== null && Number.isFinite(row.value),
  );

  if (drawable.length === 0) {
    return (
      <p className={cn("py-8 text-center text-sm text-muted-foreground", className)}>
        {emptyMessage}
      </p>
    );
  }

  const height = Math.max(180, drawable.length * 28 + 48);
  const hasNegative = drawable.some((row) => row.value < 0);
  /*
   * IS THE LINE A THRESHOLD, OR JUST A LOCATOR?
   *
   * Derived from the rows rather than passed in, because the two must not be
   * able to disagree: the line is the red line exactly when the bars in front
   * of it are being classified against it. Bed Usage's per-bed chart bands
   * every salon against this estate figure, so under the line IS the finding;
   * Spa Engagement's charts draw the same estate rate with no bands at all, and
   * there a dashed coral rule would invent a target the report never set.
   */
  const classifying = drawable.some((row) => row.band != null);

  return (
    <div className={className} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={drawable as RankedRow[]}
          layout="vertical"
          margin={{ top: 4, right: 84, bottom: 4, left: 8 }}
          barGap={BAR_GAP}
        >
          <CartesianGrid {...CHART_GRID} horizontal={false} />
          <XAxis type="number" {...CHART_AXIS} tickFormatter={formatValue} />
          <YAxis
            type="category"
            dataKey="label"
            width={axisWidth(drawable)}
            {...CHART_AXIS}
          />
          {/* A zero line, only where the measure can go negative — a v Chain
              shortfall reads very differently from a session count. */}
          {hasNegative ? (
            <ReferenceLine x={0} stroke="var(--border-strong)" strokeWidth={1} />
          ) : null}
          {reference ? (
            <ReferenceLine
              x={reference.value}
              /* The flag INK, not the flag fill: a rule and a bar sitting in
                 the same coral would read as one shape. */
              stroke={
                classifying ? "var(--measure-flagged-foreground)" : "var(--border-strong)"
              }
              strokeWidth={classifying ? 1.5 : 1}
              strokeDasharray="4 3"
              label={{
                value: reference.label,
                position: "insideTopRight",
                fill: classifying
                  ? "var(--measure-flagged-foreground)"
                  : "var(--muted-foreground)",
                fontSize: 10,
                fontWeight: classifying ? 700 : 400,
              }}
            />
          ) : null}
          <Tooltip
            cursor={{ fill: "var(--surface-muted)" }}
            content={<RankedTooltip valueLabel={valueLabel} formatValue={formatValue} />}
          />
          <Bar
            dataKey="value"
            name={valueLabel}
            radius={BAR_RADIUS_HORIZONTAL}
            maxBarSize={18}
            label={{
              position: "right",
              formatter: (label: unknown) =>
                typeof label === "number" ? formatValue(label) : "",
              fill: "var(--muted-foreground)",
              fontSize: 11,
            }}
          >
            {drawable.map((row) => (
              <Cell
                key={row.key}
                fill={row.band ? BAND_FILL[row.band] : SERIES_PRIMARY}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function RankedTooltip({
  active,
  payload,
  valueLabel,
  formatValue,
}: {
  active?: boolean;
  payload?: { payload?: RankedRow }[];
  valueLabel: string;
  formatValue: (value: number) => string;
}) {
  const row = payload?.[0]?.payload;
  if (!active || !row || row.value === null) return null;

  return (
    <div className="rounded-lg border border-border bg-surface-raised px-3 py-2 text-xs shadow-md">
      <p className="font-medium text-foreground">{row.label}</p>
      <dl className="mt-1.5 space-y-0.5">
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-muted-foreground">{valueLabel}</dt>
          <dd className="text-foreground tabular-nums">{formatValue(row.value)}</dd>
        </div>
        {(row.detail ?? []).map((entry) => (
          <div key={entry.label} className="flex items-baseline justify-between gap-4">
            <dt className="text-muted-foreground">{entry.label}</dt>
            <dd className="text-foreground tabular-nums">{entry.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
