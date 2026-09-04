"use client";

import * as React from "react";

import { MARGIN_PX, PAGE_PX } from "@/lib/forms/paper";
import { cn } from "@/lib/utils/cn";
import type { FormBlock } from "@/lib/forms/document";

/**
 * THE PAPER.
 *
 * A white Letter sheet at the same proportions and margins as the PDF, because
 * the whole point of editing a form as a document is that you can see whether
 * it fits. The geometry is imported from `lib/forms/paper.ts`, which the PDF
 * renderer imports too.
 *
 * The sheet is a fixed 816px wide and scales down on narrow screens with a
 * transform rather than reflowing. Reflowing would be worse than useless here:
 * a page you can only trust at one width is not a page.
 */

export function Sheet({
  children,
  pageNumber,
  pageCount,
  className,
}: {
  children: React.ReactNode;
  pageNumber: number;
  pageCount: number;
  className?: string;
}) {
  return (
    <div
      data-form-page={pageNumber}
      className={cn(
        "relative shrink-0 bg-white text-black shadow-float ring-1 ring-black/10",
        className,
      )}
      style={{
        width: PAGE_PX.width,
        minHeight: PAGE_PX.height,
        paddingTop: MARGIN_PX.top,
        paddingBottom: MARGIN_PX.bottom,
        paddingLeft: MARGIN_PX.left,
        paddingRight: MARGIN_PX.right,
      }}
    >
      {children}

      {/*
        The footer the PDF prints, shown in the same place so the page you edit
        is the page you get. Positioned inside the bottom margin, not in the
        content flow, so adding a block never pushes it around.
      */}
      <p
        className="absolute right-0 left-0 text-center text-[9px] tracking-wide text-black/40"
        style={{ bottom: Math.round(MARGIN_PX.bottom / 2.4) }}
      >
        Page {pageNumber} of {pageCount}
      </p>
    </div>
  );
}

/**
 * A scrollable workspace holding one or more sheets.
 *
 * The light workspace behind the paper is what makes it read as a document
 * rather than as a panel — it is the one place in Ask Sunny that deliberately
 * looks like a print preview.
 */
export function Workspace({
  children,
  gutter,
  className,
}: {
  children: React.ReactNode;
  /**
   * Room to the left of the paper for the per-block controls.
   *
   * They sit at -44px so they stay off the printable page, and the workspace
   * scrolls horizontally — so without this the reorder and gear buttons were
   * CLIPPED by the scroll container's edge and could not be clicked at all.
   * Found by a click timing out in QA, which is exactly the kind of thing a
   * screenshot does not show.
   */
  gutter?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("overflow-x-auto rounded-[var(--radius-lg)] bg-surface-muted p-6", className)}>
      <div
        className={cn(
          "mx-auto flex w-fit flex-col items-center gap-6",
          gutter && "pl-12",
        )}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * Splits a block list into pages on explicit `page_break` blocks.
 *
 * ONLY on explicit breaks. Guessing where the printer will break — measuring
 * rendered heights and cutting when a sheet fills — would put the screen and
 * the PDF into an argument neither can win, because the PDF wraps with its own
 * font metrics. The renderer already keeps a block whole and starts a new sheet
 * when one will not fit; what the editor promises is narrower and true: the
 * breaks you PUT here are the breaks you get.
 *
 * The break block itself is returned with the page it ends, so the editor can
 * still show it, select it and delete it.
 */
export interface DocumentPage {
  blocks: { block: FormBlock; index: number }[];
  /** Index of the `page_break` that closed this page, if any. */
  breakIndex: number | null;
}

export function paginate(blocks: readonly FormBlock[]): DocumentPage[] {
  const pages: DocumentPage[] = [];
  let current: DocumentPage = { blocks: [], breakIndex: null };

  blocks.forEach((block, index) => {
    if (block.kind === "page_break") {
      current.breakIndex = index;
      pages.push(current);
      current = { blocks: [], breakIndex: null };
      return;
    }
    current.blocks.push({ block, index });
  });

  // A trailing break leaves an empty final page. Keep it: the administrator put
  // it there, and silently swallowing it would make the control feel broken.
  pages.push(current);
  return pages;
}
