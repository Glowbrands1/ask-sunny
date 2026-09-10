"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { cn } from "@/lib/utils/cn";
import { formatMetricValue, sentimentFor } from "@/lib/reporting/read/aggregation";
import type { SalonRankingRow } from "@/lib/reporting/read/dashboard";
import type { ReportMetricUnit } from "@/lib/reporting/types";
import { salonAxisWidth, storeNameTicks } from "./chart-axis";
import {
  BAR_GAP,
  CHART_AXIS,
  CHART_GRID,
  SERIES_DECREASE,
  SERIES_INCREASE,
  SERIES_PRIMARY,
  SERIES_TRACK,
} from "./chart-palette";

/**
 * The Salon Performance charts.
 *
 * Both are categorical comparisons across salons at ONE point in time. There is
 * deliberately no line or area chart anywhere: the reporting data holds a single
 * period, and a line implies a trajectory between points that does not exist.
 * When further periods are ingested that decision can be revisited on evidence.
 *
 * ============================================================================
 * THREE CHARTS BECAME TWO
 * ============================================================================
 *
 * The current Marquee Reports artifact makes exactly one structural change to
 * this page, and states the reasoning: "Today the page draws the same fifteen
 * salons three times — ranked revenue, 2026 against 2025, then percent change.
 * The first two answer the same question, so the prior year folds onto the
 * ranked bars as a tick mark and one whole chart disappears."
 *
 * So `BaselineComparisonChart` is gone and the ranking chart carries the
 * baseline as a marker on each bar. THE COMPARISON DATA IS NOT GONE: the same
 * `row.baseline` and `row.change` drive the tick, the tooltip names both sides
 * and the change, and the ranking and comparison TABLES below the charts are
 * untouched. What was removed is a second drawing of one fact.
 *
 * PERCENT CHANGE KEEPS ITS OWN CHART, and the artifact says why rather than
 * leaving it implied: "it is a different measure with a different shape — it
 * runs both sides of zero." The same paragraph rules out the shortcut that
 * would have merged them: "Revenue and percent change are different scales, so
 * they are two charts. Putting them on one plot with two y-axes is the single
 * most common way a dashboard lies."
 *
 * Every value is formatted through `formatMetricValue`, so the unit follows the
 * metric — currency gets a symbol, percentages are multiplied by 100 exactly
 * once, counts get thousands separators.
 */

interface ChartProps {
  rows: SalonRankingRow[];
  unit: ReportMetricUnit;
  metricLabel: string;
  /**
   * Headings for the two sides of the comparison.
   *
   * STRINGS, NOT YEARS. A comparison window is not always a year: "Last 3
   * Months" compares two trailing windows the source computed, and typing these
   * as numbers forced every chart to assume otherwise.
   */
  currentLabel: string;
  /** Null when the selected window has no comparison at all. */
  baselineLabel: string | null;
  className?: string;
}

/** A salon's display name: number first, because that is the business key. */
function salonTick(row: SalonRankingRow): string {
  return `${row.salonNumber} · ${row.storeName}`;
}

/** Height that keeps ~28px per bar so labels never collide. */
function chartHeight(count: number, perRow = 28, minimum = 200): number {
  return Math.max(minimum, count * perRow + 48);
}

interface TooltipPayload {
  payload?: SalonRankingRow;
  dataKey?: string | number;
  value?: number;
}

function SalonTooltip({
  active,
  payload,
  unit,
  currentLabel,
  baselineLabel,
}: {
  active?: boolean;
  payload?: TooltipPayload[];
  unit: ReportMetricUnit;
  currentLabel: string;
  baselineLabel: string | null;
}) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;

  return (
    <div className="rounded-lg border border-border bg-surface-raised px-3 py-2 text-xs shadow-md">
      <p className="font-medium text-foreground">{salonTick(row)}</p>
      <dl className="mt-1.5 space-y-0.5">
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-muted-foreground">{currentLabel}</dt>
          <dd className="text-foreground">
            {row.current === null ? "Unavailable" : formatMetricValue(row.current, unit)}
          </dd>
        </div>
        {baselineLabel ? (
          <>
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-muted-foreground">{baselineLabel}</dt>
              <dd className="text-foreground">
                {row.baseline === null ? "Unavailable" : formatMetricValue(row.baseline, unit)}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-muted-foreground">Change</dt>
              <dd className="text-foreground">
                {row.change === null ? "Unavailable" : formatMetricValue(row.change, "percent")}
              </dd>
            </div>
          </>
        ) : null}
        {row.quintileGroup ? (
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-muted-foreground">Reported quintile</dt>
            <dd className="text-foreground">{row.quintileGroup}</dd>
          </div>
        ) : null}
      </dl>
    </div>
  );
}

