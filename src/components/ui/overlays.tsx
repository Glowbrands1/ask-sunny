"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { X } from "lucide-react";

import { cn } from "@/lib/utils/cn";

/* ------------------------------------------------------------------ Dialog */

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({
  className,
  children,
  title,
  description,
  wide,
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
  title: string;
  description?: string;
  wide?: boolean;
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[color-mix(in_srgb,var(--foreground)_28%,transparent)] backdrop-blur-[2px] data-[state=open]:animate-in-fade" />
      <DialogPrimitive.Content
        className={cn(
          "fixed top-1/2 left-1/2 z-50 w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 rounded-[var(--radius-lg)] border border-border bg-surface shadow-float data-[state=open]:animate-in-rise",
          wide ? "max-w-3xl" : "max-w-lg",
          className,
        )}
        {...props}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-4">
          <div>
            <DialogPrimitive.Title className="text-base font-semibold text-foreground">
              {title}
            </DialogPrimitive.Title>
            {description ? (
              <DialogPrimitive.Description className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
                {description}
              </DialogPrimitive.Description>
            ) : (
              <DialogPrimitive.Description className="sr-only">
                {title}
              </DialogPrimitive.Description>
            )}
          </div>
          <DialogPrimitive.Close
            className="-mt-1 -mr-1 rounded-[var(--radius-xs)] p-1.5 text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground"
            aria-label="Close"
          >
            <X className="size-4" />
          </DialogPrimitive.Close>
        </div>
        <div className="scroll-slim max-h-[70vh] overflow-y-auto px-6 py-5">
          {children}
        </div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogActions({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "mt-6 flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4",
        className,
      )}
      {...props}
    />
  );
}

/* ------------------------------------------------------------ DropdownMenu */

export const DropdownMenu = DropdownMenuPrimitive.Root;
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;
export const DropdownMenuGroup = DropdownMenuPrimitive.Group;

export const DropdownMenuContent = React.forwardRef<
  React.ComponentRef<typeof DropdownMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>
>(({ className, sideOffset = 6, ...props }, ref) => (
  <DropdownMenuPrimitive.Portal>
    <DropdownMenuPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        "z-50 min-w-52 overflow-hidden rounded-[var(--radius-md)] border border-border bg-surface p-1.5 shadow-float data-[state=open]:animate-in-fade",
        className,
      )}
      {...props}
    />
  </DropdownMenuPrimitive.Portal>
));
DropdownMenuContent.displayName = "DropdownMenuContent";

export const DropdownMenuItem = React.forwardRef<
  React.ComponentRef<typeof DropdownMenuPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item> & {
    tone?: "default" | "danger";
  }
>(({ className, tone = "default", ...props }, ref) => (
  <DropdownMenuPrimitive.Item
    ref={ref}
    className={cn(
      "flex cursor-pointer items-center gap-2.5 rounded-[var(--radius-xs)] px-2.5 py-2 text-[13px] outline-none transition-colors select-none",
      tone === "danger"
        ? "text-status-failed data-highlighted:bg-status-failed-bg"
        : "text-foreground data-highlighted:bg-surface-muted",
      "[&_svg]:size-3.5 [&_svg]:shrink-0 [&_svg]:text-muted-foreground",
      className,
    )}
    {...props}
  />
));
DropdownMenuItem.displayName = "DropdownMenuItem";

export const DropdownMenuCheckboxItem = React.forwardRef<
  React.ComponentRef<typeof DropdownMenuPrimitive.CheckboxItem>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.CheckboxItem>
>(({ className, children, ...props }, ref) => (
  <DropdownMenuPrimitive.CheckboxItem
    ref={ref}
    className={cn(
      "flex cursor-pointer items-center gap-2.5 rounded-[var(--radius-xs)] py-2 pr-2.5 pl-8 text-[13px] text-foreground outline-none transition-colors select-none data-highlighted:bg-surface-muted",
      className,
    )}
    {...props}
  >
    <span className="absolute left-3 flex size-3.5 items-center justify-center">
      <DropdownMenuPrimitive.ItemIndicator>
        <svg viewBox="0 0 16 16" className="size-3.5 text-primary" aria-hidden>
          <path
            d="M3.5 8.5 6.5 11.5 12.5 4.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </DropdownMenuPrimitive.ItemIndicator>
    </span>
    {children}
  </DropdownMenuPrimitive.CheckboxItem>
));
DropdownMenuCheckboxItem.displayName = "DropdownMenuCheckboxItem";

