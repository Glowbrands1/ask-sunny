"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { cn } from "@/lib/utils/cn";
import { formatMetricValue } from "@/lib/reporting/read/aggregation";
import type { SalonWindowComparison } from "@/lib/reporting/read/salon-detail";
import type { ReportMetricUnit } from "@/lib/reporting/types";
import {
  BAR_GAP,
  CHART_AXIS,
  CHART_GRID,
  SERIES_BASELINE,
  SERIES_CURRENT,
} from "./chart-palette";

/**
 * ONE MEASURE, EVERY COMPARISON THE REPORT OFFERS, AS PAIRED BARS.
 *
 * Grouped bars and NOT a line, for the same reason nothing on the dashboard is
 * a line: each comparison here is a single figure the source calculated over
 * its own span, and the spans overlap — `Last 3 Months` is inside
 * `Last 6 Months`. Joining them would draw a trajectory through points that are
 * not points in time, which is the most convincing wrong chart this data can
 * produce. Bars sit side by side and make no claim about what happened between
 * them.
 *
 * VERTICAL, not horizontal like the dashboard's ranking chart, and the
 * difference is deliberate: this axis is a handful of named comparisons rather
 * than fifteen salon numbers, so it reads left to right and the pairs stay
 * adjacent.
 *
 * A comparison the source does not report for this measure is NOT PLOTTED. The
 * caller lists those in words instead, because a zero-height bar and an absent
 * measurement look identical.
 */
export function SalonComparisonChart({
  comparisons,
  unit,
  metricLabel,
  className,
}: {
  comparisons: SalonWindowComparison[];
  unit: ReportMetricUnit;
  metricLabel: string;
  className?: string;
}) {
  const data = comparisons
    .filter((entry) => entry.supported && entry.current.value !== null)
    .map((entry) => ({
      window: entry.windowShortLabel,
      current: entry.current.value,
      baseline: entry.baseline?.value ?? null,
      currentLabel: entry.currentLabel,
      baselineLabel: entry.baselineLabel,
    }));

  if (data.length === 0) {
    return (
      <p className={cn("py-8 text-center text-sm text-muted-foreground", className)}>
        This report carries no comparison figures for {metricLabel} for this salon.
      </p>
    );
  }

  const anyBaseline = data.some((entry) => entry.baseline !== null);

  return (
    <div className={className} style={{ height: 288 }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          margin={{ top: 8, right: 8, bottom: 4, left: 8 }}
          barGap={BAR_GAP}
        >
          <CartesianGrid {...CHART_GRID} vertical={false} />
          {/*
            EVERY COMPARISON IS LABELLED, AND THE LABELS ARE ANGLED.
            `interval={0}` keeps all seven — dropping every other tick on a
            categorical axis leaves bars a reader cannot name, which is worse
            than a tilt. At seven windows the horizontal labels collided
            ("Last 3 Months" over "Last 6 Months"), so they lean instead and the
            axis is given the height to hold them.
          */}
          <XAxis
            dataKey="window"
            {...CHART_AXIS}
            interval={0}
            angle={-30}
            textAnchor="end"
            height={64}
            tickMargin={4}
          />
          <YAxis
            {...CHART_AXIS}
            width={64}
            tickFormatter={(value: number) => formatMetricValue(value, unit, { compact: true })}
          />
          <Tooltip
            cursor={{ fill: "var(--surface-muted)" }}
            content={<ComparisonTooltip unit={unit} />}
          />
          {/* Comparison first, so it reads behind the current figure. */}
          {anyBaseline ? (
            <Bar
              dataKey="baseline"
              name="Comparison"
              fill={SERIES_BASELINE}
              radius={[4, 4, 0, 0]}
              maxBarSize={28}
            />
          ) : null}
          <Bar
            dataKey="current"
            name="Current"
            fill={SERIES_CURRENT}
            radius={[4, 4, 0, 0]}
            maxBarSize={28}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

interface TooltipRow {
  payload?: {
    window?: string;
    current?: number | null;
    baseline?: number | null;
    currentLabel?: string;
    baselineLabel?: string | null;
  };
}

/**
 * The tooltip names each side with ITS OWN heading.
 *
 * Which is why the headings travel in the row rather than being props: `2026`
 * against `2024` on a year comparison, and `Current year, last 3 months`
 * against `Prior year, last 3 months` on a trailing one. One pair of labels for
 * the whole chart would be wrong on at least one of its bars.
 */
function ComparisonTooltip({
  active,
  payload,
  unit,
}: {
  active?: boolean;
  payload?: TooltipRow[];
  unit: ReportMetricUnit;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;

  return (
    <div className="rounded-[var(--radius-sm)] border border-border bg-surface px-2.5 py-2 text-xs shadow-float">
      <p className="font-medium text-foreground">{row.window}</p>
      <dl className="mt-1 space-y-0.5">
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">{row.currentLabel}</dt>
          <dd className="tabular-nums text-foreground">
            {row.current === null || row.current === undefined
              ? "Unavailable"
              : formatMetricValue(row.current, unit)}
          </dd>
        </div>
        {row.baselineLabel ? (
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">{row.baselineLabel}</dt>
            <dd className="tabular-nums text-foreground">
              {/* Absent, not zero. */}
              {row.baseline === null || row.baseline === undefined
                ? "Unavailable"
                : formatMetricValue(row.baseline, unit)}
            </dd>
          </div>
        ) : null}
      </dl>
    </div>
  );
}
