"use client";

import * as React from "react";
import * as LabelPrimitive from "@radix-ui/react-label";

import { cn } from "@/lib/utils/cn";

export const Label = React.forwardRef<
  React.ComponentRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root>
>(({ className, ...props }, ref) => (
  <LabelPrimitive.Root
    ref={ref}
    className={cn(
      "text-[13px] font-medium text-foreground select-none",
      className,
    )}
    {...props}
  />
));
Label.displayName = "Label";

const controlBase =
  "w-full rounded-[var(--radius-sm)] border border-border-strong bg-surface px-3 text-sm text-foreground placeholder:text-subtle-foreground transition-[border-color,box-shadow] duration-150 hover:border-[color-mix(in_srgb,var(--border-strong)_70%,var(--primary))] focus-visible:border-primary disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-muted-foreground";

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, type = "text", ...props }, ref) => (
  <input ref={ref} type={type} className={cn(controlBase, "h-9.5", className)} {...props} />
));
Input.displayName = "Input";

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(controlBase, "min-h-24 py-2.5 leading-relaxed resize-y", className)}
    {...props}
  />
));
Textarea.displayName = "Textarea";

export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, children, ...props }, ref) => (
  <div className="relative">
    <select
      ref={ref}
      className={cn(
        controlBase,
        "h-9.5 cursor-pointer appearance-none pr-9",
        className,
      )}
      {...props}
    >
      {children}
    </select>
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      className="pointer-events-none absolute top-1/2 right-3 size-3.5 -translate-y-1/2 text-muted-foreground"
    >
      <path
        d="M4 6.5 8 10.5 12 6.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  </div>
));
Select.displayName = "Select";

export function FieldGroup({
  label,
  htmlFor,
  hint,
  required,
  children,
  className,
  action,
}: {
  label: string;
  htmlFor: string;
  hint?: React.ReactNode;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor={htmlFor}>
          {label}
          {required ? (
            <span className="ml-1 text-highlight-deep" aria-hidden>
              *
            </span>
          ) : null}
          {required ? <span className="sr-only"> (required)</span> : null}
        </Label>
        {action}
      </div>
      {children}
      {hint ? (
        <p className="text-xs leading-relaxed text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}
