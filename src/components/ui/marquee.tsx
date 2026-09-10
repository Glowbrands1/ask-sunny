import * as React from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

import { cn } from "@/lib/utils/cn";

/**
 * =============================================================================
 * THE DAYLIGHT HALF — the shared objects the direction builds the page from
 * =============================================================================
 *
 * These exist because the Overview was previously ONE object repeated: a white
 * rounded card with a header and a body, used for the stats, the alerts, the
 * reviews, the link lists and the counters alike. That is what made the page
 * read as a grid of equal boxes with no hierarchy — "all of it is the same
 * white box on the same peach field".
 *
 * The direction replaces that with a small set of objects that each say
 * something different about what they contain.
 */

/* -------------------------------------------------------------- section -- */

/**
 * A section rule: label, a yellow line that takes up the remaining width, and
 * an optional link at the end.
 *
 * This is the page's rhythm. It replaces a card header, so the sections read as
 * bands of one page rather than as separate panels — and the yellow line is
 * what carries the brand through the daylight half without a filled block.
 */
export function SectionRule({
  label,
  action,
  className,
}: {
  label: string;
  action?: { label: string; href: string };
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <h2 className="display shrink-0 text-[16px] tracking-[0.035em] text-foreground">
        {label}
      </h2>
      <span aria-hidden className="h-[3px] min-w-6 flex-1 rounded-sm bg-brand-yellow" />
      {action ? (
        <Link
          href={action.href}
          className="eyebrow shrink-0 whitespace-nowrap hover:text-foreground"
        >
          {action.label}
          <ArrowUpRight className="ml-1 inline size-2.5" aria-hidden />
        </Link>
      ) : null}
    </div>
  );
}

/* ---------------------------------------------------------------- stats -- */

/**
 * ONE PANEL, COLUMNS DIVIDED BY HAIRLINES — not four cards.
 *
 * The direction's argument: four bordered boxes make four objects that run
 * together, and a figure only reads as the largest thing on the page if nothing
 * is drawn around it. Each column names its OWN period, because a year-to-date
 * revenue figure and a month-to-date sales figure are not comparable and must
 * not look like they are.
 */
export function StatPanel({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-1 rounded-2xl border border-border bg-surface py-4 shadow-raised sm:grid-cols-2 xl:grid-cols-4",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function StatColumn({
  label,
  value,
  period,
  delta,
  flagged,
}: {
  label: string;
  value: string;
  /** The period THIS figure covers. Never omitted — see StatPanel. */
  period?: string;
  delta?: string;
  /**
   * Set only when the measure is actually behind. Direction is not target, so a
   * figure that merely moved down is not flagged — nothing flagged is a valid
   * state, and a row where something is always coloured teaches managers to
   * ignore the colour.
   */
  flagged?: boolean;
}) {
  return (
    <div className="stat-cell">
      <p className={cn("eyebrow", flagged && "text-measure-flagged-foreground")}>
        {label}
      </p>
      <p className="display-figure mt-2 text-[32px] text-foreground sm:text-[38px]">
        {value}
      </p>
      {delta ? (
        <p
          className={cn(
            "mt-1.5 text-[10.5px] font-bold tabular-nums",
            flagged ? "text-measure-flagged-foreground" : "text-muted-foreground",
          )}
        >
          {delta}
        </p>
      ) : null}
      {period ? (
        <p className="eyebrow mt-2 text-subtle-foreground">{period}</p>
      ) : null}
    </div>
  );
}

/**
 * The provenance line: the through-date and the last update.
 *
 * On a number a district manager will quote in a meeting, this is not
 * decoration — it is the difference between a figure and a claim.
 */
export function Provenance({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p
      className={cn(
        "text-[10.5px] font-bold tracking-[0.02em] text-subtle-foreground",
        className,
      )}
    >
      {children}
    </p>
  );
}

/* ---------------------------------------------------------------- alarm -- */

/**
 * THE ALERT SITS ON TOP OF WHAT IT REFERS TO.
 *
 * A coral header directly above the follow-ups and the form counters, so the
 * alarm is attached to the thing it is about rather than floating as a banner
 * somewhere else on the page. It carries its own coral-tinted shadow, which is
 * the only place that shadow is used.
 *
 * NEVER A BUTTON. The action inside it is near-black: pressing and alarming
 * must not look alike.
 */
