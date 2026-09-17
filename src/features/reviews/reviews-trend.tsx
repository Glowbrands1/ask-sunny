"use client";

import { useRouter } from "next/navigation";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";

import { reviewsHref, type ReviewFilters } from "@/lib/reviews/filters";
import type { WeeklyTrendPoint } from "@/lib/reviews/types";
import { formatNumber } from "@/lib/utils/format";
import { AXIS_PROPS, CHART_COLORS, ChartFrame, ChartTooltip, GRID_PROPS } from "../reports/chart-kit";

/**
 * TWELVE WEEKS, STACKED, AND EVERY COLUMN IS A DRILL-DOWN.
 *
 * ============================================================================
 * WHY THE STACK IS QUALIFYING PLUS CRITICAL RATHER THAN ONE TOTAL
 * ============================================================================
 *
 * A single "reviews gained" bar answers the wrong question. The official weekly
 * number counts 3, 4 and 5 stars; the 1s and 2s are real reviews that arrived
 * in the same week, are worked in the same queue, and are NOT in that number. A
 * stack shows both facts at once — the official figure is the lower segment, and
 * the difference between the column and the segment is the work the week also
 * brought.
 *
 * BARS RATHER THAN AN AREA, for the reason the previous screen recorded: twelve
 * weekly counts are twelve measurements, and a smoothed curve draws values
 * between them that were never recorded.
 *
 * CLICKING A COLUMN FILTERS THE FEED TO THAT WEEK. It is the same mechanism
 * every other figure on the page uses — a URL with the same filter vocabulary —
 * so the reviews a column opens are the reviews it counted.
 */
export function ReviewsTrend({
  trend,
  filters,
}: {
  trend: WeeklyTrendPoint[];
  filters: ReviewFilters;
}) {
  const router = useRouter();

  const openWeek = (weekStart: string | undefined) => {
    if (!weekStart) return;
    router.push(reviewsHref({ ...filters, week: weekStart, openReviewId: null }));
  };

  const total = trend.reduce((sum, point) => sum + point.all, 0);

  return (
    <ChartFrame
      title="Reviews by week, twelve weeks"
      description={
        total === 0
          ? "Nothing ingested in the last twelve weeks yet. A column appears for each week once reviews are synced."
          : "The lower segment is the official weekly count (3–5 stars). The upper segment is the 1- and 2-star reviews that arrived the same week and do not raise it. Select a column to see that week's reviews."
      }
      height={260}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={trend}
          margin={{ top: 14, right: 8, bottom: 0, left: 0 }}
          onClick={(state) => {
            /*
             * Recharts does not type `activePayload` on its click handler even
             * though it is what the handler is for, so the shape is narrowed
             * here rather than trusted. An index that does not resolve to a
             * point is ignored, which is what a click on the chart's margin is.
             */
            const index = (state as { activeTooltipIndex?: number } | undefined)
              ?.activeTooltipIndex;
            if (typeof index !== "number") return;
            openWeek(trend[index]?.weekStart);
          }}
        >
          <CartesianGrid {...GRID_PROPS} />
          <XAxis dataKey="label" {...AXIS_PROPS} interval="preserveStartEnd" />
          <YAxis {...AXIS_PROPS} width={36} allowDecimals={false} />
          <RechartsTooltip
            cursor={{ fill: "var(--surface-muted)" }}
            content={<ChartTooltip formatter={(value) => formatNumber(value)} />}
          />
          <Legend
            verticalAlign="top"
            align="right"
            iconType="square"
            wrapperStyle={{ fontSize: 10, paddingBottom: 6 }}
          />
          <Bar
            dataKey="qualifying"
            stackId="week"
            name="Counts toward weekly total"
            fill={CHART_COLORS.primary}
            radius={[0, 0, 0, 0]}
            maxBarSize={44}
            cursor="pointer"
          />
          <Bar
            dataKey="critical"
            stackId="week"
            name="1–2 stars (does not count)"
            fill={CHART_COLORS.benchmark}
            radius={[4, 4, 0, 0]}
            maxBarSize={44}
            cursor="pointer"
          />
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
