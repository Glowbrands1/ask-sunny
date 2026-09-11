"use client";

import * as React from "react";
import { SlidersHorizontal } from "lucide-react";

import { cn } from "@/lib/utils/cn";

/**
 * ============================================================================
 * ONE FILTER ROW, AND NEVER STICKY
 * ============================================================================
 *
 * The Marquee Reports artifact's fourth punch-list item, and both halves of it
 * are load-bearing:
 *
 *   "Six controls on one line with the values shown on the chips, so the
 *    current slice is readable without opening anything. On a phone it scrolls
 *    away with the page rather than pinning and eating a third of the screen."
 *
 * The pills themselves already carry their selected value in bold beside a
 * micro-label, which is the half that was done. What this adds is the row: the
 * eyebrow that names it, the overflow control, and the strip's own rhythm.
 *
 * NOT STICKY, DELIBERATELY. There is no `sticky` here and there must not be
 * one. The artifact flags a pinned filter row as a defect at phone width — at
 * 390px this row wraps to three lines, and pinned that is a third of the
 * viewport permanently spent on controls the reader has already set.
 *
 * ============================================================================
 * WHY "MORE FILTERS" EXISTS, AND WHAT IT MUST NEVER DO
 * ============================================================================
 *
 * The artifact draws six controls plus a near-black More Filters pill. Bed Usage
 * can offer eight — period, region, district, salon, equipment level, equipment
 * type, equipment and performance band — and eight capsules do not fit on one
 * line at 1440px, let alone on a laptop. So the secondary dimensions go behind
 * the pill and the row stays one line at desktop widths.
 *
 * A HIDDEN FILTER THAT IS HOLDING A SELECTION IS A LIE ABOUT THE NUMBERS, so
 * the pill carries a count of them and the row defaults to open when any is
 * set. That is why `activeCount` is a prop rather than an optional nicety: a
 * reader must never be looking at eleven of fifteen salons with nothing on
 * screen saying so. The count also keeps the control honest when the row is
 * collapsed — "More filters · 2" is a different claim from "More filters".
 *
 * UI STATE, NOT FILTER STATE. Only the reader's OVERRIDE lives in React, and it
 * describes the chrome rather than the query: every selection stays in the URL,
 * so a pasted link reproduces the slice regardless of whether the person who
 * sent it had the row expanded.
 */
export function FilterRow({
  children,
  more,
  activeCount,
  action,
  pending,
  className,
}: {
  /** The controls that are always visible. */
  children: React.ReactNode;
  /** The secondary controls, behind "More filters". Omit for none. */
  more?: React.ReactNode;
  /** How many of the `more` controls currently hold a selection. */
  activeCount?: number;
  /** Right-aligned, e.g. "Show all salons". */
  action?: React.ReactNode;
  pending?: boolean;
  className?: string;
}) {
  const held = activeCount ?? 0;
  /*
   * DERIVED, NOT SYNCHRONISED.
   *
   * The row's default is "open when a secondary filter is holding a selection",
   * and that has to hold for a pasted link and for Back as well as for a fresh
   * mount — a URL that arrives with an equipment level set must not render the
   * row closed with the control out of reach.
   *
   * An effect that pushed `held > 0` into state would do that and would also be
   * a cascading render for a value that is already available at render time.
   * So the reader's choice is stored as an OVERRIDE and the default is computed:
   * null means "follow the filters", and a click pins it either way. Nothing to
   * keep in step, and no render spent on it.
   *
   * Collapsing the row over a held filter is still honest, because the count
   * travels on the pill — "More filters · 2" says what is hidden.
   */
  const [override, setOverride] = React.useState<boolean | null>(null);
  const open = override ?? held > 0;

  return (
    <div
      className={cn(
        "flex min-w-0 flex-wrap items-center gap-2",
        pending && "opacity-70",
        className,
      )}
    >
      <span className="eyebrow mr-0.5 shrink-0 text-subtle-foreground">Filters</span>
      {children}
      {more ? (
        <>
          {open ? more : null}
          <button
            type="button"
            onClick={() => setOverride(!open)}
            aria-expanded={open}
            /*
             * THE NEAR-BLACK PILL, at the end of the row. Near-black because
             * this is generic "the control that's on" rather than a semantic
             * state — the same reason a holding filter pill is navy and not
             * yellow or coral.
             */
            className="pill-action ml-auto shrink-0 bg-selected text-selected-foreground transition-colors hover:bg-selected-hover"
          >
            <SlidersHorizontal aria-hidden className="size-3" />
            {open ? "Fewer filters" : "More filters"}
            {held > 0 ? (
              <span className="tabular-nums opacity-75">· {held}</span>
            ) : null}
          </button>
        </>
      ) : null}
      {action ? (
        <div className={cn("shrink-0", more ? "" : "ml-auto")}>{action}</div>
      ) : null}
    </div>
  );
}
