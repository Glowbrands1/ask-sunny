"use client";

import * as React from "react";
import { ChevronDown, ChevronUp, FilePlus2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { formRequestPhrase } from "@/lib/forms/template-intent";
import { cn } from "@/lib/utils/cn";
import type { ChatFormChoice, ChatFormSelection } from "@/types";

/**
 * ============================================================================
 * WHICH FORM? — ONE CARD, THEN THE REST ON REQUEST
 * ============================================================================
 *
 * The answer to an unnamed form request used to be every form this manager may
 * create, written into the message as a bullet list. It was correct — the rule
 * that Sunny asks rather than defaults is the one thing this workstream will
 * not give up — and it was thirteen forms of prose in a chat bubble.
 *
 * So the everyday form is offered on its own, and the rest are one click away.
 *
 * WHAT THIS COMPONENT DOES NOT DO, and each of these was a way to get it wrong:
 *
 *   IT HOLDS NO LIST OF FORMS. Names and descriptions arrive on the message,
 *   projected from the published `form_templates` rows the server already
 *   filtered by permission. A form nobody may create never reaches here, and a
 *   renamed template reads correctly with no change to this file.
 *
 *   IT CREATES NOTHING. A card sends the sentence a manager could have typed,
 *   through the composer, so a chosen form and a typed form arrive at
 *   `proposeFormForTurn` as the same request — where the key is resolved
 *   against the library and the template's permission applied again. There is
 *   no second creation path, and no card that skips a check.
 *
 *   IT SELECTS NOTHING. The primary card is where most people start, shown
 *   rather than assumed. Until it is clicked, no template is decided.
 */
export function FormPicker({
  selection,
  onChoose,
  className,
}: {
  selection: ChatFormSelection;
  /** Sends the request through the composer, like any other turn. */
  onChoose: (phrase: string) => void;
  className?: string;
}) {
  const [expanded, setExpanded] = React.useState(false);

  /*
   * Never twice. The server builds `additional` with the primary removed, and
   * this holds even if a stored conversation from an earlier build carried it
   * in both places — a duplicate card reads as two different forms.
   */
  const additional = selection.additional.filter(
    (entry) => entry.templateKey !== selection.primary.templateKey,
  );

  return (
    <div className={cn("mt-4", className)}>
      <FormChoiceCard choice={selection.primary} recommended onChoose={onChoose} />

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
              /*
               * One column on a phone, two from the small breakpoint up. The
               * cards carry no fixed width and the descriptions wrap, so the
               * thread never scrolls sideways.
               */
              className="mt-1 grid grid-cols-1 gap-2 sm:grid-cols-2"
            >
              {additional.map((entry) => (
                <FormChoiceCard key={entry.templateKey} choice={entry} onChoose={onChoose} />
              ))}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

/**
 * One form, where the whole card is the control.
 *
 * The recommended form is tinted rather than badged. It is already first and,
 * before the list is expanded, the only one on screen — a "recommended" label
 * would be telling the manager something they can see.
 */
function FormChoiceCard({
  choice,
  recommended,
  onChoose,
}: {
  choice: ChatFormChoice;
  recommended?: boolean;
  onChoose: (phrase: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChoose(formRequestPhrase(choice.templateName))}
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
          {choice.templateName}
        </span>
      </span>
      <span
        className={cn(
          "mt-1 text-xs leading-relaxed",
          recommended ? "text-primary-soft-foreground/85" : "text-muted-foreground",
        )}
      >
        {choice.description}
      </span>
    </button>
  );
}
