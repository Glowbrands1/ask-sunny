"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ArrowUpRight, Info, RefreshCw, Sparkles } from "lucide-react";

import { Badge, StatusDot } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/controls";
import { DemoDataNote, Notice } from "@/components/ui/feedback";
import { PageHeader, PageShell, ScrollTable, SectionHeader } from "@/components/ui/layout";
import {
  AI_USAGE_BY_KEY,
  AI_USAGE_BY_MODEL,
  AI_USAGE_SERIES,
  DEMO_AI_USAGE,
  DEMO_AI_USAGE_RECORDS,
} from "@/data/demo/integrations";
import { PLATFORM_ACTIVITY, PLATFORM_ACTIVITY_SERIES } from "@/data/demo/reports";
import { formatDateTime, nowIso, relativeTime } from "@/lib/utils/date";
import { formatCompactNumber, formatCurrency, formatNumber } from "@/lib/utils/format";
import {
  AXIS_PROPS,
  CHART_COLORS,
  ChartFrame,
  ChartLegend,
  ChartTooltip,
  GRID_PROPS,
} from "../reports/chart-kit";

export function AIUsageScreen() {
  const [refreshedAt, setRefreshedAt] = useState(DEMO_AI_USAGE.lastRefreshedAt);
  const [refreshing, setRefreshing] = useState(false);

  const creditUsed =
    DEMO_AI_USAGE.creditPurchasedUsd - DEMO_AI_USAGE.remainingCreditUsd;
  const creditPercent =
    (DEMO_AI_USAGE.remainingCreditUsd / DEMO_AI_USAGE.creditPurchasedUsd) * 100;

  const handleRefresh = () => {
    setRefreshing(true);
    window.setTimeout(() => {
      setRefreshedAt(nowIso());
      setRefreshing(false);
    }, 700);
  };

  return (
    <PageShell>
      <PageHeader
        eyebrow="Admin"
        title="AI Usage"
        description="What the assistant costs to run, and how much credit is left — so it never runs out mid-week without warning."
        actions={
          <Button variant="secondary" onClick={handleRefresh} disabled={refreshing}>
            <RefreshCw className={refreshing ? "animate-spin" : undefined} />
            {refreshing ? "Refreshing…" : "Refresh"}
          </Button>
        }
      />

      {/* Provider */}
      <Card className="mb-5">
        <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-primary-soft text-primary-soft-foreground">
            <Sparkles className="size-5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[15px] font-semibold text-foreground">
                {DEMO_AI_USAGE.provider}
              </h2>
              <Badge tone="neutral" size="sm">
                <StatusDot />
                Not connected
              </Badge>
            </div>
            <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
              Ask Sunny will run on Claude. No API key is configured in this
              prototype, so every answer comes from the seeded demo provider and
              the figures below are illustrative.
            </p>
          </div>
          <Button asChild variant="secondary" className="shrink-0">
            <Link href="/admin/integrations">
              Connect
              <ArrowUpRight />
            </Link>
          </Button>
        </CardContent>
      </Card>

      {/* Spend cards */}
      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          {
            label: `Spend — ${DEMO_AI_USAGE.monthLabel}`,
            value: formatCurrency(DEMO_AI_USAGE.estimatedCostThisMonth),
            helper: `${formatNumber(DEMO_AI_USAGE.requestsThisMonth)} requests`,
          },
          {
            label: "Spend — last 30 days",
            value: formatCurrency(DEMO_AI_USAGE.estimatedCostLast30Days),
            helper: `${formatNumber(DEMO_AI_USAGE.requestsLast30Days)} requests`,
          },
          {
            label: "Tokens this month",
            value: formatCompactNumber(
              DEMO_AI_USAGE.inputTokensThisMonth + DEMO_AI_USAGE.outputTokensThisMonth,
            ),
            helper: `${formatCompactNumber(DEMO_AI_USAGE.inputTokensThisMonth)} in · ${formatCompactNumber(DEMO_AI_USAGE.outputTokensThisMonth)} out`,
          },
          {
            label: "Average cost per question",
            value: formatCurrency(
              DEMO_AI_USAGE.estimatedCostThisMonth / DEMO_AI_USAGE.requestsThisMonth,
              3,
            ),
            helper: "Across all models",
          },
        ].map((card) => (
          <div
            key={card.label}
            className="rounded-[var(--radius-lg)] border border-border bg-surface p-5 shadow-soft"
          >
            <p className="eyebrow">{card.label}</p>
            <p className="mt-3 text-[28px] leading-none font-semibold tracking-tight text-foreground tabular-nums">
              {card.value}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">{card.helper}</p>
          </div>
        ))}
      </div>

      {/* Credit balance */}
      <Card className="mb-5">
        <CardContent className="p-5">
          <SectionHeader
            title="Remaining credit balance"
            description="The number an owner actually wants to see before it runs out."
          />
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-[36px] leading-none font-semibold tracking-tight text-foreground tabular-nums">
                {formatCurrency(DEMO_AI_USAGE.remainingCreditUsd)}
              </p>
              <p className="mt-2 text-[13px] text-muted-foreground">
                of {formatCurrency(DEMO_AI_USAGE.creditPurchasedUsd)} purchased ·{" "}
                {formatCurrency(creditUsed)} used
              </p>
            </div>
            <p className="text-xs text-subtle-foreground">
              Last refreshed {relativeTime(refreshedAt)}
            </p>
          </div>
          <Progress
            value={creditPercent}
            tone={creditPercent < 25 ? "attention" : "accent"}
            className="mt-4"
            label="Remaining credit balance"
          />
        </CardContent>
      </Card>

      {/* Charts */}
      <div className="mb-5 grid gap-5 xl:grid-cols-2">
        <ChartFrame
          title="Weekly requests and cost"
          description={DEMO_AI_USAGE.monthLabel}
          action={
            <ChartLegend
              items={[
                { label: "Requests", color: CHART_COLORS.primary },
                { label: "Cost (USD)", color: CHART_COLORS.accent },
              ]}
            />
          }
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={AI_USAGE_SERIES} barGap={4}>
              <CartesianGrid {...GRID_PROPS} />
              <XAxis dataKey="label" {...AXIS_PROPS} />
              <YAxis {...AXIS_PROPS} width={40} />
              <RechartsTooltip
                cursor={{ fill: "var(--surface-muted)" }}
                content={
                  <ChartTooltip
                    formatter={(value, key) =>
                      key === "cost" ? formatCurrency(value) : formatNumber(value)
                    }
                  />
                }
              />
              <Bar
                dataKey="requests"
                name="Requests"
                fill={CHART_COLORS.primary}
                radius={[4, 4, 0, 0]}
                maxBarSize={28}
              />
              <Bar
                dataKey="cost"
                name="Cost (USD)"
                fill={CHART_COLORS.accent}
                radius={[4, 4, 0, 0]}
                maxBarSize={28}
              />
            </BarChart>
          </ResponsiveContainer>
        </ChartFrame>

        <Card>
          <CardContent className="p-5">
            <SectionHeader
              title="Usage by model"
              description="Where the spend is going."
            />
            <ul className="space-y-3.5">
              {AI_USAGE_BY_MODEL.map((entry) => {
                const share =
                  (entry.costUsd /
                    AI_USAGE_BY_MODEL.reduce((sum, item) => sum + item.costUsd, 0)) *
                  100;
                return (
                  <li key={entry.model}>
                    <div className="mb-1.5 flex items-center justify-between gap-3">
                      <span className="truncate font-mono text-[13px] text-foreground">
                        {entry.model}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                        {formatNumber(entry.requests)} req ·{" "}
                        {formatCurrency(entry.costUsd)}
                      </span>
                    </div>
                    <Progress value={share} tone="primary" label={`${entry.model} share of spend`} />
                  </li>
                );
              })}
            </ul>

            <div className="mt-6 border-t border-border pt-4">
              <SectionHeader title="Usage by API key" className="mb-3" />
              <ul className="space-y-2">
                {AI_USAGE_BY_KEY.map((entry) => (
                  <li
                    key={entry.key}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-sm)] border border-border px-3 py-2.5"
                  >
                    <span className="font-mono text-[13px] text-foreground">
                      {entry.key}
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {formatNumber(entry.requests)} req ·{" "}
                        {formatCurrency(entry.costUsd)}
                      </span>
                      <Badge tone="neutral" size="sm">
                        {entry.status}
                      </Badge>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Platform activity */}
      <SectionHeader
        title="Platform activity"
        description="Who is actually using Ask Sunny — the one thing the previous platform's analytics showed."
      />
      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          {
            label: "Questions asked",
            value: formatNumber(PLATFORM_ACTIVITY.questionsThisMonth),
            helper: "This month",
          },
          {
            label: "Leaders using the tool",
            value: `${PLATFORM_ACTIVITY.leadersUsingTool} / ${PLATFORM_ACTIVITY.totalLeaders}`,
            helper: "Active in the last 30 days",
          },
          {
            label: "Forms created",
            value: formatNumber(PLATFORM_ACTIVITY.formsCreatedThisMonth),
            helper: "This month",
          },
          {
            label: "Videos watched",
            value: formatNumber(PLATFORM_ACTIVITY.videosWatchedThisMonth),
            helper: "This month",
          },
        ].map((card) => (
          <div
            key={card.label}
            className="rounded-[var(--radius-md)] border border-border bg-surface px-4 py-3.5 shadow-soft"
          >
            <p className="eyebrow">{card.label}</p>
            <p className="mt-2 text-[22px] leading-none font-semibold text-foreground tabular-nums">
              {card.value}
            </p>
            <p className="mt-1.5 text-xs text-muted-foreground">{card.helper}</p>
          </div>
        ))}
      </div>

      <ChartFrame
        title="Questions and forms per week"
        description="Adoption trend."
        height={220}
        className="mb-5"
        action={
          <ChartLegend
            items={[
              { label: "Questions", color: CHART_COLORS.primary },
              { label: "Forms", color: CHART_COLORS.accent },
            ]}
          />
        }
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={PLATFORM_ACTIVITY_SERIES} barGap={4}>
            <CartesianGrid {...GRID_PROPS} />
            <XAxis dataKey="label" {...AXIS_PROPS} />
            <YAxis {...AXIS_PROPS} width={38} />
            <RechartsTooltip
              cursor={{ fill: "var(--surface-muted)" }}
              content={<ChartTooltip formatter={(value) => formatNumber(value)} />}
            />
            <Bar
              dataKey="questions"
              name="Questions"
              fill={CHART_COLORS.primary}
              radius={[4, 4, 0, 0]}
              maxBarSize={28}
            />
            <Bar
              dataKey="forms"
              name="Forms"
              fill={CHART_COLORS.accent}
              radius={[4, 4, 0, 0]}
              maxBarSize={28}
            />
          </BarChart>
        </ResponsiveContainer>
      </ChartFrame>

      {/* Recent usage */}
      <SectionHeader title="Recent usage" description="Most recent requests first." />
      <ScrollTable>
        <table className="w-full min-w-[46rem] border-collapse text-left">
          <thead>
            <tr className="border-b border-border">
              {["When", "Feature", "Model", "Tokens", "Cost", "Status"].map((heading) => (
                <th
                  key={heading}
                  scope="col"
                  className="px-4 py-3 text-[11px] font-semibold tracking-[0.1em] text-muted-foreground uppercase"
                >
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {DEMO_AI_USAGE_RECORDS.map((record) => (
              <tr key={record.id} className="border-b border-border last:border-0">
                <td className="px-4 py-3 text-[13px] whitespace-nowrap text-muted-foreground">
                  {formatDateTime(record.at)}
                </td>
                <td className="px-4 py-3 text-[13px] text-foreground">
                  {record.feature}
                </td>
                <td className="px-4 py-3 font-mono text-[12px] text-muted-foreground">
                  {record.model}
                </td>
                <td className="px-4 py-3 text-[13px] text-muted-foreground tabular-nums">
                  {formatNumber(record.inputTokens + record.outputTokens)}
                </td>
                <td className="px-4 py-3 text-[13px] text-foreground tabular-nums">
                  {formatCurrency(record.estimatedCostUsd, 3)}
                </td>
                <td className="px-4 py-3">
                  <Badge
                    tone={record.status === "succeeded" ? "ready" : "failed"}
                    size="sm"
                  >
                    <StatusDot />
                    {record.status === "succeeded" ? "Succeeded" : "Failed"}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollTable>

      <Notice tone="neutral" icon={<Info />} className="mt-5">
        Every figure on this screen is demo data. Once Claude is connected, these
        come from the Anthropic usage and cost APIs, refreshed on demand.
      </Notice>
      <DemoDataNote className="mt-3" />
    </PageShell>
  );
}
