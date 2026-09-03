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
import { formatMetricValue } from "@/lib/reporting/read/aggregation";
import type { SalonRankingRow } from "@/lib/reporting/read/dashboard";
import type { ReportMetricUnit } from "@/lib/reporting/types";
import { salonAxisWidth, storeNameTicks } from "./chart-axis";
import {
  BAR_GAP,
  BAR_RADIUS_HORIZONTAL,
  CHART_AXIS,
  CHART_GRID,
  SERIES_BASELINE,
  SERIES_CURRENT,
  SERIES_PRIMARY,
} from "./chart-palette";

/**
 * The Salon Performance charts.
 *
 * All three are categorical comparisons across salons at ONE point in time.
 * There is deliberately no line or area chart anywhere: the reporting data holds
 * a single period, and a line implies a trajectory between points that does not
 * exist. When further periods are ingested that decision can be revisited on
 * evidence.
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
 * 1. SALON RANKING — one measure across every salon in view.
 *
 * One series, so one colour for every bar and no legend: the title names the
 * measure. Shading bars by size would encode length twice and say nothing new.
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
            radius={BAR_RADIUS_HORIZONTAL}
            maxBarSize={18}
            // Direct labels on a ranking of this size: the value is the point.
            label={{
              position: "right",
              formatter: (label: unknown) =>
                typeof label === "number"
                  ? formatMetricValue(label, unit, { compact: true })
                  : "",
              fill: "var(--muted-foreground)",
              fontSize: 11,
            }}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/**
 * 2. BASELINE COMPARISON — current year against the selected baseline.
 *
 * A grouped categorical comparison, NOT a trend. Two bars per salon sit side by
 * side because they are two separate measurements of the same salon, not two
 * points on a path: there is no time axis, and nothing joins them.
 *
 * The baseline is drawn in a recessive slate so the current year reads first.
 */
export function BaselineComparisonChart({
  rows,
  unit,
  metricLabel,
  currentLabel,
  baselineLabel,
  className,
}: ChartProps) {
  const comparable = rows.filter((row) => row.baseline !== null || row.current !== null);

  if (comparable.length === 0) {
    return (
      <p className={cn("py-8 text-center text-sm text-muted-foreground", className)}>
        No {baselineLabel ?? "comparison"} figures are reported for {metricLabel}, so no
        comparison is available.
      </p>
    );
  }

  return (
    <div className={className} style={{ height: chartHeight(comparable.length, 40, 240) }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={comparable}
          layout="vertical"
          margin={{ top: 4, right: 24, bottom: 4, left: 8 }}
          barGap={BAR_GAP}
        >
          <CartesianGrid {...CHART_GRID} horizontal={false} />
          <XAxis
            type="number"
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
          {/* Baseline first, so it sits above in the legend reading order. */}
          <Bar
            dataKey="baseline"
            name={baselineLabel ?? "Comparison"}
            fill={SERIES_BASELINE}
            radius={BAR_RADIUS_HORIZONTAL}
            maxBarSize={12}
          />
          <Bar
            dataKey="current"
            name={currentLabel}
            fill={SERIES_CURRENT}
            radius={BAR_RADIUS_HORIZONTAL}
            maxBarSize={12}
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
  const textX = negative ? x - 6 : x + width + 6;

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
 */
export function MoversChart({
  rows,
  unit,
  metricLabel,
  currentLabel,
  baselineLabel,
  className,
}: ChartProps) {
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
          <ReferenceLine x={0} stroke="var(--border-strong)" strokeWidth={1} />
          <Bar dataKey="change" name="Change" maxBarSize={18}>
            {ordered.map((row) => (
              // One hue throughout. Direction is carried by which side of zero
              // the bar falls on, never by colour.
              <Cell key={row.salonNumber} fill={SERIES_PRIMARY} />
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
  items: { label: string; color: string }[];
  className?: string;
}) {
  return (
    <ul className={cn("flex flex-wrap items-center gap-4 text-xs", className)}>
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5 text-muted-foreground">
          <span
            aria-hidden
            className="size-2.5 rounded-sm"
            style={{ backgroundColor: item.color }}
          />
          {item.label}
        </li>
      ))}
    </ul>
  );
}
