import { ArrowDownRight, ArrowRight, ArrowUpRight } from "lucide-react";

import { cn } from "@/lib/utils/cn";
import type { DashboardMetric, MetricTrend } from "@/types";

const TREND_ICON: Record<MetricTrend, typeof ArrowUpRight> = {
  up: ArrowUpRight,
  down: ArrowDownRight,
  flat: ArrowRight,
};

const TREND_CLASS: Record<MetricTrend, string> = {
  up: "text-status-ready",
  down: "text-status-attention",
  flat: "text-muted-foreground",
};

const TREND_LABEL: Record<MetricTrend, string> = {
  up: "Trending up",
  down: "Needs attention",
  flat: "Flat",
};

export function StatCard({
  metric,
  emphasis,
  className,
}: {
  metric: DashboardMetric;
  emphasis?: boolean;
  className?: string;
}) {
  const Icon = metric.trend ? TREND_ICON[metric.trend] : null;
  return (
    <div
      className={cn(
        "rounded-[var(--radius-lg)] border p-5 shadow-soft",
        emphasis
          ? "border-[color-mix(in_srgb,var(--primary)_24%,transparent)] bg-primary-soft"
          : "border-border bg-surface",
        className,
      )}
    >
      <p
        className={cn(
          "eyebrow",
          emphasis && "text-[color-mix(in_srgb,var(--primary-soft-foreground)_78%,transparent)]",
        )}
      >
        {metric.label}
      </p>
      <p
        className={cn(
          "mt-3 text-[30px] leading-none font-semibold tracking-tight tabular-nums",
          emphasis ? "text-primary-soft-foreground" : "text-foreground",
        )}
      >
        {metric.value}
      </p>
      {metric.helper ? (
        <p
          className={cn(
            "mt-2 text-xs",
            emphasis ? "text-primary-soft-foreground/80" : "text-muted-foreground",
          )}
        >
          {metric.helper}
        </p>
      ) : null}
      {metric.changeLabel ? (
        <p
          className={cn(
            "mt-3 flex items-center gap-1.5 text-xs font-medium",
            metric.trend ? TREND_CLASS[metric.trend] : "text-muted-foreground",
          )}
        >
          {Icon ? <Icon className="size-3.5" aria-hidden /> : null}
          {metric.trend ? (
            <span className="sr-only">{TREND_LABEL[metric.trend]}: </span>
          ) : null}
          {metric.changeLabel}
        </p>
      ) : null}
    </div>
  );
}

export function StatCardGrid({
  metrics,
  className,
}: {
  metrics: DashboardMetric[];
  className?: string;
}) {
  return (
    <div className={cn("grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4", className)}>
      {metrics.map((metric) => (
        <StatCard key={metric.id} metric={metric} />
      ))}
    </div>
  );
}
