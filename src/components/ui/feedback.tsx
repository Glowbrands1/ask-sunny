import * as React from "react";

import { cn } from "@/lib/utils/cn";

/* ---------------------------------------------------------------- Skeleton */

export function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("shimmer rounded-[var(--radius-sm)]", className)}
      aria-hidden
      {...props}
    />
  );
}

export function SkeletonCard({ lines = 3 }: { lines?: number }) {
  return (
    <div className="rounded-[var(--radius-lg)] border border-border bg-surface p-5 shadow-soft">
      <Skeleton className="h-3.5 w-28" />
      <Skeleton className="mt-4 h-7 w-20" />
      <div className="mt-4 space-y-2">
        {Array.from({ length: lines }).map((_, index) => (
          <Skeleton key={index} className="h-2.5 w-full" />
        ))}
      </div>
    </div>
  );
}

export function SkeletonRows({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2.5">
      {Array.from({ length: rows }).map((_, index) => (
        <Skeleton key={index} className="h-14 w-full" />
      ))}
    </div>
  );
}

/* -------------------------------------------------------------- EmptyState */

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  compact,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-[var(--radius-lg)] border border-dashed border-border-strong bg-surface/60 text-center",
        compact ? "px-6 py-8" : "px-8 py-14",
        className,
      )}
    >
      {icon ? (
        <div className="mb-3.5 flex size-11 items-center justify-center rounded-full bg-surface-muted text-muted-foreground [&_svg]:size-5">
          {icon}
        </div>
      ) : null}
      <p className="text-[15px] font-semibold text-foreground">{title}</p>
      {description ? (
        <p className="mt-1.5 max-w-md text-[13px] leading-relaxed text-muted-foreground">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ Notice */

export function Notice({
  tone = "neutral",
  icon,
  title,
  children,
  action,
  className,
}: {
  tone?: "neutral" | "accent" | "attention" | "primary";
  icon?: React.ReactNode;
  title?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  const toneClass = {
    neutral: "border-border bg-surface-muted text-muted-foreground",
    accent: "border-[color-mix(in_srgb,var(--accent)_20%,transparent)] bg-accent-soft text-accent-soft-foreground",
    attention:
      "border-[color-mix(in_srgb,var(--status-attention)_24%,transparent)] bg-status-attention-bg text-status-attention",
    primary:
      "border-[color-mix(in_srgb,var(--primary)_20%,transparent)] bg-primary-soft text-primary-soft-foreground",
  }[tone];

  return (
    <div
      className={cn(
        "flex flex-wrap items-start gap-3 rounded-[var(--radius-md)] border px-4 py-3",
        toneClass,
        className,
      )}
    >
      {icon ? <span className="mt-0.5 [&_svg]:size-4 shrink-0">{icon}</span> : null}
      <div className="min-w-0 flex-1 text-[13px] leading-relaxed">
        {title ? <p className="font-semibold">{title}</p> : null}
        <div className={cn(title && "mt-0.5")}>{children}</div>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

/* ------------------------------------------------------------ DemoDataNote */

/** Marks seeded content plainly, so nothing in the demo is mistaken for real. */
export function DemoDataNote({
  children = "Demo content — seeded for this prototype, not real company data.",
  className,
}: {
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <p
      className={cn(
        "flex items-center gap-1.5 text-xs text-subtle-foreground",
        className,
      )}
    >
      <span aria-hidden className="size-1 rounded-full bg-current" />
      {children}
    </p>
  );
}
