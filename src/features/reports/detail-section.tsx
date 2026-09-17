import type { ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

/**
 * ============================================================================
 * THE DETAIL A REPORT OPENS *ABOVE*, NOT *INTO*
 * ============================================================================
 *
 * THE REQUEST, from the 14 September review:
 *
 *   "Every report currently opens at maximum detail. Spa Wellness immediately
 *    opens into a 57-row table, while Spa Engagement opens with eight columns
 *    of very similar ratios. This feels backwards for how field leaders will
 *    use the information... The detailed work is valuable; it just should not
 *    be the landing view."
 *
 * SO NOTHING IS DELETED. Every table, every column and every row survives
 * exactly as it was — this puts a summary between the reader and it, and the
 * reader opens what they want. That is the whole component: a `<details>` with
 * a heading, a count, and a sentence saying what is inside.
 *
 * `<details>` RATHER THAN STATE, deliberately. These pages are server
 * components; a disclosure built on `useState` would make each one a client
 * component and ship its table's markup through a hydration boundary for no
 * benefit. The native element opens without JavaScript, is keyboard-operable
 * and screen-reader-announced for free, and — the reason that matters here —
 * browser find-in-page reaches inside a closed `<details>` in current Chrome
 * and Safari, so a manager searching for a salon name still finds it.
 *
 * `defaultOpen` EXISTS FOR THE SHORT ONES. A four-row table behind a
 * disclosure is a click that buys nothing, and the point is to stop a
 * fifty-seven-row table being the first thing on the page — not to hide
 * everything on principle.
 */
export function ReportDetailSection({
  title,
  description,
  /** e.g. `57 rows`. Shown on the summary so the weight is known before opening. */
  weight,
  defaultOpen = false,
  children,
  className,
}: {
  title: string;
  description?: string;
  weight?: string;
  defaultOpen?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <details
      open={defaultOpen}
      className={cn(
        "group rounded-[var(--radius-lg)] border border-border bg-surface",
        className,
      )}
    >
      <summary className="flex cursor-pointer flex-wrap items-baseline gap-x-3 gap-y-1 px-5 py-4">
        <span className="text-[15px] font-semibold text-foreground">{title}</span>
        {weight ? (
          <span className="text-xs text-muted-foreground tabular-nums">{weight}</span>
        ) : null}
        {description ? (
          <span className="w-full text-[13px] leading-relaxed text-muted-foreground">
            {description}
          </span>
        ) : null}
      </summary>
      <div className="border-t border-border px-5 py-5">{children}</div>
    </details>
  );
}

/**
 * ============================================================================
 * A PARAGRAPH THAT WAS DEFENDING A NUMBER, PUT BEHIND AN AFFORDANCE
 * ============================================================================
 *
 * THE REQUEST: "Some of the explanatory copy is doing too much. The PPTA 'Not
 * comparable' tile is a three-sentence explanation, and Spa Engagement includes
 * a section titled 'Two measures that look alike and are not.' If a metric
 * requires a paragraph to explain or defend it, that information should live
 * behind an info icon."
 *
 * The paragraphs are right and they are not the landing view's job. A short
 * headline stays on screen; the rest opens.
 *
 * IT IS STILL A `<details>` rather than a hover tooltip, because a paragraph in
 * a tooltip is unreadable on a phone, unreachable by keyboard in most
 * implementations, and gone the moment the pointer moves — and this content is
 * something a reader needs to sit and read once.
 */
export function ExplainerNote({
  label,
  children,
  className,
}: {
  /** The one line that stays on screen. */
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <details className={cn("text-[13px]", className)}>
      <summary className="cursor-pointer text-muted-foreground underline decoration-dotted underline-offset-4">
        {label}
      </summary>
      <div className="mt-2 max-w-3xl leading-relaxed text-muted-foreground">{children}</div>
    </details>
  );
}

/**
 * ADMIN-ONLY CONTENT, WRAPPED SO THE CONDITION IS NAMED WHERE IT APPLIES.
 *
 * The parser key, its version, the source sheet list and the file digest answer
 * a question no manager is asking. This is not a security boundary — see
 * `lib/auth/admin-view.ts`, which says so at length — it is an editorial one,
 * and naming it at the call site is what stops the next diagnostic panel being
 * added without the question being asked.
 */
export function AdminOnly({
  isAdmin,
  children,
}: {
  isAdmin: boolean;
  children: ReactNode;
}) {
  if (!isAdmin) return null;
  return <>{children}</>;
}
