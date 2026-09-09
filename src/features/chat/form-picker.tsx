"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, FilePlus2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { selectableTemplates } from "@/lib/forms/chat-flow";
import { cn } from "@/lib/utils/cn";
import type { FormSelection, FormTemplate } from "@/types";

/**
 * THE FORM PICKER, INSIDE THE CONVERSATION.
 *
 * "Create a form from this conversation" names no form, and the honest answer
 * is a question — so this asks it. The everyday form is offered on its own and
 * the other twelve stay collapsed behind "See more forms": a manager who wants
 * the Coaching Form (most of them, most days) sees one card, and a manager who
 * wants the Prescreen form is two clicks away rather than reading a library.
 *
 * Three things it deliberately does NOT do:
 *
 *   1. It does not pre-select. Nothing is created until a card is clicked, and
 *      the form that gets created is the one the manager named.
 *   2. It does not carry its own list of forms. Names and descriptions come
 *      from the template registry through `selectableTemplates`, so a new or
 *      renamed template appears here with no change to this file.
 *   3. It does not navigate. Expanding happens in place — the expanded state is
 *      local to this message, so scrolling away, sending another turn, or
 *      opening a second picker later in the thread leaves it as it was.
 */
export function FormPicker({
  selection,
  templates,
  onSelect,
  className,
}: {
  selection: FormSelection;
  /** The app's templates. Filtered and ordered by `selectableTemplates`. */
  templates: FormTemplate[];
  onSelect: (template: FormTemplate) => void;
  className?: string;
}) {
  const { primary, additional } = selectableTemplates(templates, selection);
  const [expanded, setExpanded] = useState(false);

  if (!primary && additional.length === 0) return null;

  return (
    <div className={cn("mt-4", className)}>
      {primary ? (
        <FormOption template={primary} recommended onSelect={onSelect} />
      ) : null}

      {additional.length > 0 ? (
        <>
          <Button
            variant="ghost"
            size="sm"
            className="mt-2 -ml-2"
            aria-expanded={expanded}
            onClick={() => setExpanded((open) => !open)}
          >
            {expanded ? <ChevronUp /> : <ChevronDown />}
            {expanded ? "Show less forms" : "See more forms"}
          </Button>

          {expanded ? (
            <div
              role="group"
              aria-label="More forms"
              className="mt-1 grid grid-cols-1 gap-2 sm:grid-cols-2"
            >
              {additional.map((template) => (
                <FormOption key={template.id} template={template} onSelect={onSelect} />
              ))}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

/**
 * One form, as a card the whole surface of which is the control.
 *
 * The recommended form is tinted rather than badged: it is already first and
 * already alone on screen, and a "recommended" label on the only visible
 * option would be telling the manager something they can see.
 */
function FormOption({
  template,
  recommended,
  onSelect,
}: {
  template: FormTemplate;
  recommended?: boolean;
  onSelect: (template: FormTemplate) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(template)}
      className={cn(
        "flex h-full w-full flex-col rounded-[var(--radius-md)] border px-3.5 py-3 text-left",
        "transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:shadow-raised",
        recommended
          ? "border-[color-mix(in_srgb,var(--primary)_22%,transparent)] bg-primary-soft hover:border-primary"
          : "border-border bg-surface-muted hover:border-border-strong",
      )}
    >
      <span className="flex items-start gap-2">
        {recommended ? (
          <span className="flex size-5 shrink-0 items-center justify-center rounded-[var(--radius-xs)] bg-surface text-primary">
            <FilePlus2 className="size-3" aria-hidden />
          </span>
        ) : null}
        <span
          className={cn(
            "text-[13.5px] leading-snug font-semibold",
            recommended ? "text-primary-soft-foreground" : "text-foreground",
          )}
        >
          {template.name}
        </span>
      </span>
      <span
        className={cn(
          "mt-1 text-xs leading-relaxed",
          recommended ? "text-primary-soft-foreground/85" : "text-muted-foreground",
        )}
      >
        {template.description}
      </span>
    </button>
  );
}