export function AlarmBar({
  title,
  detail,
  action,
  className,
}: {
  title: string;
  detail?: string;
  action?: { label: string; href: string };
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-3 rounded-2xl bg-followup-attention px-4 py-3.5 shadow-attention",
        className,
      )}
    >
      <span
        aria-hidden
        className="size-2.5 shrink-0 rounded-full bg-followup-attention-foreground shadow-[var(--halo-alarm-dot)]"
      />
      <div className="min-w-0">
        <p className="display text-[18px] text-followup-attention-foreground">
          {title}
        </p>
        {detail ? (
          <p className="mt-0.5 text-[11px] text-followup-attention-muted-foreground">
            {detail}
          </p>
        ) : null}
      </div>
      {action ? (
        <Link
          href={action.href}
          className="pill-action ml-auto bg-chrome text-followup-attention-foreground"
        >
          {action.label}
        </Link>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------- counters -- */

/**
 * The same number broken out three ways. The tone escalates with the state:
 * coral for overdue, yellow for due-this-week, warm neutral for merely open.
 */
export function CountTiles({
  tiles,
  className,
}: {
  tiles: { label: string; value: number | string; tone: "overdue" | "soon" | "open" }[];
  className?: string;
}) {
  return (
    <div className={cn("grid grid-cols-3 gap-2.5", className)}>
      {tiles.map((tile) => (
        <div
          key={tile.label}
          className={cn(
            "rounded-xl px-3.5 py-3",
            tile.tone === "overdue" && "bg-followup-attention",
            tile.tone === "soon" && "bg-brand-yellow",
            tile.tone === "open" && "bg-surface-muted",
          )}
        >
          <p
            className={cn(
              "eyebrow",
              tile.tone === "overdue" && "text-followup-attention-muted-foreground",
              tile.tone === "soon" && "text-brand-yellow-soft-foreground",
              tile.tone === "open" && "text-muted-foreground",
            )}
          >
            {tile.label}
          </p>
          <p
            className={cn(
              "display-figure mt-1 text-[26px]",
              tile.tone === "overdue" && "text-followup-attention-foreground",
              tile.tone === "soon" && "text-brand-yellow-foreground",
              tile.tone === "open" && "text-foreground",
            )}
          >
            {tile.value}
          </p>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------ bare list -- */

/**
 * A LINK LIST IS NOT A CARD.
 *
 * Knowledge updates and Manager resources become bare lists under one rule: a
 * box around a link list adds an edge and removes hierarchy, and these are the
 * quietest content on the page.
 */
export function BareList({
  label,
  meta,
  action,
  children,
  className,
}: {
  label: string;
  meta?: string;
  action?: { label: string; href: string };
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("border-t-[3px] border-border-strong pt-3", className)}>
      <div className="mb-2.5 flex items-center gap-2">
        <h3 className="eyebrow">{label}</h3>
        {meta ? (
          <span className="eyebrow text-measure-flagged-foreground">{meta}</span>
        ) : null}
        {action ? (
          <Link
            href={action.href}
            className="eyebrow ml-auto whitespace-nowrap hover:text-foreground"
          >
            {action.label}
            <ArrowUpRight className="ml-1 inline size-2.5" aria-hidden />
          </Link>
        ) : null}
      </div>
      {children}
    </section>
  );
}

/** A row in a bare list: a small yellow marker, the title, and a right-aligned meta. */
export function BareRow({
  children,
  meta,
  href,
}: {
  children: React.ReactNode;
  meta?: string;
  href?: string;
}) {
  const inner = (
    <>
      <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-sm bg-brand-yellow" />
      <span className="min-w-0 flex-1 text-[12px] text-foreground">{children}</span>
      {meta ? (
        <span className="shrink-0 text-[10.5px] whitespace-nowrap text-muted-foreground">
          {meta}
        </span>
      ) : null}
    </>
  );

  return href ? (
    <Link href={href} className="flex items-baseline gap-3 py-1.5 hover:underline">
      {inner}
    </Link>
  ) : (
    <div className="flex items-baseline gap-3 py-1.5">{inner}</div>
  );
}

/* ------------------------------------------------------------- quintile -- */

/**
 * A SOURCE-REPORTED QUINTILE BAND.
 *
 * The band is reported upstream against the whole chain, so this only ever
 * displays what the source said — the tone is read off the label rather than
 * recomputed, because deriving it from the rows on screen would quietly turn a
 * chain-wide fact into a fact about the current filter, which is the one thing
 * this report refuses to do.
 *
 * WHY THE TOP BAND IS THE NEAR-BLACK. It is the strongest chip available in
 * the daylight half, and it is the band a reader actually scans a column for.
 * The bottom band takes coral, which is consistent with the rest of the
 * direction: coral appears on a measure only when something is behind.
 * Everything between is a warm neutral, because most rows land there and the
 * column should be quiet when they do.
 */
export function QuintileChip({
  tone = "mid",
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & {
  tone?: "top" | "upper" | "mid" | "bottom";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-[var(--radius-xs)] px-2 py-[3px] text-[8px] font-black tracking-[0.09em] whitespace-nowrap uppercase",
        tone === "top" && "bg-chrome text-brand-yellow",
        tone === "upper" && "bg-surface-muted text-body-foreground",
        tone === "mid" && "bg-muted text-muted-foreground",
        tone === "bottom" && "bg-measure-flagged text-followup-attention-foreground",
        className,
      )}
      {...props}
    />
  );
}

/**
 * WHICH BAND A SOURCE-REPORTED QUINTILE LABEL SITS IN.
 *
 * An unrecognised label falls through to the neutral chip rather than guessing:
 * the source's vocabulary is not this app's to predict.
 */
export function quintileTone(label: string): "top" | "upper" | "mid" | "bottom" {
  const value = label.toLowerCase();
  if (value.startsWith("top")) return "top";
  if (value.includes("bottom")) return "bottom";
  if (value.startsWith("2nd") || value.startsWith("second")) return "upper";
  return "mid";
}
