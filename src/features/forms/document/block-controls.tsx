"use client";

import * as React from "react";
import { ChevronDown, ChevronUp, Settings2, Trash2 } from "lucide-react";

import { cn } from "@/lib/utils/cn";

/**
 * THE CONTROLS THAT APPEAR ON A SELECTED BLOCK.
 *
 * They sit in the page's left margin, outside the printable area, so the
 * document keeps its shape while you work on it. Nothing here is visible until
 * a block is hovered or selected — a page permanently fringed with buttons is
 * not a document.
 *
 * Reordering is up/down rather than drag. Drag looks better in a screenshot and
 * is worse to use on a page this dense: the drop target between two rules of a
 * signature block is a few pixels tall, and getting it wrong silently reorders
 * a disciplinary record. Up and down cannot miss.
 */
export function BlockControls({
  selected,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
  onSettings,
  onDelete,
  label,
}: {
  selected: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onSettings?: () => void;
  onDelete: () => void;
  /** Named in every button's accessible label, so a screen reader is specific. */
  label: string;
}) {
  return (
    <div
      className={cn(
        "absolute top-0 -left-11 flex flex-col gap-[3px] transition-opacity",
        selected ? "opacity-100" : "opacity-0 group-hover/block:opacity-100",
      )}
    >
      <IconButton
        title={`Move ${label} up`}
        disabled={!canMoveUp}
        onClick={onMoveUp}
        icon={<ChevronUp className="size-3.5" />}
      />
      <IconButton
        title={`Move ${label} down`}
        disabled={!canMoveDown}
        onClick={onMoveDown}
        icon={<ChevronDown className="size-3.5" />}
      />
      {onSettings ? (
        <IconButton
          title={`${label} settings`}
          onClick={onSettings}
          icon={<Settings2 className="size-3.5" />}
        />
      ) : null}
      <IconButton
        title={`Delete ${label}`}
        onClick={onDelete}
        icon={<Trash2 className="size-3.5" />}
        destructive
      />
    </div>
  );
}

function IconButton({
  title,
  icon,
  onClick,
  disabled,
  destructive,
}: {
  title: string;
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className={cn(
        "flex size-7 items-center justify-center rounded-[var(--radius-sm)] border border-border bg-surface text-muted-foreground shadow-soft transition-colors",
        "hover:bg-hover-surface hover:text-foreground",
        "disabled:pointer-events-none disabled:opacity-35",
        destructive && "hover:border-status-failed/40 hover:text-status-failed",
      )}
    >
      {icon}
    </button>
  );
}
