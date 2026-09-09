import * as React from "react";

import { cn } from "@/lib/utils/cn";

/** Standard page frame: consistent max width, gutters and vertical rhythm. */
export function PageShell({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "mx-auto w-full max-w-[1400px] px-5 py-7 sm:px-7 lg:px-9 lg:py-9",
        className,
      )}
      {...props}
    />
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
}: {
  eyebrow?: string;
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "flex flex-col gap-4 pb-6 sm:flex-row sm:items-end sm:justify-between",
        className,
      )}
    >
      <div className="min-w-0">
        {eyebrow ? <p className="eyebrow mb-2">{eyebrow}</p> : null}
        {/*
          EVERY INTERIOR PAGE TITLE TAKES THE DISPLAY FACE.

          The direction sets headings in Passion One, uppercase, with positive
          tracking — and it only ever draws the Overview, so this is where that
          reaches Reports, Knowledge, Forms and the rest. Before this they were
          the old tight-tracked semibold sans, which made the Overview look like
          a different product from every page you navigate to next.
        */}
        <h1 className="display text-[26px] text-foreground sm:text-[32px]">{title}</h1>
        {description ? (
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </header>
  );
}

export function SectionHeader({
  title,
  description,
  actions,
  className,
}: {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between",
        className,
      )}
    >
      <div className="min-w-0">
        {/*
          Section titles carry the display face too, and a yellow rule runs out
          from the label to fill the row — the page's rhythm, and the way the
          brand reaches the daylight half without a filled block. The rule is
          hidden when the section has description text under it, where a line
          across the top would cut the two apart rather than join them.
        */}
        <div className="flex items-center gap-3">
          <h2 className="display shrink-0 text-[16px] tracking-[0.035em] text-foreground">
            {title}
          </h2>
          {description ? null : (
            <span
              aria-hidden
              className="h-[3px] min-w-6 flex-1 rounded-sm bg-brand-yellow"
            />
          )}
        </div>
        {description ? (
          <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </div>
  );
}

export function Separator({
  className,
  orientation = "horizontal",
}: {
  className?: string;
  orientation?: "horizontal" | "vertical";
}) {
  return (
    <div
      role="separator"
      aria-orientation={orientation}
      className={cn(
        "bg-border",
        orientation === "horizontal" ? "h-px w-full" : "h-full w-px",
        className,
      )}
    />
  );
}

/** Horizontal scroll container so wide tables never break the page. */
export function ScrollTable({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "scroll-slim w-full overflow-x-auto rounded-[var(--radius-lg)] border border-border bg-surface shadow-soft",
        className,
      )}
    >
      {children}
    </div>
  );
}
