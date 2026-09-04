import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils/cn";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full border font-medium leading-none whitespace-nowrap",
  {
    variants: {
      tone: {
        neutral: "border-border-strong bg-surface-muted text-muted-foreground",
        primary:
          "border-[color-mix(in_srgb,var(--primary)_22%,transparent)] bg-primary-soft text-primary-soft-foreground",
        accent:
          "border-[color-mix(in_srgb,var(--accent)_24%,transparent)] bg-accent-soft text-accent-soft-foreground",
        blush:
          "border-[color-mix(in_srgb,var(--blush-soft-foreground)_22%,transparent)] bg-blush-soft text-blush-soft-foreground",
        ready:
          "border-[color-mix(in_srgb,var(--status-ready)_22%,transparent)] bg-status-ready-bg text-status-ready",
        processing:
          "border-[color-mix(in_srgb,var(--status-processing)_22%,transparent)] bg-status-processing-bg text-status-processing",
        attention:
          "border-[color-mix(in_srgb,var(--status-attention)_26%,transparent)] bg-status-attention-bg text-status-attention",
        /*
         * A FOLLOW-UP NEEDS SOMEBODY TO ACT — overdue, late, due imminently.
         *
         * Named for the state, not the colour, which is what stops it becoming
         * a general-purpose pink. If a badge is reaching for `followup` and the
         * thing it labels is not a follow-up, the wrong tone is being used.
         */
        followup:
          "border-[color-mix(in_srgb,var(--followup-attention)_30%,transparent)] bg-followup-attention-soft text-followup-attention-soft-foreground",
        /*
         * THE SAME MEANING, SAID LOUDLY.
         *
         * `followup` above is the soft treatment — right for "due tomorrow",
         * where the point is to be noticed while reading. An OVERDUE follow-up
         * is not a thing to notice while reading; it is the reason somebody
         * opened the screen. So it takes the approved follow-up pink as a FILL
         * with its high-contrast foreground, which is the one place that
         * colour appears at full strength.
         *
         * Both tones are the same semantic. Neither is available for anything
         * that is not a follow-up.
         */
        followupStrong:
          "border-transparent bg-followup-attention text-followup-attention-foreground",
        failed:
          "border-[color-mix(in_srgb,var(--status-failed)_24%,transparent)] bg-status-failed-bg text-status-failed",
        outline: "border-border-strong bg-transparent text-muted-foreground",
      },
      size: {
        sm: "px-2 py-0.5 text-[11px]",
        md: "px-2.5 py-1 text-xs",
      },
    },
    defaultVariants: { tone: "neutral", size: "sm" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

/**
 * The tones a badge can carry.
 *
 * Exported so callers derive it instead of restating the list. A
 * hand-maintained copy of these names in a feature module drifts the moment
 * a tone is added — which is exactly what happened when `followup` arrived.
 */
export type BadgeTone = NonNullable<VariantProps<typeof badgeVariants>["tone"]>;

export function Badge({ className, tone, size, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone, size }), className)} {...props} />;
}

/** A small dot + label, so status is never conveyed by colour alone. */
export function StatusDot({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("size-1.5 shrink-0 rounded-full bg-current", className)}
    />
  );
}
