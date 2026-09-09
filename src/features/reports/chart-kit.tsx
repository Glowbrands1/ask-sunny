"use client";

import type { ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

/**
 * Shared chart chrome.
 *
 * The charts are deliberately quiet: thin axes, no grid verticals, no drop
 * shadows, no gradients. The intent is a reporting hub that reads as a premium
 * operations tool rather than a generic SaaS dashboard.
 */

/*
 * Series colour is a LIGHTNESS RAMP, not a set of hues. The direction removed
 * green and reserved coral for measures that are behind plan, which leaves no
 * hue free to encode series identity — so identity comes from the legend and
 * direct labels, and the ramp only has to stay distinguishable. Ordering it by
 * lightness also makes it safe for every kind of colour blindness.
 *
 * `gold` is the exception, and it is earned: the reviews block is the one
 * place the direction commits yellow in the daylight half.
 */
export const CHART_COLORS = {
  primary: "var(--measure-series)",
  accent: "var(--measure-series-strong)",
  gold: "var(--brand-yellow)",
  slate: "var(--measure-series-recessive)",
  blush: "var(--measure-track)",
  muted: "var(--measure-track)",
};

export const AXIS_PROPS = {
  stroke: "var(--border-strong)",
  tick: { fill: "var(--muted-foreground)", fontSize: 11 },
  tickLine: false,
  axisLine: { stroke: "var(--border)" },
} as const;

export const GRID_PROPS = {
  stroke: "var(--border)",
  strokeDasharray: "0",
  vertical: false,
} as const;

interface TooltipEntry {
  name?: string | number;
  value?: string | number;
  color?: string;
  dataKey?: string | number;
}

export function ChartTooltip({
  active,
  payload,
  label,
  formatter,
}: {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string | number;
  formatter?: (value: number, key: string) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-[var(--radius-sm)] border border-border bg-surface px-3 py-2 shadow-float">
      {label !== undefined ? (
        <p className="mb-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
          {label}
        </p>
      ) : null}
      <ul className="space-y-1">
        {payload.map((entry, index) => (
          <li
            key={`${entry.dataKey}-${index}`}
            className="flex items-center gap-2 text-[13px]"
          >
            <span
              aria-hidden
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: entry.color }}
            />
            <span className="text-muted-foreground">{entry.name}</span>
            <span className="ml-auto font-medium text-foreground tabular-nums">
              {formatter && typeof entry.value === "number"
                ? formatter(entry.value, String(entry.dataKey))
                : entry.value}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ChartFrame({
  title,
  description,
  children,
  action,
  className,
  height = 280,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  action?: ReactNode;
  className?: string;
  height?: number;
}) {
  return (
    <div
      className={cn(
        "rounded-[var(--radius-lg)] border border-border bg-surface p-5 shadow-soft",
        className,
      )}
    >
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-[15px] font-semibold text-foreground">{title}</h3>
          {description ? (
            <p className="mt-1 text-[13px] text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {action}
      </div>
      <div style={{ height }} className="w-full">
        {children}
      </div>
    </div>
  );
}

export function ChartLegend({
  items,
  className,
}: {
  items: { label: string; color: string }[];
  className?: string;
}) {
  return (
    <ul className={cn("flex flex-wrap items-center gap-x-4 gap-y-1.5", className)}>
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span
            aria-hidden
            className="size-2 rounded-full"
            style={{ backgroundColor: item.color }}
          />
          {item.label}
        </li>
      ))}
    </ul>
  );
}
