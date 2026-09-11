"use client";

import type { ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

/**
 * Shared chart chrome.
 *
 * The charts are deliberately quiet: thin axes, no grid verticals, no gradients
 * inside the plot. The intent is a reporting hub that reads as a premium
 * operations tool rather than a generic SaaS dashboard.
 *
 * The CARD carries the warm raised shadow — the artifact lifts a chart off the
 * peach ground — but nothing inside the plot does.
 */

/*
 * THE DATA FILL IS THE CORAL, and the ramp behind it is ordinal.
 *
 * This used to be a pure lightness ramp with no hue at all, on the previous
 * freeze's argument that no hue was free to encode identity. The current
 * Marquee artifacts settle it the other way and show the validator's working:
 * coral passes all six checks as a data fill on peach, and the near-black the
 * ramp used was refused for "reading as grey rather than as a colour". See
 * `salon-performance/chart-palette.ts` for the full table.
 *
 * `primary` is therefore the data, with `track` behind it and `benchmark` for a
 * comparison drawn ON a bar. `accent` and `slate` stay on the neutral ramp for
 * the genuinely ORDINAL job — a prior period that should recede — and `muted` is
 * a track rather than a series.
 *
 * THE INCREASE GREEN IS NOT HERE ON PURPOSE. It reaches charts through
 * `SERIES_INCREASE` in `chart-palette.ts`, because applying it is a JUDGEMENT
 * rather than a colour choice: it may only appear where the measure's
 * `higher_is_better` is actually stated, which is a decision the painting site
 * makes and a palette constant would quietly launder.
 *
 * `gold` IS NOT A FILL, and the artifact is blunt about why: brand yellow
 * measures 1.47:1 against a light ground, so "yellow cannot be a chart bar...
 * it never encodes a value". It is kept here only for the stroke and dot of the
 * reviews rating line, where the mark is a line on white rather than an area,
 * and it is paired with a direct label in every case.
 */
export const CHART_COLORS = {
  primary: "var(--measure-data)",
  track: "var(--measure-data-track)",
  benchmark: "var(--measure-benchmark)",
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
        /*
          THE ARTIFACT'S CHART CARD: 16px radius on the card border, the warm
          raised shadow rather than the flat one, and 18/20 padding. A chart is
          one of the two objects the artifact lifts off the peach — the other
          being the measure panel — so it carries the raised shadow and a table
          does not.
        */
        "rounded-[var(--radius-lg)] border border-border bg-surface px-5 pt-4.5 pb-5 shadow-raised",
        className,
      )}
    >
      <div className="mb-3.5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {/* The display face, uppercase, at 16px — a chart title is a section
              label in this direction, not 15px semibold prose. */}
          <h3 className="display text-[16px] tracking-[0.014em] text-foreground">
            {title}
          </h3>
          {description ? (
            <p className="mt-1 text-[11.5px] leading-snug text-muted-foreground">
              {description}
            </p>
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
