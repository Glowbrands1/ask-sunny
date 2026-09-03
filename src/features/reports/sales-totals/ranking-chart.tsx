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
import {
  BAR_GAP,
  BAR_RADIUS_HORIZONTAL,
  CHART_AXIS,
  CHART_GRID,
  SERIES_PRIMARY,
} from "@/features/reports/salon-performance/chart-palette";
import {
  salonAxisWidth,
  storeNameTicks,
} from "@/features/reports/salon-performance/chart-axis";

import { formatSalesTotalsCompact, formatSalesTotalsValue } from "./format";

export interface RankingRow {
  readonly salonNumber: string;
  readonly storeName: string;
  readonly value: number;
}

/**
 * ONE MEASURE ACROSS THE SALONS IN THIS DELIVERY.
 *
 * A RANKING, NOT A TREND, and the distinction is the same one the Salon
 * Performance charts make. One report date is one point in time. Two report
 * dates are two snapshots whose MTD windows overlap, so joining them with a
 * line would draw a progression that the source does not describe. When enough
 * daily snapshots accumulate, a true daily trend becomes possible — from the
 * `daily` window only, never from MTD — and it will be a new chart rather than
 * a line quietly added to this one.
 *
 * Reuses the Salon Performance axis helpers rather than reimplementing them:
 * the axis shows store names, the category stays the unique salon number, and
 * the width is measured from the longest name in view.
 */
export function SalesTotalsRankingChart({
  rows,
  metricLabel,
  unit,
  windowLabel,
  className,
}: {
  rows: readonly RankingRow[];
  metricLabel: string;
  unit: "currency" | "count";
  windowLabel: string;
  className?: string;
}) {
  if (rows.length === 0) {
    return (
      <p className={cn("py-8 text-center text-sm text-muted-foreground", className)}>
        No salon reported {metricLabel} for this date.
      </p>
    );
  }

  const height = Math.max(200, rows.length * 28 + 48);

  return (
    <div className={className} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={rows as RankingRow[]}
          layout="vertical"
          margin={{ top: 4, right: 76, bottom: 4, left: 8 }}
          barGap={BAR_GAP}
        >
          <CartesianGrid {...CHART_GRID} horizontal={false} />
          <XAxis
            type="number"
            {...CHART_AXIS}
            tickFormatter={(value: number) => formatSalesTotalsCompact(value, unit)}
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
              <RankingTooltip metricLabel={metricLabel} unit={unit} windowLabel={windowLabel} />
            }
          />
          <Bar
            dataKey="value"
            name={metricLabel}
            fill={SERIES_PRIMARY}
            radius={BAR_RADIUS_HORIZONTAL}
            maxBarSize={18}
            label={{
              position: "right",
              formatter: (label: unknown) =>
                typeof label === "number" ? formatSalesTotalsCompact(label, unit) : "",
              fill: "var(--muted-foreground)",
              fontSize: 11,
            }}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function RankingTooltip({
  active,
  payload,
  metricLabel,
  unit,
  windowLabel,
}: {
  active?: boolean;
  payload?: { payload?: RankingRow }[];
  metricLabel: string;
  unit: "currency" | "count";
  windowLabel: string;
}) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;

  return (
    <div className="rounded-lg border border-border bg-surface-raised px-3 py-2 text-xs shadow-md">
      {/* Number FIRST, then the name — the axis gives recognition, the tooltip
          gives identification. Same convention as Salon Performance. */}
      <p className="font-medium text-foreground">
        {row.salonNumber} · {row.storeName}
      </p>
      <dl className="mt-1.5 space-y-0.5">
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-muted-foreground">{metricLabel}</dt>
          <dd className="text-foreground">{formatSalesTotalsValue(row.value, unit)}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-muted-foreground">Window</dt>
          <dd className="text-foreground">{windowLabel}</dd>
        </div>
      </dl>
    </div>
  );
}