/**
 * A RANKED BAR WITH THE PRIOR PERIOD MARKED ON IT.
 *
 * The artifact's second validated value, and its description is the spec: "A
 * 3px tick with a white ring, not a second bar. Near-black against coral is the
 * widest separation available in the palette [protan dE 35.2], so the prior
 * year reads at a glance without competing for area."
 *
 * WHY A CUSTOM SHAPE RATHER THAN A SECOND SERIES. A second `<Bar>` is the thing
 * being removed — it takes half the row's height and turns one reading into
 * two. A `<ReferenceLine>` cannot do it either: those are per-chart, and this
 * is a different value on every row.
 *
 * HOW THE TICK IS POSITIONED, AND WHY IT CANNOT ESCAPE THE PLOT. Recharts hands
 * the shape the bar's own geometry, so pixels-per-unit is `width / current` and
 * the tick belongs at `x + baseline * (width / current)`. That is exact rather
 * than estimated, because it is derived from the scale recharts actually used.
 *
 * The one way it could overflow is a salon whose prior period beat every
 * current figure in view — the axis would end before the tick. `rankingDomain`
 * below is what removes that: the axis is told to cover both series, so a
 * baseline is always inside the plot by construction. A guard that merely
 * clamped the tick would have drawn it in the wrong place instead, which on a
 * provenance-conscious report is worse than not drawing it.
 *
 * A ROW WITH NO COMPARISON GETS NO TICK. Null baseline, a zero or missing
 * current, or a non-finite ratio all draw the bar alone: the absence of a prior
 * figure is not a prior figure of zero, and a tick at the origin would claim
 * the salon had no business last year.
 */
function RankedBarWithBaseline(props: unknown) {
  const {
    x = 0,
    y = 0,
    width = 0,
    height = 0,
    fill,
    payload,
  } = props as {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    fill?: string;
    payload?: SalonRankingRow;
  };

  const current = payload?.current ?? null;
  const baseline = payload?.baseline ?? null;
  const scale = current !== null && current > 0 && width > 0 ? width / current : null;
  const markerX =
    scale !== null && baseline !== null && Number.isFinite(baseline)
      ? x + baseline * scale
      : null;

  return (
    <g>
      {/* The measure. 4px rounded at the data end, square against the axis. */}
      <path
        d={roundedRightPath(x, y, width, height, 4)}
        fill={fill}
        role="presentation"
      />
      {markerX === null ? null : (
        <>
          {/* The white ring, so the tick survives sitting on top of the fill. */}
          <rect
            x={markerX - 2.5}
            y={y - 4}
            width={7}
            height={height + 8}
            rx={2}
            fill="var(--surface)"
          />
          <rect
            x={markerX - 1.5}
            y={y - 4}
            width={3}
            height={height + 8}
            rx={1.5}
            fill="var(--measure-benchmark)"
          />
        </>
      )}
    </g>
  );
}

/**
 * A bar path with only its right corners rounded.
 *
 * Written out rather than using an SVG `rx`, which rounds all four: the artifact
 * squares the end that meets the axis, so a bar reads as growing FROM the axis
 * rather than as a floating capsule. A bar shorter than the radius degrades to a
 * plain rect instead of drawing an arc wider than the bar.
 */
function roundedRightPath(
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): string {
  const r = Math.max(0, Math.min(radius, width, height / 2));
  if (r === 0) return `M${x},${y}h${width}v${height}h${-width}z`;
  return [
    `M${x},${y}`,
    `h${width - r}`,
    `a${r},${r} 0 0 1 ${r},${r}`,
    `v${height - 2 * r}`,
    `a${r},${r} 0 0 1 ${-r},${r}`,
    `h${-(width - r)}`,
    "z",
  ].join("");
}

/**
 * THE VALUE AXIS COVERS BOTH SERIES.
 *
 * Recharts would default to the maximum of the drawn `dataKey` alone, which is
 * the current period — and the baseline tick is drawn from the same scale, so a
 * salon that was larger last period would place its tick past the end of the
 * axis. Taking the maximum across both is what makes the fold safe.
 *
 * Returns `undefined` for an empty or all-null set, which leaves recharts to its
 * own default rather than handing it a degenerate `[0, 0]` domain.
 */
function rankingDomain(rows: readonly SalonRankingRow[]): [number, number] | undefined {
  let max = 0;
  for (const row of rows) {
    for (const value of [row.current, row.baseline]) {
      if (value !== null && Number.isFinite(value) && value > max) max = value;
    }
  }
  return max > 0 ? [0, max] : undefined;
}

/**
 * 1. SALON RANKING — one measure across every salon in view, with the prior
 *    period marked on each bar.
 *
 * One series, so one colour for every bar and no legend beyond the marker's:
 * the title names the measure. Shading bars by size would encode length twice
 * and say nothing new, and the artifact adds the stronger version of that rule —
 * "a colour that follows rank instead of the salon is a colour that lies".
 */
