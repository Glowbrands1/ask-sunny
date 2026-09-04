"use client";

import * as React from "react";
import {
  AlignCenter,
  Columns2,
  Hand,
  Heading,
  Image as ImageIcon,
  List,
  ListOrdered,
  Minus,
  PenLine,
  Redo2,
  Scissors,
  SlidersHorizontal,
  SquareCheck,
  Type,
  Undo2,
  Zap,
} from "lucide-react";

import { Tooltip, TooltipProvider } from "@/components/ui/overlays";
import { cn } from "@/lib/utils/cn";
import type { FormBlock } from "@/lib/forms/document";

/**
 * THE DOCUMENT TOOLBAR.
 *
 * Every button inserts one of the block kinds the nine reference forms actually
 * use, and there is deliberately nothing else. A font-family picker or a colour
 * well would be a promise this engine cannot keep: the PDF is drawn with two
 * embedded metrics (Helvetica and Helvetica-Bold) and a black-and-white section
 * bar, so a red heading on screen would print black and the editor would be
 * lying.
 *
 * That is the line: this is a FORM designer with a document surface, not a word
 * processor. The list below is the whole vocabulary, and it maps one-to-one onto
 * `FormBlock`.
 */

export interface ToolbarAction {
  key: string;
  label: string;
  hint: string;
  icon: React.ReactNode;
  block?: FormBlock;
}

/** The blocks a new insert starts from. Each is immediately editable in place. */
export const INSERTS: ToolbarAction[] = [
  {
    key: "section",
    label: "Section heading",
    hint: "A black bar across the page — Employee Information, Type Of Warning",
    icon: <Heading className="size-4" />,
    block: { kind: "section", label: "New Section" },
  },
  {
    key: "paragraph",
    label: "Paragraph",
    hint: "Body wording that prints as written",
    icon: <Type className="size-4" />,
    block: { kind: "paragraph", text: "New paragraph." },
  },
  {
    key: "note",
    label: "Small print",
    hint: "Smaller, quieter text for instructions",
    icon: <Minus className="size-4" />,
    block: { kind: "note", text: "Note." },
  },
  {
    key: "field",
    label: "Field on a rule",
    hint: "One labelled line somebody or Ask Sunny fills",
    icon: <Zap className="size-4" />,
    block: {
      kind: "field",
      field: { key: "new_field", label: "New field", input: "text", responsibility: "manager" },
    },
  },
  {
    key: "field_row",
    label: "Two fields side by side",
    hint: "The two-up rows — Employee Name / Date",
    icon: <Columns2 className="size-4" />,
    block: {
      kind: "field_row",
      fields: [
        { key: "left_field", label: "Left", input: "text", responsibility: "manager" },
        { key: "right_field", label: "Right", input: "text", responsibility: "manager" },
      ],
    },
  },
  {
    key: "long_field",
    label: "Ruled writing area",
    hint: "Several lines — Observation, Plan of Action",
    icon: <List className="size-4" />,
    block: {
      kind: "field",
      field: {
        key: "new_long_field",
        label: "New writing area",
        input: "long_text",
        responsibility: "manager",
      },
    },
  },
  {
    key: "checkbox_group",
    label: "Checkboxes",
    hint: "A tick list — Type Of Coaching, Type Of Offense",
    icon: <SquareCheck className="size-4" />,
    block: {
      kind: "checkbox_group",
      key: "new_group",
      label: "New checkbox group",
      options: [
        { key: "option_1", label: "First option" },
        { key: "option_2", label: "Second option" },
      ],
      responsibility: "manager",
      columns: 3,
    },
  },
  {
    key: "numbered_list",
    label: "Numbered lines",
    hint: "1. 2. 3. — Overall top three strengths",
    icon: <ListOrdered className="size-4" />,
    block: {
      kind: "numbered_list",
      key: "new_list",
      label: "New numbered list",
      count: 3,
      responsibility: "manager",
    },
  },
  {
    key: "signature_row",
    label: "Signature line",
    hint: "Always blank, always signed by hand",
    icon: <PenLine className="size-4" />,
    block: { kind: "signature_row", label: "Signature", dateLabel: "Date" },
  },
  {
    key: "acknowledgement",
    label: "Acknowledgement",
    hint: "The confirmation wording above the signatures",
    icon: <Hand className="size-4" />,
    block: {
      kind: "acknowledgement",
      text: "I confirm that my supervisor and I have discussed this document.",
    },
  },
  {
    key: "reference",
    label: "Position description",
    hint: "The boxed role copy the DMIT EPP prints for the reviewed position",
    icon: <AlignCenter className="size-4" />,
    block: {
      kind: "reference",
      label: "Printed for the reviewed position",
      body: ["General Purpose", "New line"],
    },
  },
  {
    key: "letterhead",
    label: "Letterhead",
    hint: "The brand chip and the form's title",
    icon: <ImageIcon className="size-4" />,
    block: { kind: "letterhead", brand: "SUN TAN CITY", title: "New Form" },
  },
  {
    key: "page_break",
    label: "Page break",
    hint: "Everything after this prints on the next sheet",
    icon: <Scissors className="size-4" />,
    block: { kind: "page_break" },
  },
];

export function DocumentToolbar({
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onInsert,
  onPageSetup,
  selectionLabel,
  className,
}: {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onInsert: (block: FormBlock) => void;
  onPageSetup: () => void;
  /** What an insert will land after, so the toolbar is not a mystery. */
  selectionLabel: string;
  className?: string;
}) {
  return (
    <TooltipProvider>
      <div
        className={cn(
          "sticky top-2 z-20 mx-auto flex w-fit max-w-full flex-wrap items-center gap-1 rounded-full border border-border bg-surface/95 px-2.5 py-1.5 shadow-float backdrop-blur",
          className,
        )}
      >
        <ToolButton label="Undo" disabled={!canUndo} onClick={onUndo}>
          <Undo2 className="size-4" />
        </ToolButton>
        <ToolButton label="Redo" disabled={!canRedo} onClick={onRedo}>
          <Redo2 className="size-4" />
        </ToolButton>

        <span className="mx-1 h-5 w-px bg-border" />

        <span className="px-1.5 text-[11px] whitespace-nowrap text-muted-foreground">
          Insert after {selectionLabel}
        </span>

        {INSERTS.map((action) => (
          <ToolButton
            key={action.key}
            label={action.label}
            hint={action.hint}
            onClick={() => action.block && onInsert(structuredClone(action.block))}
          >
            {action.icon}
          </ToolButton>
        ))}

        <span className="mx-1 h-5 w-px bg-border" />

        <ToolButton label="Page setup" hint="Paper and the form's own settings" onClick={onPageSetup}>
          <SlidersHorizontal className="size-4" />
        </ToolButton>
      </div>
    </TooltipProvider>
  );
}

function ToolButton({
  label,
  hint,
  disabled,
  onClick,
  children,
}: {
  label: string;
  hint?: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip content={hint ? `${label} — ${hint}` : label}>
      <button
        type="button"
        aria-label={label}
        disabled={disabled}
        onClick={onClick}
        className={cn(
          "flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors",
          "hover:bg-hover-surface hover:text-foreground",
          "disabled:pointer-events-none disabled:opacity-35",
        )}
      >
        {children}
      </button>
    </Tooltip>
  );
}
