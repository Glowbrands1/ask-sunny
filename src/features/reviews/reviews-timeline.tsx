"use client";

import { useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";

import { SegmentedControl } from "@/components/ui/controls";
import {
  DEFAULT_TIMELINE_GRANULARITY,
  MAX_MONTHLY_BUCKETS,
  MAX_WEEKLY_BUCKETS,
  TIMELINE_GRANULARITIES,
  type ReviewTimeline,
  type TimelineGranularity,
  type TimelinePoint,
} from "@/lib/reviews/timeline";
import { formatNumber } from "@/lib/utils/format";
import { AXIS_PROPS, CHART_COLORS, ChartFrame, GRID_PROPS } from "../reports/chart-kit";

/**
 * ============================================================================
 * GOOGLE REVIEWS OVER TIME — the volume question, answered from the records
 * ============================================================================
 *
 * "How many Google reviews are we receiving?" is a different question from
 * "what counted toward last week's total", and the page now asks both rather
 * than letting one stand in for the other:
 *
 *   THE TWELVE-WEEK TREND reads the reporting periods. It is the official
 *   figure, and it is empty until a salon's baseline is set — correctly, and by
 *   design.
 *
 *   THIS READS THE REVIEWS THEMSELVES. It is true the moment a review is
 *   stored, it depends on no baseline, and it must never be read as a weekly
 *   total. The caption says so, in those words, every time it renders.
 *
 * ============================================================================
 * WEEKLY AND MONTHLY ARE ONE SET OF RECORDS SEEN TWO WAYS
 * ============================================================================
 *
 * Both series are built on the server in one pass over the same reviews, and
 * both arrive with the page. The toggle is therefore local state and costs no
 * round trip — and, more importantly, the two views cannot be counting
 * different sets of reviews, which is what a second query for "the monthly one"
 * eventually produces.
 *
 * THE FILTERS BELONG TO THE URL AND THE GRANULARITY DOES NOT. Location and
 * rating change WHICH REVIEWS are being counted, so they are part of the view
 * somebody sends; weekly-versus-monthly changes only how the same answer is
 * drawn. Keeping the second out of the URL is what stops a shared link from
 * carrying a reader's zoom level as though it were a filter.
 *
 * BARS RATHER THAN A LINE, for the reason the twelve-week trend already
 * records: these are discrete counts per bucket, and a smoothed curve would
 * draw values between them that were never recorded.
 */
export function ReviewsTimeline({
  timeline,
  scope,
  className,
}: {
  timeline: ReviewTimeline & { truncated: boolean };
  /** What the current filters have narrowed this to, for the caption. */
  scope?: string | null;
  className?: string;
}) {
  const [granularity, setGranularity] = useState<TimelineGranularity>(
    DEFAULT_TIMELINE_GRANULARITY,
  );

  const points: TimelinePoint[] =
    granularity === "monthly" ? timeline.monthly : timeline.weekly;
  const trimmed =
    granularity === "monthly" ? timeline.monthlyTrimmed : timeline.weeklyTrimmed;

  return (
    <ChartFrame
      title="Google Reviews Over Time"
      description={describe(timeline, granularity, trimmed, scope)}
      height={248}
      className={className}
      action={
        <SegmentedControl
          ariaLabel="Chart period"
          value={granularity}
          onValueChange={(next) => setGranularity(next as TimelineGranularity)}
          options={TIMELINE_GRANULARITIES.map((entry) => ({
            value: entry.key,
            label: entry.label,
          }))}
        />
      }
    >
      {points.length === 0 ? (
        /*
          AN EMPTY CHART IS A SENTENCE, NOT AN EMPTY CANVAS. The screen this
          replaced drew a full-height axis with nothing on it, which reads as a
          broken chart rather than as "nothing has been synced".
        */
        <div className="grid h-full place-items-center rounded-[var(--radius-md)] border border-dashed border-border bg-surface-muted/60 px-6 text-center">
          <p className="max-w-md text-[12px] text-muted-foreground">
            No Google review matches the current filters, so there is nothing to
            plot. A bar appears for every {granularity === "monthly" ? "month" : "week"}{" "}
            once reviews are synced.
          </p>
        </div>
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid {...GRID_PROPS} />
            <XAxis dataKey="label" {...AXIS_PROPS} interval="preserveStartEnd" minTickGap={12} />
            <YAxis {...AXIS_PROPS} width={34} allowDecimals={false} />
            <RechartsTooltip
              cursor={{ fill: "var(--surface-muted)" }}
              content={<TimelineTooltip />}
            />
            <Bar
              dataKey="reviews"
              name="Reviews"
              fill={CHART_COLORS.primary}
              radius={[4, 4, 0, 0]}
              maxBarSize={42}
            />
          </BarChart>
        </ResponsiveContainer>
      )}
    </ChartFrame>
  );
}

/**
 * The caption, which has four jobs and does them in this order: say what is
 * being counted, say it is not the weekly total, say what narrowed it, and say
 * how the reviews were dated when the answer is not simply "Google told us".
 */
function describe(
  timeline: ReviewTimeline & { truncated: boolean },
  granularity: TimelineGranularity,
  trimmed: boolean,
  scope?: string | null,
): string {
  const bucket = granularity === "monthly" ? "month" : "reporting week";
  const parts = [
    `Google reviews received per ${bucket}${scope ? ` at ${scope}` : ""}, counted from the review records.`,
    "This is volume, not the official weekly count — that counts from each salon's baseline.",
  ];

  if (trimmed) {
    parts.push(
      granularity === "monthly"
        ? `Showing the most recent ${MAX_MONTHLY_BUCKETS} months.`
        : `Showing the most recent ${MAX_WEEKLY_BUCKETS} weeks.`,
    );
  }

  if (timeline.truncated) {
    parts.push(`Built from the most recent ${formatNumber(timeline.counted)} reviews.`);
  }

  /*
   * THE DATING IS DECLARED WHENEVER IT IS NOT GOOGLE'S OWN. Google's Business
   * Profile page gives relative wording rather than timestamps, so a review can
   * be placed by an estimate read from that wording, or — when Google gave
   * nothing at all — by the day ASK Sunny first saw it. Both are real answers
   * and neither is a review date, so the caption names them rather than letting
   * a bar imply a precision the record does not have.
   */
  const { google_estimated: estimated, first_seen: firstSeen } = timeline.bySource;
  if (estimated + firstSeen > 0 && timeline.counted > 0) {
    const notes: string[] = [];
    if (estimated > 0) notes.push(`by Google's relative wording (${formatNumber(estimated)})`);
    if (firstSeen > 0) {
      notes.push(`by the day ASK Sunny first saw them (${formatNumber(firstSeen)})`);
    }
    parts.push(
      `Google published a date for ${formatNumber(timeline.bySource.google_absolute)}; the rest are placed ${notes.join(" or ")}.`,
    );
  }

  return parts.join(" ");
}

/** The bucket's full range and its count. One series, so one row. */
function TimelineTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload?: TimelinePoint }[];
}) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;

  return (
    <div className="rounded-[var(--radius-sm)] border border-border bg-surface px-3 py-2 shadow-float">
      <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
        {point.range}
      </p>
      <p className="mt-1 flex items-center gap-2 text-[13px]">
        <span
          aria-hidden
          className="size-2 shrink-0 rounded-full"
          style={{ backgroundColor: CHART_COLORS.primary }}
        />
        <span className="text-muted-foreground">
          {point.reviews === 1 ? "review" : "reviews"}
        </span>
        <span className="ml-auto font-bold text-foreground tabular-nums">
          {formatNumber(point.reviews)}
        </span>
      </p>
    </div>
  );
}
