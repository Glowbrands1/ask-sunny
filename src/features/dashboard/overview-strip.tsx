"use client";

import type { ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

/**
 * THE OVERVIEW COLLAPSES — IT DOES NOT VANISH.
 *
 * When an answer opens inline, pushing the whole dashboard down is what makes
 * inline chat feel like the wrong page. Instead the overview becomes one strip
 * that keeps the figures and the overdue badge on screen, with a button to
 * bring the full page back.
 *
 * THE FIGURES ARRIVE AS A NODE, NOT AS DATA, and that is what makes the strip
 * and the expanded page agree. They are the same server-rendered reporting
 * snapshot the Performance panel shows, streamed in behind a skeleton — this
 * screen is a client component and the reporting read layer is `server-only`,
 * so a strip that built its own figures would be a second data path for numbers
 * the product has deliberately given one.
 */
export function OverviewStrip({
  figures,
  alert,
  onExpand,
  className,
}: {
  /** The Performance snapshot, rendered on the server and passed in. */
  figures: ReactNode;
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

      {figures}

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
