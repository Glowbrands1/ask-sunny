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
 */

const BAND_FILL: Record<PerformanceBand, string> = {
  outperforming: "var(--status-ready)",
  at_market: "var(--stc-warm-tan-deep)",
  below_market: "var(--status-attention)",
  significantly_underperforming: "var(--status-failed)",
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

export function RankedBarChart({
  rows,
  valueLabel,
  formatValue,
  /** A benchmark line, e.g. the chain average or the estate rate. */
  reference,
  emptyMessage = "No salon reported this measure for the selected period.",
  className,
}: {
  rows: readonly RankedRow[];
  valueLabel: string;
  formatValue: (value: number) => string;
  reference?: { value: number; label: string } | null;
  emptyMessage?: string;
  className?: string;
}) {
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
              stroke="var(--stc-slate-deep)"
              strokeDasharray="4 3"
              label={{
                value: reference.label,
                position: "insideTopRight",
                fill: "var(--muted-foreground)",
                fontSize: 10,
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
