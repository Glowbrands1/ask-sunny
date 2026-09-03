"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils/cn";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius-sm)] font-medium transition-[background-color,color,border-color,box-shadow,transform] duration-150 disabled:pointer-events-none disabled:opacity-45 [&_svg]:shrink-0 active:translate-y-px",
  {
    variants: {
      variant: {
        /*
         * A GENERIC PRIMARY CONTROL, so it carries the navy rather than the
         * brand brown. `primary` here means "the main action on this screen",
         * which is a UI state and not a category — the semantic colours stay
         * reserved for things that mean something (follow-up attention,
         * wellness, warnings).
         */
        /*
         * HOVER IS ONE COLOUR EVERYWHERE: the canvas, #fff6f0. Every variant
         * lands on it, so "the pointer is on this" reads the same on a navy
         * primary, a bordered secondary and a bare ghost.
         *
         * THE FOREGROUND HAS TO INVERT WITH IT on the dark variants. A navy
         * button whose background goes near-white while its text stays
         * near-white is an invisible button, so those variants also take the
         * navy foreground on hover — and keep a ring, because a button that
         * loses its fill entirely stops looking like a button.
         */
        primary:
          "bg-selected text-selected-foreground shadow-soft hover:bg-hover-surface hover:text-hover-surface-foreground hover:ring-1 hover:ring-selected",
        secondary:
          "bg-surface text-foreground border border-border-strong shadow-soft hover:bg-hover-surface",
        accent:
          "bg-accent text-accent-foreground shadow-soft hover:bg-hover-surface hover:text-hover-surface-foreground hover:ring-1 hover:ring-accent",
        soft: "bg-primary-soft text-primary-soft-foreground hover:bg-hover-surface",
        ghost: "text-muted-foreground hover:bg-hover-surface hover:text-foreground",
        outline:
          "border border-border-strong bg-transparent text-foreground hover:bg-hover-surface",
        destructive:
          "bg-status-failed-bg text-status-failed border border-[color-mix(in_srgb,var(--status-failed)_28%,transparent)] hover:bg-hover-surface",
        link: "text-primary underline-offset-4 hover:underline p-0 h-auto",
      },
      size: {
        sm: "h-8 px-3 text-[13px] [&_svg]:size-3.5",
        md: "h-9.5 px-4 text-sm [&_svg]:size-4",
        lg: "h-11 px-5 text-[15px] [&_svg]:size-4",
        icon: "h-9 w-9 [&_svg]:size-4",
        iconSm: "h-8 w-8 [&_svg]:size-3.5",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, type, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        type={asChild ? undefined : (type ?? "button")}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { buttonVariants };
