"use client";

import * as React from "react";

import {
  blockAppliesToVariant,
  type FieldResponsibility,
  type FormBlock,
  type FormDocument,
  type FormVariant,
} from "@/lib/forms/document";
import { cn } from "@/lib/utils/cn";

import { BlockControls } from "./block-controls";
import { BlockView, type BlockValues, type DocumentMode } from "./block-view";
import { Sheet, Workspace, paginate } from "./paper";

/**
 * THE DOCUMENT, ON PAPER, IN WHICHEVER MODE THE CALLER NEEDS.
 *
 * This is the component the template editor and the manager's fill screen both
 * render. It owns three things and nothing else: which sheet a block belongs to,
 * which block is selected, and the controls that appear beside a selected block
 * in edit mode. Everything about what a block LOOKS like lives in `BlockView`,
 * and everything about what a block MEANS lives in the document model.
 *
 * Blocks are filtered through `blocksForVariant` first, so switching the role
 * reading of a DMIT EPP shows exactly the sheet that reading prints — including
 * dropping the blocks scoped to the other reading. That filtering is the same
 * function the PDF renderer calls.
 *
 * INDICES ARE THE DOCUMENT'S, NOT THE PAGE'S. A block on page 3 still edits at
 * its real position in `document.blocks`; the page split is presentation. Get
 * that wrong and a reorder on the last page rewrites the first.
 */
export function DocumentSurface({
  document: doc,
  mode,
  variant,
  values,
  editable,
  selectedIndex,
  onSelect,
  onValue,
  onToggle,
  onEditBlock,
  onMove,
  onDelete,
  onSettings,
  className,
}: {
  document: FormDocument;
  mode: DocumentMode;
  variant: FormVariant | null;
  values?: BlockValues;
  editable?: readonly FieldResponsibility[];
  selectedIndex?: number | null;
  onSelect?: (index: number | null) => void;
  onValue?: (key: string, value: string) => void;
  onToggle?: (key: string, option: string) => void;
  onEditBlock?: (index: number, next: FormBlock) => void;
  onMove?: (index: number, direction: -1 | 1) => void;
  onDelete?: (index: number) => void;
  onSettings?: (index: number) => void;
  className?: string;
}) {
  /*
   * The variant filter keeps each block's ORIGINAL index, because that is what
   * an edit writes back to. Filtering to a new array first and editing by its
   * position would rewrite the wrong block the moment one reading hides a block
   * the other prints.
   */
  const visible = React.useMemo(
    () =>
      doc.blocks
        .map((block, index) => ({ block, index }))
        .filter((entry) => blockAppliesToVariant(entry.block, variant?.key ?? null)),
    [doc.blocks, variant?.key],
  );

  const pages = React.useMemo(() => paginate(visible.map((entry) => entry.block)), [visible]);

  // `paginate` works on the filtered list, so map its positions back.
  let cursor = 0;
  const pagesWithIndices = pages.map((page) => {
    const blocks = page.blocks.map(() => visible[cursor++]!);
    const breakEntry = page.breakIndex === null ? null : visible[cursor++]!;
    return { blocks, breakEntry };
  });

  const editing = mode === "edit";

  return (
    <Workspace gutter={editing} className={className}>
      {pagesWithIndices.map((page, pageIndex) => (
        <React.Fragment key={pageIndex}>
          <Sheet pageNumber={pageIndex + 1} pageCount={pagesWithIndices.length}>
            <div className="space-y-[10px]" onClick={() => editing && onSelect?.(null)}>
              {page.blocks.map((entry) => (
                <BlockShell
                  key={`${entry.index}-${entry.block.kind}`}
                  entry={entry}
                  editing={editing}
                  selected={selectedIndex === entry.index}
                  total={doc.blocks.length}
                  onSelect={onSelect}
                  onMove={onMove}
                  onDelete={onDelete}
                  onSettings={onSettings}
                >
                  <BlockView
                    block={entry.block}
                    mode={mode}
                    variant={variant}
                    values={values}
                    editable={editable}
                    onValue={onValue}
                    onToggle={onToggle}
                    onEditBlock={(next) => onEditBlock?.(entry.index, next)}
                  />
                </BlockShell>
              ))}
            </div>
          </Sheet>

          {page.breakEntry ? (
            <PageBreakSeam
              editing={editing}
              selected={selectedIndex === page.breakEntry.index}
              onSelect={() => onSelect?.(page.breakEntry!.index)}
              onDelete={() => onDelete?.(page.breakEntry!.index)}
            />
          ) : null}
        </React.Fragment>
      ))}
    </Workspace>
  );
}