export function DropdownMenuLabel({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Label>) {
  return (
    <DropdownMenuPrimitive.Label
      className={cn("px-2.5 pt-2 pb-1.5 eyebrow", className)}
      {...props}
    />
  );
}

export function DropdownMenuSeparator({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>) {
  return (
    <DropdownMenuPrimitive.Separator
      className={cn("my-1.5 h-px bg-border", className)}
      {...props}
    />
  );
}

/* ----------------------------------------------------------------- Tooltip */

export const TooltipProvider = TooltipPrimitive.Provider;

export function Tooltip({
  content,
  children,
  side = "top",
  disabled,
}: {
  content: React.ReactNode;
  children: React.ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  disabled?: boolean;
}) {
  if (disabled) return <>{children}</>;
  return (
    <TooltipPrimitive.Root delayDuration={220}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={6}
          className="z-50 max-w-64 rounded-[var(--radius-xs)] border border-border bg-surface px-2.5 py-1.5 text-xs leading-relaxed text-foreground shadow-float data-[state=delayed-open]:animate-in-fade"
        >
          {content}
          <TooltipPrimitive.Arrow className="fill-[var(--surface)]" />
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

/* ----------------------------------------------------------------- Popover */

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverClose = PopoverPrimitive.Close;

/**
 * A panel anchored to its trigger.
 *
 * Used for the filter menus, where a dropdown-menu would be the wrong
 * primitive: a menu closes on every item activation, and a multi-select needs
 * to stay open while several boxes are ticked.
 */
export const PopoverContent = React.forwardRef<
  React.ComponentRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, align = "start", sideOffset = 6, onCloseAutoFocus, ...props }, ref) => {
  /*
   * WHERE FOCUS GOES WHEN THIS CLOSES, and why it is handled here.
   *
   * Radix returns focus to the trigger on close with a bare `focus()`. The
   * browser scrolls a freshly focused element into view, so if the trigger has
   * scrolled out of view the page moves under the reader. Radix gets the
   * OPENING side right — its focus scope focuses the panel with
   * `{ preventScroll: true }` — and this closes the matching gap.
   *
   * It is invisible on the reporting filter bar, which is `position: sticky`
   * and therefore always on screen: measured in a browser, dismissing a filter
   * menu at scroll 900 leaves the page at 900. It will NOT be invisible the
   * first time this shared overlay is used somewhere that scrolls away — a long
   * form editor, a settings panel — which is why the fix belongs in the shared
   * component rather than in a page.
   *
   * HOW THE TRIGGER IS FOUND, after two wrong answers.
   *
   * Not `document.activeElement` at mount: the panel renders before the click
   * has moved focus, so that captured `<body>`, and "restoring" focus there
   * would have quietly dropped it — worse than the scroll it was fixing.
   *
   * Not a DOM lookup inside the close handler either: `onCloseAutoFocus` fires
   * during unmount, by which time React has already nulled the content ref, so
   * the lookup found nothing and Radix's unflagged focus ran anyway.
   *
   * Not a mount effect either: the popper mounts its node in a later pass, so
   * an effect with no dependencies runs while the ref is still empty.
   *
   * What works is `onOpenAutoFocus`, which fires with the panel mounted and the
   * trigger already marked `aria-controls="<content id>"`. The handler only
   * READS — it never prevents the default, so Radix still moves focus into the
   * panel exactly as before, which is what a keyboard user depends on.
   *
   * The keyboard contract is unchanged: focus still returns to the trigger, so
   * Tab continues from where it left off. Only the scrolling is suppressed. If
   * the trigger cannot be found, Radix's own behaviour is left alone rather
   * than second-guessed — a page that scrolls is better than focus in limbo.
   */
  const contentRef = React.useRef<HTMLDivElement | null>(null);
  const triggerRef = React.useRef<HTMLElement | null>(null);

  const attachRef = React.useCallback(
    (node: HTMLDivElement | null) => {
      contentRef.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    },
    [ref],
  );


  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        ref={attachRef}
        align={align}
        sideOffset={sideOffset}
        onOpenAutoFocus={(event) => {
          // READ-ONLY: no preventDefault, so Radix's own focus into the panel
          // still happens. The panel is mounted by now and the trigger carries
          // `aria-controls`, which is the only moment both are true.
          const id = (event.currentTarget as HTMLElement | null)?.id ?? contentRef.current?.id;
          triggerRef.current = id
            ? document.querySelector<HTMLElement>(`[aria-controls="${CSS.escape(id)}"]`)
            : null;
        }}
        onCloseAutoFocus={(event) => {
          onCloseAutoFocus?.(event);
          if (event.defaultPrevented) return;

          const trigger = triggerRef.current;
          if (!trigger?.isConnected) return;

          // Radix's own restore is skipped only because this prevents the
          // default — see the non-modal branch of `Popover.Content`, which
          // checks `defaultPrevented` before focusing the trigger itself.
          event.preventDefault();
          trigger.focus({ preventScroll: true });
        }}
        className={cn(
          "z-50 w-72 overflow-hidden rounded-[var(--radius-md)] border border-border bg-surface shadow-float data-[state=open]:animate-in-fade",
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
});
PopoverContent.displayName = "PopoverContent";