export function SalonRankingChart({
  rows,
  unit,
  metricLabel,
  currentLabel,
  baselineLabel,
  className,
}: ChartProps) {
  if (rows.length === 0) {
    return (
      <p className={cn("py-8 text-center text-sm text-muted-foreground", className)}>
        No salon reported {metricLabel} for this period.
      </p>
    );
  }

  return (
    <div className={className} style={{ height: chartHeight(rows.length) }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={rows}
          layout="vertical"
          margin={{ top: 4, right: 72, bottom: 4, left: 8 }}
          barGap={BAR_GAP}
        >
          {/* Value axis is horizontal here, so the grid runs vertically. */}
          <CartesianGrid {...CHART_GRID} horizontal={false} />
          <XAxis
            type="number"
            domain={rankingDomain(rows)}
            {...CHART_AXIS}
            tickFormatter={(value: number) => formatMetricValue(value, unit, { compact: true })}
          />
          <YAxis
            type="category"
            dataKey="salonNumber"
            width={salonAxisWidth(rows)}
            {...CHART_AXIS}
            tickFormatter={storeNameTicks(rows)}
          />
          <Tooltip
            cursor={{ fill: "var(--surface-muted)" }}
            content={
              <SalonTooltip
                unit={unit}
                currentLabel={currentLabel}
                baselineLabel={baselineLabel}
              />
            }
          />
          <Bar
            dataKey="current"
            name={`${metricLabel} (${currentLabel})`}
            fill={SERIES_PRIMARY}
            maxBarSize={18}
            /*
              THE TRACK, in the coral's own pale tint — the artifact draws every
              bar inside one, so a short bar reads as a proportion of the row
              rather than as a stub.
            */
            background={{ fill: SERIES_TRACK, radius: 4 }}
            /*
              The shape draws the fill AND the prior period's tick. `radius` is
              not passed with it: a custom shape owns its own geometry, and
              recharts would otherwise hand the prop to a rect this never
              renders.
            */
            shape={<RankedBarWithBaseline />}
            // Direct labels on a ranking of this size: the value is the point.
            label={{
              position: "right",
              formatter: (label: unknown) =>
                typeof label === "number"
                  ? formatMetricValue(label, unit, { compact: true })
                  : "",
              fill: "var(--foreground)",
              fontSize: 11,
              fontWeight: 900,
            }}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/**
 * A signed change label, placed outside the bar on the side it points.
 *
 * Recharts hands back the bar's pixel geometry, and for a bar drawn left of
 * zero the rectangle still has a positive width — so the sign of the VALUE is
 * what decides which side the label belongs on, not the geometry. Getting that
 * wrong puts every negative label on top of its own bar.
 */
function SignedChangeLabel(props: {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  value?: number;
}) {
  const { x = 0, y = 0, width = 0, height = 0, value } = props;
  if (typeof value !== "number" || !Number.isFinite(value)) return null;

  const negative = value < 0;

  /*
   * THE EDGES ARE DERIVED, NOT ASSUMED.
   *
   * Chart libraries disagree about how a bar running the "wrong" way is
   * reported: some give the left edge with a positive width, others give the
   * value-end with a NEGATIVE width. Reading `x` as the left edge under the
   * second convention puts every negative label on top of its own bar — a dark
   * figure on a filled bar, which is the one place on this chart where the
   * number stops being readable, and the number is what carries the reading.
   *
   * Normalising to min/max is correct under either convention and cannot
   * regress if the library changes its mind again.
   */
  const left = Math.min(x, x + width);
  const right = Math.max(x, x + width);
  const textX = negative ? left - 6 : right + 6;

  return (
    <text
      x={textX}
      y={y + height / 2}
      dy={4}
      textAnchor={negative ? "end" : "start"}
      fill="var(--muted-foreground)"
      fontSize={11}
      className="tabular-nums"
    >
      {formatMetricValue(value, "percent")}
    </text>
  );
}

/**
 * 3. MOVERS — the strongest and weakest movements against the baseline.
 *
 * Polarity is encoded by POSITION: bars run right of the zero line for an
 * increase and left for a decrease. That is a stronger channel than hue, it is
 * immune to colour blindness, and — the reason it is the right choice here — it
 * lets the chart show direction without asserting that direction is good.
 *
 * Whether an increase is desirable depends on `higher_is_better`, which may be
 * null. The caller supplies wording; this chart supplies magnitude and sign.
 *
 * ONE EXCEPTION, ADDED DELIBERATELY: WHERE THE MEASURE'S DIRECTION IS KNOWN,
 * THE SALONS ON THE WRONG SIDE TAKE THE FLAG.
 *
 * The KPI row directly above this chart already colours the same measure coral
 * when it is behind. Leaving every bar neutral meant one page stating a fact
 * twice and colouring it once — a manager reading "Total revenue, coral, down
 * 4%" and then a row of identical grey bars has to work out for themselves
 * which salons the coral was about.
 *
 * The original reasoning is kept intact rather than overridden: it protects the
 * case where `higher_is_better` is NULL, and in that case nothing here is
 * coloured at all. Position still carries direction for every bar, so the flag
 * adds a second channel to the salons that are behind and never becomes the
 * only one.
 */
export function MoversChart({
  rows,
  unit,
  metricLabel,
  currentLabel,
  baselineLabel,
  higherIsBetter = null,
  className,
}: ChartProps & {
  /** Null where the business has not stated a direction. Nothing is flagged. */
  higherIsBetter?: boolean | null;
}) {
  const comparable = rows.filter((row) => row.change !== null);

  if (comparable.length === 0) {
    return (
      <p className={cn("py-8 text-center text-sm text-muted-foreground", className)}>
        {metricLabel} has no {baselineLabel ?? "comparison"} figure in this report, so movement
        cannot be shown.
      </p>
    );
  }

  const ordered = [...comparable].sort((a, b) => (b.change ?? 0) - (a.change ?? 0));
  // A symmetric domain keeps a +5% bar the same length as a -5% bar.
  const extent = Math.max(...ordered.map((row) => Math.abs(row.change ?? 0)));
  const bound = extent === 0 ? 0.01 : extent * 1.15;

  return (
    <div className={className} style={{ height: chartHeight(ordered.length) }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={ordered}
          layout="vertical"
          margin={{ top: 4, right: 72, bottom: 4, left: 72 }}
          barGap={BAR_GAP}
        >
          <CartesianGrid {...CHART_GRID} horizontal={false} />
          <XAxis
            type="number"
            domain={[-bound, bound]}
            {...CHART_AXIS}
            tickFormatter={(value: number) => formatMetricValue(value, "percent")}
          />
          <YAxis
            type="category"
            dataKey="salonNumber"
            width={salonAxisWidth(rows)}
            {...CHART_AXIS}
            tickFormatter={storeNameTicks(rows)}
          />
          <Tooltip
            cursor={{ fill: "var(--surface-muted)" }}
            content={
              <SalonTooltip
                unit={unit}
                currentLabel={currentLabel}
                baselineLabel={baselineLabel}
              />
            }
          />
          {/* The zero line is the chart's spine: it is what makes sign legible. */}
          <ReferenceLine x={0} stroke="var(--measure-zero)" strokeWidth={1} />
          <Bar dataKey="change" name="Change" maxBarSize={18}>
            {ordered.map((row) => (
              /*
               * GREEN IS THE EXCEPTION, CORAL IS THE DEFAULT — the artifact's
               * ninth item: "Coral carries the data and green marks increases."
               *
               * Read through `sentimentFor` rather than off the sign, which is
               * the guarantee that matters here: it returns "neutral" for a
               * measure whose `higher_is_better` the catalogue does not state,
               * and for a zero change. Both fall through to the coral, so the
               * chart never paints a rise in a cost measure as good news — a
               * judgement the business has not made.
               *
               * COLOUR IS THE SECOND CUE. Direction across zero and the signed
               * label both carry the reading first, which is what makes the
               * chart legible at protan dE 9.6 and in greyscale.
               */
              <Cell
                key={row.salonNumber}
                fill={
                  sentimentFor(row.change, higherIsBetter) === "good"
                    ? SERIES_INCREASE
                    : SERIES_DECREASE
                }
              />
            ))}
            {/* Signed labels, placed outside the bar on the side it points. */}
            <LabelList dataKey="change" content={<SignedChangeLabel />} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/**
 * A legend rendered as markup rather than by the chart library, so identity is
 * text plus a swatch and never colour alone.
 */
export function ChartLegend({
  items,
  className,
}: {
  /**
   * `marker` matches the SHAPE the chart actually draws.
   *
   * A swatch is right for a filled bar and wrong for the prior-period tick:
   * the artifact draws that as a tall 3px rule, so the legend draws the same
   * rule. A square next to "2025" would say the comparison is a second bar,
   * which is the thing the fold removed.
   */
  items: { label: string; color: string; marker?: "swatch" | "tick" }[];
  className?: string;
}) {
  return (
    <ul className={cn("flex flex-wrap items-center gap-4 text-xs", className)}>
      {items.map((item) => (
        <li
          key={item.label}
          className="flex items-center gap-2 font-bold text-body-foreground"
        >
          <span
            aria-hidden
            className={cn(
              item.marker === "tick" ? "h-[15px] w-[3px] rounded-sm" : "size-2.5 rounded-sm",
            )}
            style={{ backgroundColor: item.color }}
          />
          {item.label}
        </li>
      ))}
    </ul>
  );
}