function BlockShell({
  entry,
  editing,
  selected,
  total,
  children,
  onSelect,
  onMove,
  onDelete,
  onSettings,
}: {
  entry: { block: FormBlock; index: number };
  editing: boolean;
  selected: boolean;
  total: number;
  children: React.ReactNode;
  onSelect?: (index: number | null) => void;
  onMove?: (index: number, direction: -1 | 1) => void;
  onDelete?: (index: number) => void;
  onSettings?: (index: number) => void;
}) {
  if (!editing) return <div>{children}</div>;

  const settingsWorthOpening =
    entry.block.kind !== "letterhead" &&
    entry.block.kind !== "paragraph" &&
    entry.block.kind !== "note" &&
    entry.block.kind !== "acknowledgement";

  return (
    <div
      className={cn(
        "group/block relative rounded-[3px] transition-colors",
        // A 1px inset ring rather than a border: a border would move the block
        // by a pixel on selection and the whole page would twitch.
        selected ? "ring-1 ring-[#e8a020]" : "hover:ring-1 hover:ring-black/10",
      )}
      onClick={(event) => {
        event.stopPropagation();
        onSelect?.(entry.index);
      }}
    >
      <BlockControls
        selected={selected}
        label={entry.block.kind.replace(/_/g, " ")}
        canMoveUp={entry.index > 0}
        canMoveDown={entry.index < total - 1}
        onMoveUp={() => onMove?.(entry.index, -1)}
        onMoveDown={() => onMove?.(entry.index, 1)}
        onSettings={settingsWorthOpening ? () => onSettings?.(entry.index) : undefined}
        onDelete={() => onDelete?.(entry.index)}
      />
      {children}
    </div>
  );
}

/**
 * The seam between two sheets.
 *
 * The reference forms show PAGE BREAK as a thing on the page, and they are right
 * to: it is the one piece of layout an administrator has to be able to see and
 * move, because it decides what a signature page has above it.
 */
function PageBreakSeam({
  editing,
  selected,
  onSelect,
  onDelete,
}: {
  editing: boolean;
  selected: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  if (!editing) {
    return (
      <div className="flex w-full items-center gap-3 px-2 text-[10px] tracking-[0.18em] text-muted-foreground uppercase">
        <span className="h-px flex-1 bg-border" />
        page break
        <span className="h-px flex-1 bg-border" />
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex w-full items-center gap-3 rounded-full px-3 py-1 text-[10px] tracking-[0.18em] uppercase transition-colors",
        selected
          ? "bg-[#fdf0d5] text-[#7a4c00] ring-1 ring-[#e8a020]"
          : "text-muted-foreground hover:bg-hover-surface",
      )}
    >
      <span className="h-px flex-1 bg-current opacity-30" />
      page break
      <span
        role="button"
        tabIndex={0}
        aria-label="Delete page break"
        onClick={(event) => {
          event.stopPropagation();
          onDelete();
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.stopPropagation();
          onDelete();
        }}
        className="rounded-full px-2 py-0.5 hover:bg-black/10"
      >
        remove
      </span>
      <span className="h-px flex-1 bg-current opacity-30" />
    </button>
  );
}
