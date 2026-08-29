"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ArrowUpRight, Clock, Info, MessageSquare, Star, TriangleAlert } from "lucide-react";

import { Badge, StatusDot } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/controls";
import { Select } from "@/components/ui/field";
import { DemoDataNote, Notice } from "@/components/ui/feedback";
import { PageHeader, PageShell, ScrollTable, SectionHeader } from "@/components/ui/layout";
import {
  DEMO_CUSTOMER_REVIEWS,
  DEMO_REVIEW_METRICS,
  DEMO_REVIEW_TREND,
  reviewGoalProgress,
} from "@/data/demo/reviews";
import { cn } from "@/lib/utils/cn";
import { relativeTime } from "@/lib/utils/date";
import { formatNumber } from "@/lib/utils/format";
import {
  AXIS_PROPS,
  CHART_COLORS,
  ChartFrame,
  ChartTooltip,
  GRID_PROPS,
} from "../reports/chart-kit";

export function ReviewsScreen() {
  const searchParams = useSearchParams();
  const [districtFilter, setDistrictFilter] = useState("all");

  // Deep link (?location=…) highlights a row. Derived, never copied into state.
  const highlightId = searchParams.get("location");

  const districts = useMemo(
    () => Array.from(new Set(DEMO_REVIEW_METRICS.map((m) => m.districtName))).sort(),
    [],
  );

  const metrics = useMemo(
    () =>
      DEMO_REVIEW_METRICS.filter((metric) =>
        districtFilter === "all" ? true : metric.districtName === districtFilter,
      ),
    [districtFilter],
  );

  const totals = useMemo(() => {
    const total = metrics.reduce((sum, m) => sum + m.totalReviews, 0);
    const gained = metrics.reduce((sum, m) => sum + m.reviewsGainedThisWeek, 0);
    const lastWeek = metrics.reduce((sum, m) => sum + m.reviewsGainedLastWeek, 0);
    const goal = metrics.reduce((sum, m) => sum + m.weeklyGoal, 0);
    const rating =
      metrics.reduce((sum, m) => sum + m.averageRating, 0) / (metrics.length || 1);
    return { total, gained, lastWeek, goal, rating, change: gained - lastWeek };
  }, [metrics]);

  const attention = metrics.filter(
    (metric) => reviewGoalProgress(metric) < 60 || metric.averageRating < 4.5,
  );

  const reviews = DEMO_CUSTOMER_REVIEWS.filter((review) =>
    districtFilter === "all"
      ? true
      : metrics.some((metric) => metric.locationId === review.locationId),
  );

  return (
    <PageShell>
      <PageHeader
        eyebrow="Insights"
        title="Google Reviews"
        description="The weekly review count, calculated. Nobody opens twelve Google listings and does subtraction any more."
        actions={
          <Select
            value={districtFilter}
            onChange={(event) => setDistrictFilter(event.target.value)}
            aria-label="Filter by district"
            className="sm:w-56"
          >
            <option value="all">All districts</option>
            {districts.map((district) => (
              <option key={district} value={district}>
                {district}
              </option>
            ))}
          </Select>
        }
      />

      {/* Hero metric */}
      <div className="mb-5 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <div className="rounded-[var(--radius-lg)] border border-[color-mix(in_srgb,var(--gold)_38%,transparent)] bg-gold-soft p-6 shadow-soft">
          <p className="eyebrow text-gold-deep">Reviews gained this week</p>
          <p className="mt-3 text-[46px] leading-none font-semibold tracking-tight text-foreground tabular-nums">
            +{formatNumber(totals.gained)}
          </p>
          <p className="mt-2.5 text-[13px] text-muted-foreground">
            {totals.change >= 0 ? "+" : ""}
            {totals.change} versus last week ·{" "}
            {districtFilter === "all" ? "all salons" : districtFilter}
          </p>
          <div className="mt-5">
            <div className="mb-1.5 flex items-center justify-between text-xs text-muted-foreground">
              <span>Combined weekly goal</span>
              <span className="tabular-nums">
                {totals.gained} / {totals.goal}
              </span>
            </div>
            <Progress
              value={(totals.gained / totals.goal) * 100}
              tone="primary"
              label="Combined weekly review goal"
            />
          </div>
          <p className="mt-4 text-xs leading-relaxed text-gold-deep">
            This is the number someone counts by hand every week today.
          </p>
        </div>

        <div className="rounded-[var(--radius-lg)] border border-border bg-surface p-6 shadow-soft">
          <p className="eyebrow">Total reviews</p>
          <p className="mt-3 text-[34px] leading-none font-semibold tracking-tight text-foreground tabular-nums">
            {formatNumber(totals.total)}
          </p>
          <p className="mt-2.5 text-[13px] text-muted-foreground">
            Across {metrics.length} salons
          </p>
          <div className="mt-6 border-t border-border pt-4">
            <p className="eyebrow">Average rating</p>
            <p className="mt-2 flex items-baseline gap-2">
              <span className="text-[26px] leading-none font-semibold text-foreground tabular-nums">
                {totals.rating.toFixed(2)}
              </span>
              <span className="flex items-center gap-0.5" aria-hidden>
                {Array.from({ length: 5 }).map((_, index) => (
                  <Star
                    key={index}
                    className={cn(
                      "size-3",
                      index < Math.round(totals.rating)
                        ? "fill-gold text-gold"
                        : "text-border-strong",
                    )}
                  />
                ))}
              </span>
            </p>
          </div>
        </div>

        <div className="rounded-[var(--radius-lg)] border border-border bg-surface p-6 shadow-soft">
          <div className="flex items-center gap-2">
            <TriangleAlert className="size-3.5 text-status-attention" aria-hidden />
            <p className="eyebrow">Locations needing attention</p>
          </div>
          <p className="mt-3 text-[34px] leading-none font-semibold tracking-tight text-foreground tabular-nums">
            {attention.length}
          </p>
          <p className="mt-2.5 text-[13px] text-muted-foreground">
            Below 60% of goal or under a 4.5 rating
          </p>
          <ul className="mt-4 space-y-1.5 border-t border-border pt-4">
            {attention.slice(0, 3).map((metric) => (
              <li
                key={metric.locationId}
                className="flex items-center justify-between gap-2 text-[13px]"
              >
                <span className="truncate text-foreground">{metric.locationName}</span>
                <Badge tone="attention" size="sm">
                  {metric.reviewsGainedThisWeek} / {metric.weeklyGoal}
                </Badge>
              </li>
            ))}
            {attention.length === 0 ? (
              <li className="text-[13px] text-muted-foreground">
                Every salon is tracking well this week.
              </li>
            ) : null}
          </ul>
        </div>
      </div>

      {/* Trend */}
      <ChartFrame
        title="Reviews gained, twelve weeks"
        description="The trend nobody can see when the count lives in a spreadsheet."
        className="mb-5"
        height={240}
      >
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={DEMO_REVIEW_TREND}>
            <CartesianGrid {...GRID_PROPS} />
            <XAxis dataKey="label" {...AXIS_PROPS} />
            <YAxis {...AXIS_PROPS} width={36} />
            <RechartsTooltip
              content={<ChartTooltip formatter={(value) => formatNumber(value)} />}
            />
            <Area
              type="monotone"
              dataKey="gained"
              name="Reviews gained"
              stroke={CHART_COLORS.gold}
              strokeWidth={2}
              fill={CHART_COLORS.gold}
              fillOpacity={0.12}
            />
          </AreaChart>
        </ResponsiveContainer>
      </ChartFrame>

      {/* Leaderboard */}
      <SectionHeader
        title="Salon leaderboard"
        description="This week, ranked by progress against goal."
      />
      <ScrollTable className="mb-6">
        <table className="w-full min-w-[46rem] border-collapse text-left">
          <thead>
            <tr className="border-b border-border">
              {["Salon", "Reviews this week", "Total", "Rating", "Goal", "Progress"].map(
                (heading) => (
                  <th
                    key={heading}
                    scope="col"
                    className="px-4 py-3 text-[11px] font-semibold tracking-[0.1em] text-muted-foreground uppercase"
                  >
                    {heading}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {[...metrics]
              .sort((a, b) => reviewGoalProgress(b) - reviewGoalProgress(a))
              .map((metric) => {
                const progress = reviewGoalProgress(metric);
                return (
                  <tr
                    key={metric.locationId}
                    className={cn(
                      "border-b border-border last:border-0",
                      highlightId === metric.locationId && "bg-primary-soft/40",
                    )}
                  >
                    <td className="px-4 py-3">
                      <p className="text-[13px] font-medium text-foreground">
                        {metric.locationName}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {metric.districtName}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-[13px] text-foreground tabular-nums">
                      +{metric.reviewsGainedThisWeek}
                      <span
                        className={cn(
                          "ml-2 text-xs",
                          metric.reviewsGainedThisWeek >= metric.reviewsGainedLastWeek
                            ? "text-status-ready"
                            : "text-status-attention",
                        )}
                      >
                        {metric.reviewsGainedThisWeek - metric.reviewsGainedLastWeek >= 0
                          ? "+"
                          : ""}
                        {metric.reviewsGainedThisWeek - metric.reviewsGainedLastWeek}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[13px] text-muted-foreground tabular-nums">
                      {formatNumber(metric.totalReviews)}
                    </td>
                    <td className="px-4 py-3 text-[13px] text-foreground tabular-nums">
                      {metric.averageRating.toFixed(1)}
                    </td>
                    <td className="px-4 py-3 text-[13px] text-muted-foreground tabular-nums">
                      {metric.weeklyGoal}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <Progress
                          value={progress}
                          tone={progress < 60 ? "attention" : "accent"}
                          className="w-24"
                          label={`${metric.locationName} goal progress`}
                        />
                        <span className="w-10 text-xs text-muted-foreground tabular-nums">
                          {progress}%
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </ScrollTable>

      {/* Recent reviews */}
      <SectionHeader
        title="Recent reviews"
        description="Newest first. Responding to a critical review matters more than the review itself."
      />
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {reviews.map((review) => (
          <Card key={review.id}>
            <CardContent className="p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="flex items-center gap-0.5" aria-hidden>
                    {Array.from({ length: 5 }).map((_, index) => (
                      <Star
                        key={index}
                        className={cn(
                          "size-3",
                          index < review.rating
                            ? "fill-gold text-gold"
                            : "text-border-strong",
                        )}
                      />
                    ))}
                  </span>
                  <span className="sr-only">{review.rating} out of 5 stars</span>
                  <span className="text-[13px] font-medium text-foreground">
                    {review.authorName}
                  </span>
                </div>
                <Badge tone={review.responded ? "ready" : "attention"} size="sm">
                  <StatusDot />
                  {review.responded ? "Responded" : "Needs a response"}
                </Badge>
              </div>
              <p className="mt-2.5 text-[13px] leading-relaxed text-muted-foreground">
                {review.text}
              </p>
              <p className="mt-3 flex items-center gap-2 text-xs text-subtle-foreground">
                <span>{review.locationName}</span>
                <span aria-hidden>·</span>
                <Clock className="size-3" aria-hidden />
                {relativeTime(review.postedAt)}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Notice tone="neutral" icon={<Info />} className="mt-6">
        <p className="font-semibold text-foreground">How this becomes automatic</p>
        <p className="mt-1">
          Connecting the Google Business Profile API pulls review counts and
          ratings for every location on a schedule, and &ldquo;reviews
          gained&rdquo; is simply the difference between two pulls. Nothing is
          scraped, and nothing is connected in this prototype — every figure here
          is demo data.
        </p>
      </Notice>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button asChild variant="secondary">
          <Link href="/admin/integrations">
            Set up Google Business Profile
            <ArrowUpRight />
          </Link>
        </Button>
        <Button asChild variant="ghost">
          <Link href="/chat?q=How%20do%20I%20ask%20a%20guest%20for%20a%20Google%20review%3F">
            <MessageSquare />
            Ask Sunny how to ask for reviews
          </Link>
        </Button>
      </div>

      <DemoDataNote className="mt-4" />
    </PageShell>
  );
}
