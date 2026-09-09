"use client";

import { cn } from "@/lib/utils/cn";

/**
 * THE OVERVIEW COLLAPSES — IT DOES NOT VANISH.
 *
 * When an answer opens inline, pushing the whole dashboard down is what makes
 * inline chat feel like the wrong page. Instead the overview becomes one strip
 * that keeps the figures, the review count and the overdue badge on screen,
 * with a button to bring the full page back.
 *
 * Everything in it is the same live data the expanded page renders — this is a
 * different presentation of the Overview, not a summary written for it.
 */
export function OverviewStrip({
  figures,
  alert,
  onExpand,
  className,
}: {
  figures: { label: string; value: string }[];
  /** Rendered only when something actually needs a person. */
  alert?: string;
  onExpand: () => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-5 gap-y-3 border-b border-border bg-background px-5 py-3 sm:px-6",
        className,
      )}
    >
      <span className="eyebrow shrink-0">Overview</span>

      {alert ? (
        <span className="inline-flex shrink-0 items-center gap-2 rounded-full bg-followup-attention px-3 py-1.5 text-[11.5px] font-bold text-followup-attention-foreground">
          <span
            aria-hidden
            className="size-1.5 rounded-full bg-followup-attention-foreground"
          />
          {alert}
        </span>
      ) : null}

      {figures.map((figure) => (
        <span
          key={figure.label}
          className="flex shrink-0 items-baseline gap-1.5 text-[12px] text-muted-foreground"
        >
          <b className="display-figure text-[19px] font-normal text-foreground">
            {figure.value}
          </b>
          {figure.label}
        </span>
      ))}

      <button
        type="button"
        onClick={onExpand}
        className="pill-action ml-auto border border-border-strong bg-surface text-foreground"
      >
        Show overview
      </button>
    </div>
  );
}
