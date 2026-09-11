"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  AXIS_PROPS,
  CHART_COLORS,
  ChartFrame,
  ChartTooltip,
  GRID_PROPS,
} from "@/features/reports/chart-kit";
import { ROLE_LABEL } from "@/lib/permissions";
import { formatDate } from "@/lib/utils/date";
import type { BreakdownRow, TrendPoint } from "@/lib/analytics/queries";
import type { Role } from "@/types";

/**
 * THE TWO CHARTS ON THE OVERVIEW.
 *
 * COLOUR COMES FROM `CHART_COLORS` AND NOWHERE ELSE. The reference screenshots
 * carry a different bar colour per row — pink, orange, purple, blue — and this
 * system forbids exactly that: rank and category never change a fill, because a
 * colour that varies with position encodes nothing and spends the vocabulary
 * that flags a real problem. Every bar here is the coral data fill on its track.
 *
 * No yellow anywhere. At 1.47:1 on a light ground it cannot carry a value, and
 * it is spoken for by the chrome.
 */

export function UsageTrendChart({
  points,
  bucket,
}: {
  points: TrendPoint[];
  bucket: "day" | "week" | "month";
}) {
  const unit = bucket === "day" ? "day" : bucket === "week" ? "week" : "month";

  return (
    <ChartFrame
      title="Usage over time"
      description={`Recorded activity per ${unit}. Is adoption rising or falling?`}
      height={260}
    >
      {points.length === 0 ? (
        <ChartEmpty note="No activity was recorded in this window." />
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
            <defs>
              <linearGradient id="analytics-usage" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={CHART_COLORS.primary} stopOpacity={0.28} />
                <stop offset="100%" stopColor={CHART_COLORS.primary} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid {...GRID_PROPS} />
            <XAxis
              {...AXIS_PROPS}
              dataKey="date"
              tickFormatter={(value: string) => formatDate(value)}
              minTickGap={24}
            />
            <YAxis {...AXIS_PROPS} allowDecimals={false} width={44} />
            <RechartsTooltip
              content={<ChartTooltip />}
              labelFormatter={(value) => formatDate(String(value))}
            />
            <Area
              type="monotone"
              dataKey="events"
              name="Activity"
              stroke={CHART_COLORS.primary}
              strokeWidth={2}
              fill="url(#analytics-usage)"
            />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </ChartFrame>
  );
}

export function UsageByRoleChart({ rows }: { rows: BreakdownRow[] }) {
  /*
   * ROLES COME FROM THE DATA, NEVER FROM A HARD-CODED LIST. The reference
   * dashboard names four fixed roles; this estate has its own set and a role
   * nobody holds must not appear as an empty bar implying a silent group.
   */
  const data = rows.map((row) => ({
    ...row,
    label: ROLE_LABEL[row.key as Role] ?? row.key,
  }));

  return (
    <ChartFrame
      title="Usage by role"
      description="Who is asking, by the role their account holds."
      height={260}
    >
      {data.length === 0 ? (
        <ChartEmpty note="No attributed activity in this window." />
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            layout="vertical"
            margin={{ top: 4, right: 16, bottom: 0, left: 8 }}
          >
            <CartesianGrid {...GRID_PROPS} horizontal={false} vertical />
            <XAxis {...AXIS_PROPS} type="number" allowDecimals={false} />
            <YAxis
              {...AXIS_PROPS}
              type="category"
              dataKey="label"
              width={132}
              tick={{ ...AXIS_PROPS.tick, fontSize: 11 }}
            />
            <RechartsTooltip content={<ChartTooltip />} cursor={false} />
            <Bar
              dataKey="events"
              name="Activity"
              fill={CHART_COLORS.primary}
              radius={[0, 4, 4, 0]}
              maxBarSize={22}
            />
          </BarChart>
        </ResponsiveContainer>
      )}
    </ChartFrame>
  );
}

/**
 * An empty chart says why it is empty.
 *
 * A blank plotting area is indistinguishable from a chart that failed to load,
 * and on a dashboard whose whole subject is "is anybody using this", an empty
 * state is a finding rather than a fault.
 */
function ChartEmpty({ note }: { note: string }) {
  return (
    <div className="flex h-full items-center justify-center">
      <p className="text-[12px] text-muted-foreground">{note}</p>
    </div>
  );
}
