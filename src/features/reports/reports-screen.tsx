"use client";

import Link from "next/link";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ArrowUpRight, BarChart3, Info, Star } from "lucide-react";

import { StatCardGrid } from "@/components/stat-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress, Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/controls";
import { DemoDataNote, Notice } from "@/components/ui/feedback";
import { PageHeader, PageShell, ScrollTable, SectionHeader } from "@/components/ui/layout";
import {
  COACHING_BY_DISTRICT,
  CONVERSION_SERIES,
  DAILY_STATS_METRICS,
  DAILY_TRAFFIC_SERIES,
  MEMBERSHIP_METRICS,
  MEMBERSHIP_MIX,
  MEMBERSHIP_TREND,
  PEOPLE_METRICS,
  REVENUE_SERIES,
  SALES_METRICS,
  SALON_PERFORMANCE,
} from "@/data/demo/reports";
import { DEMO_REVIEW_METRICS, DEMO_REVIEW_TREND } from "@/data/demo/reviews";
import { formatCompactNumber, formatCurrency, formatNumber } from "@/lib/utils/format";
import {
  AXIS_PROPS,
  CHART_COLORS,
  ChartFrame,
  ChartLegend,
  ChartTooltip,
  GRID_PROPS,
} from "./chart-kit";

export function ReportsScreen() {
  return (
    <PageShell>
      <PageHeader
        eyebrow="Insights"
        title="Reports & Analytics"
        description="Daily Stats, salon performance, sales, memberships, people and reviews — read where the work happens instead of across five systems."
      />

      <Tabs defaultValue="daily">
        <TabsList>
          <TabsTrigger value="daily">Daily Stats</TabsTrigger>
          <TabsTrigger value="salons">Salon Performance</TabsTrigger>
          <TabsTrigger value="sales">Sales</TabsTrigger>
          <TabsTrigger value="memberships">Memberships</TabsTrigger>
          <TabsTrigger value="people">Coaching / People</TabsTrigger>
          <TabsTrigger value="reviews">Google Reviews</TabsTrigger>
        </TabsList>

        {/* Daily Stats */}
        <TabsContent value="daily">
          <StatCardGrid metrics={DAILY_STATS_METRICS} className="mb-5" />

          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            <ChartFrame
              title="Guests served"
              description="This week against the same weekday last week."
              action={
                <ChartLegend
                  items={[
                    { label: "This week", color: CHART_COLORS.primary },
                    { label: "Last week", color: CHART_COLORS.muted },
                  ]}
                />
              }
            >
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={DAILY_TRAFFIC_SERIES} barGap={4}>
                  <CartesianGrid {...GRID_PROPS} />
                  <XAxis dataKey="label" {...AXIS_PROPS} />
                  <YAxis {...AXIS_PROPS} width={38} />
                  <RechartsTooltip
                    cursor={{ fill: "var(--surface-muted)" }}
                    content={<ChartTooltip formatter={(value) => formatNumber(value)} />}
                  />
                  <Bar
                    dataKey="lastWeek"
                    name="Last week"
                    fill={CHART_COLORS.muted}
                    radius={[4, 4, 0, 0]}
                    maxBarSize={22}
                  />
                  <Bar
                    dataKey="guests"
                    name="This week"
                    fill={CHART_COLORS.primary}
                    radius={[4, 4, 0, 0]}
                    maxBarSize={22}
                  />
                </BarChart>
              </ResponsiveContainer>
            </ChartFrame>

            <ChartFrame
              title="Membership conversion"
              description="Eight-week trend against the 25% target."
              action={
                <ChartLegend
                  items={[
                    { label: "Conversion", color: CHART_COLORS.accent },
                    { label: "Target", color: CHART_COLORS.muted },
                  ]}
                />
              }
            >
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={CONVERSION_SERIES}>
                  <CartesianGrid {...GRID_PROPS} />
                  <XAxis dataKey="label" {...AXIS_PROPS} />
                  <YAxis
                    {...AXIS_PROPS}
                    width={40}
                    domain={[18, 30]}
                    tickFormatter={(value: number) => `${value}%`}
                  />
                  <RechartsTooltip
                    content={<ChartTooltip formatter={(value) => `${value.toFixed(1)}%`} />}
                  />
                  <Line
                    type="monotone"
                    dataKey="target"
                    name="Target"
                    stroke={CHART_COLORS.muted}
                    strokeDasharray="4 4"
                    strokeWidth={1.5}
                    dot={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="conversion"
                    name="Conversion"
                    stroke={CHART_COLORS.accent}
                    strokeWidth={2.5}
                    dot={{ r: 3, fill: CHART_COLORS.accent, strokeWidth: 0 }}
                    activeDot={{ r: 5 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </ChartFrame>
          </div>

          <PowerBiModule className="mt-5" />
          <DemoDataNote className="mt-4" />
        </TabsContent>

        {/* Salon performance */}
        <TabsContent value="salons">
          <SectionHeader
            title="Salon performance"
            description="Month to date, ranked by revenue."
          />

          <ChartFrame
            title="Revenue by salon"
            description="Month to date, all locations."
            height={360}
            className="mb-5"
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={SALON_PERFORMANCE}
                layout="vertical"
                margin={{ left: 8, right: 16 }}
              >
                <CartesianGrid {...GRID_PROPS} vertical horizontal={false} />
                <XAxis
                  type="number"
                  {...AXIS_PROPS}
                  tickFormatter={(value: number) => `$${formatCompactNumber(value)}`}
                />
                <YAxis
                  type="category"
                  dataKey="salon"
                  {...AXIS_PROPS}
                  width={140}
                  tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                />
                <RechartsTooltip
                  cursor={{ fill: "var(--surface-muted)" }}
                  content={<ChartTooltip formatter={(value) => formatCurrency(value, 0)} />}
                />
                <Bar dataKey="revenue" name="Revenue" radius={[0, 4, 4, 0]} maxBarSize={16}>
                  {SALON_PERFORMANCE.map((entry, index) => (
                    <Cell
                      key={entry.salon}
                      fill={index < 3 ? CHART_COLORS.primary : CHART_COLORS.muted}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartFrame>

          <ScrollTable>
            <table className="w-full min-w-[42rem] border-collapse text-left">
              <thead>
                <tr className="border-b border-border">
                  {["Salon", "District", "Revenue", "Conversion", "Avg ticket", "Guests"].map(
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
                {SALON_PERFORMANCE.map((row) => (
                  <tr key={row.salon} className="border-b border-border last:border-0">
                    <td className="px-4 py-3 text-[13px] font-medium text-foreground">
                      {row.salon}
                    </td>
                    <td className="px-4 py-3 text-[13px] text-muted-foreground">
                      {row.district}
                    </td>
                    <td className="px-4 py-3 text-[13px] text-foreground tabular-nums">
                      {formatCurrency(row.revenue, 0)}
                    </td>
                    <td className="px-4 py-3 text-[13px] text-foreground tabular-nums">
                      {row.conversion.toFixed(1)}%
                    </td>
                    <td className="px-4 py-3 text-[13px] text-foreground tabular-nums">
                      {formatCurrency(row.ticket)}
                    </td>
                    <td className="px-4 py-3 text-[13px] text-foreground tabular-nums">
                      {formatNumber(row.guests)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollTable>
          <DemoDataNote className="mt-4" />
        </TabsContent>

        {/* Sales */}
        <TabsContent value="sales">
          <StatCardGrid metrics={SALES_METRICS} className="mb-5" />

          <ChartFrame
            title="Revenue and product attachment"
            description="Six-month trend across all salons."
            height={320}
            action={
              <ChartLegend
                items={[
                  { label: "Total revenue", color: CHART_COLORS.primary },
                  { label: "Product revenue", color: CHART_COLORS.accent },
                ]}
              />
            }
          >
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={REVENUE_SERIES}>
                <CartesianGrid {...GRID_PROPS} />
                <XAxis dataKey="label" {...AXIS_PROPS} />
                <YAxis
                  {...AXIS_PROPS}
                  width={52}
                  tickFormatter={(value: number) => `$${formatCompactNumber(value)}`}
                />
                <RechartsTooltip
                  content={<ChartTooltip formatter={(value) => formatCurrency(value, 0)} />}
                />
                <Area
                  type="monotone"
                  dataKey="revenue"
                  name="Total revenue"
                  stroke={CHART_COLORS.primary}
                  strokeWidth={2}
                  fill={CHART_COLORS.primary}
                  fillOpacity={0.09}
                />
                <Area
                  type="monotone"
                  dataKey="product"
                  name="Product revenue"
                  stroke={CHART_COLORS.accent}
                  strokeWidth={2}
                  fill={CHART_COLORS.accent}
                  fillOpacity={0.1}
                />
              </AreaChart>
            </ResponsiveContainer>
          </ChartFrame>
          <DemoDataNote className="mt-4" />
        </TabsContent>

        {/* Memberships */}
        <TabsContent value="memberships">
          <StatCardGrid metrics={MEMBERSHIP_METRICS} className="mb-5" />

          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            <ChartFrame title="Membership mix" description="Active members by tier.">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={MEMBERSHIP_MIX}>
                  <CartesianGrid {...GRID_PROPS} />
                  <XAxis dataKey="label" {...AXIS_PROPS} />
                  <YAxis
                    {...AXIS_PROPS}
                    width={44}
                    tickFormatter={(value: number) => formatCompactNumber(value)}
                  />
                  <RechartsTooltip
                    cursor={{ fill: "var(--surface-muted)" }}
                    content={<ChartTooltip formatter={(value) => formatNumber(value)} />}
                  />
                  <Bar
                    dataKey="members"
                    name="Members"
                    fill={CHART_COLORS.primary}
                    radius={[4, 4, 0, 0]}
                    maxBarSize={48}
                  />
                </BarChart>
              </ResponsiveContainer>
            </ChartFrame>

            <ChartFrame
              title="Joins and cancellations"
              description="Six-month trend."
              action={
                <ChartLegend
                  items={[
                    { label: "Joined", color: CHART_COLORS.accent },
                    { label: "Cancelled", color: CHART_COLORS.slate },
                  ]}
                />
              }
            >
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={MEMBERSHIP_TREND} barGap={4}>
                  <CartesianGrid {...GRID_PROPS} />
                  <XAxis dataKey="label" {...AXIS_PROPS} />
                  <YAxis {...AXIS_PROPS} width={44} />
                  <RechartsTooltip
                    cursor={{ fill: "var(--surface-muted)" }}
                    content={<ChartTooltip formatter={(value) => formatNumber(value)} />}
                  />
                  <Bar
                    dataKey="joined"
                    name="Joined"
                    fill={CHART_COLORS.accent}
                    radius={[4, 4, 0, 0]}
                    maxBarSize={20}
                  />
                  <Bar
                    dataKey="cancelled"
                    name="Cancelled"
                    fill={CHART_COLORS.slate}
                    radius={[4, 4, 0, 0]}
                    maxBarSize={20}
                  />
                </BarChart>
              </ResponsiveContainer>
            </ChartFrame>
          </div>
          <DemoDataNote className="mt-4" />
        </TabsContent>

        {/* People */}
        <TabsContent value="people">
          <StatCardGrid metrics={PEOPLE_METRICS} className="mb-5" />

          <ChartFrame
            title="Coaching activity by district"
            description="Documented conversations this month and follow-ups completed."
            action={
              <ChartLegend
                items={[
                  { label: "Coaching conversations", color: CHART_COLORS.primary },
                  { label: "Follow-ups completed", color: CHART_COLORS.accent },
                ]}
              />
            }
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={COACHING_BY_DISTRICT} barGap={4}>
                <CartesianGrid {...GRID_PROPS} />
                <XAxis dataKey="label" {...AXIS_PROPS} />
                <YAxis {...AXIS_PROPS} width={34} />
                <RechartsTooltip
                  cursor={{ fill: "var(--surface-muted)" }}
                  content={<ChartTooltip formatter={(value) => formatNumber(value)} />}
                />
                <Bar
                  dataKey="coaching"
                  name="Coaching conversations"
                  fill={CHART_COLORS.primary}
                  radius={[4, 4, 0, 0]}
                  maxBarSize={30}
                />
                <Bar
                  dataKey="followUps"
                  name="Follow-ups completed"
                  fill={CHART_COLORS.accent}
                  radius={[4, 4, 0, 0]}
                  maxBarSize={30}
                />
              </BarChart>
            </ResponsiveContainer>
          </ChartFrame>
          <DemoDataNote className="mt-4" />
        </TabsContent>

        {/* Reviews summary */}
        <TabsContent value="reviews">
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            <ChartFrame
              title="Reviews gained"
              description="Twelve-week trend across all salons — the number counted by hand today."
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

            <Card>
              <CardContent className="p-5">
                <SectionHeader
                  title="This week"
                  description="Salons furthest from goal."
                  actions={
                    <Button asChild variant="ghost" size="sm">
                      <Link href="/reviews">
                        <Star />
                        Open
                      </Link>
                    </Button>
                  }
                />
                <ul className="space-y-3">
                  {[...DEMO_REVIEW_METRICS]
                    .sort(
                      (a, b) =>
                        a.reviewsGainedThisWeek / a.weeklyGoal -
                        b.reviewsGainedThisWeek / b.weeklyGoal,
                    )
                    .slice(0, 5)
                    .map((metric) => (
                      <li key={metric.locationId}>
                        <div className="mb-1.5 flex items-center justify-between gap-3">
                          <span className="truncate text-[13px] font-medium text-foreground">
                            {metric.locationName}
                          </span>
                          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                            {metric.reviewsGainedThisWeek} / {metric.weeklyGoal}
                          </span>
                        </div>
                        <Progress
                          value={(metric.reviewsGainedThisWeek / metric.weeklyGoal) * 100}
                          tone={
                            metric.reviewsGainedThisWeek / metric.weeklyGoal < 0.5
                              ? "attention"
                              : "accent"
                          }
                          label={`${metric.locationName} weekly review goal`}
                        />
                      </li>
                    ))}
                </ul>
              </CardContent>
            </Card>
          </div>
          <DemoDataNote className="mt-4" />
        </TabsContent>
      </Tabs>
    </PageShell>
  );
}

/** Power BI module card — an honest placeholder, not a fake embed. */
export function PowerBiModule({ className }: { className?: string }) {
  return (
    <Card className={className}>
      <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-surface-muted text-muted-foreground">
          <BarChart3 className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[15px] font-semibold text-foreground">
              Power BI reporting
            </h3>
            <Badge tone="neutral" size="sm">
              Not connected
            </Badge>
          </div>
          <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
            Connect your existing Power BI dashboards to view reporting directly
            inside Ask Sunny — no more bouncing between systems to read the same
            numbers.
          </p>
        </div>
        <Button asChild variant="secondary" className="shrink-0">
          <Link href="/admin/integrations">
            Configure integration
            <ArrowUpRight />
          </Link>
        </Button>
      </CardContent>
      <Notice tone="neutral" icon={<Info />} className="mx-5 mb-5">
        Reports arrive as Excel files today. Embedding needs a Power BI workspace
        and Microsoft access — nothing is connected in this prototype.
      </Notice>
    </Card>
  );
}
