"use client";

import { useEffect, useRef } from "react";
import { ArrowUp, Info } from "lucide-react";

import { SunMark } from "@/components/brand-mark";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/controls";
import { Tooltip } from "@/components/ui/overlays";
import {
  ANSWER_MODE_HELPER,
  ANSWER_MODE_LABEL,
  MANAGER_NOTE,
  MANAGER_NOTE_SHORT,
} from "@/data/demo/chat";
import { cn } from "@/lib/utils/cn";
import type { AnswerMode } from "@/types";

const MODES: AnswerMode[] = ["quick", "standard", "detailed"];

const MODE_OPTIONS = MODES.map((mode) => ({
  value: mode,
  label: ANSWER_MODE_LABEL[mode],
}));

/**
 * ============================================================================
 * THE COMPOSER IS A CONTROL, NOT A PANEL
 * ============================================================================
 *
 * THE FEEDBACK THIS ANSWERS. On a laptop the answer had less room than the box
 * used to ask for it. Four things were taking that room, and only one of them
 * was the input:
 *
 *   a full-width answer-mode row, above the input, on its own line;
 *   a helper sentence under that row restating what the three labels say;
 *   three DISABLED buttons — attach, image, voice — plus a "Coming later" label;
 *   the manager note, at three wrapped lines.
 *
 * The text field itself was already right: one row, grows as you type, caps and
 * scrolls. It has not been touched.
 *
 * SO THE MODE CONTROL MOVED INSIDE the composer surface, onto the row that
 * already existed for the send button, and the two blocks of explanatory prose
 * became one line and one info affordance. Nothing about answer modes changed:
 * same three values, same state, same request payload.
 *
 * THE DEAD CONTROLS ARE GONE RATHER THAN RESTYLED. They were honest — visibly
 * disabled, with a tooltip saying what they would one day do — and honesty was
 * not the problem. A manager reading a screen does not distinguish "not built
 * yet" from "broken"; they see three controls that do not work. They come back
 * when they work.
 *
 * WHAT THE NOTE KEEPS. The visible line is the first clause of the standing note
 * verbatim, not a summary of it, and the full text is on the info affordance
 * beside the modes. A safety note nobody has room to read is not a safety note,
 * but neither is one that has been quietly shortened into something weaker.
 *
 * ============================================================================
 * ONE DOCK, AT THE BOTTOM, IN EVERY STATE
 * ============================================================================
 *
 * The Marquee Chat artifact: "Where you type is near-black; where you read is
 * peach and white... the input docks to the bottom — so the page is bookended
 * in dark chrome with the conversation running as a document between them."
 *
 * It briefly had a second `hero` variant for the empty state, where the artifact
 * draws the ask card up inside the band. That was removed on report: a composer
 * that sits at the top for the first question and at the bottom for every one
 * after it moves the place you type the moment you use it. The dark-at-the-edges
 * principle holds either way, and the dock is the artifact's own State 2.
 *
 * Item 8 is what the dock is measured against: "about 110px total. On the
 * current tab that stack runs past 230px on a laptop, which is why answers read
 * through a keyhole."
 *
 * THE MODE CONTROL MOVED OUT OF THE INPUT SURFACE, onto the artifact's `.under`
 * row where it sits beside the disclaimer on ONE line. That still answers the
 * original complaint — it is not a full-width row of its own above the input —
 * and it is what the artifact draws. `AnswerModeControl` is exported so the
 * band header can render the same control in the empty state without a second
 * copy of the options list.
 */
export function Composer({
  value,
  onChange,
  onSubmit,
  mode,
  onModeChange,
  busy,
  autoFocus,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  mode: AnswerMode;
  onModeChange: (mode: AnswerMode) => void;
  busy: boolean;
  autoFocus?: boolean;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Unchanged. One row at rest, grows with the content, stops at 200px and
  // scrolls inside itself from there.
  useEffect(() => {
    const node = textareaRef.current;
    if (!node) return;
    node.style.height = "auto";
    node.style.height = `${Math.min(200, node.scrollHeight)}px`;
  }, [value]);

  const submit = () => {
    if (!value.trim() || busy) return;
    onSubmit();
  };

  /* The input surface, identical in both variants apart from its scale. */
  const field = (
    <>
      <label htmlFor="chat-input" className="sr-only">
        Ask Sunny a question
      </label>
      <textarea
        id="chat-input"
        ref={textareaRef}
        rows={1}
        value={value}
        autoFocus={autoFocus}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            submit();
          }
        }}
        placeholder="Ask about policy, coaching, operations or performance — or ask Sunny to draft a form"
        className="scroll-slim max-h-50 w-full resize-none bg-transparent text-[14px] leading-relaxed text-foreground placeholder:text-placeholder-foreground focus-visible:outline-none"
      />
    </>
  );

  const sendButton = (
    <button
      type="button"
      onClick={submit}
      disabled={!value.trim() || busy}
      aria-label="Send message"
      /*
        THE ROUND YELLOW SEND. Yellow is a fill here rather than an encoded
        value, and it is one of the two filled blocks the direction allows a
        screen.
      */
      className="grid size-[38px] shrink-0 place-items-center rounded-full bg-brand-yellow text-brand-yellow-foreground transition-opacity disabled:opacity-40"
    >
      <ArrowUp className="size-[15px]" strokeWidth={2.5} />
    </button>
  );

  return (
    /*
      THE DOCK. Near-black with the 4px yellow top edge, so the page is
      bookended in dark chrome and the conversation between them reads as a
      document on paper.
    */
    <div className="shrink-0 border-t-4 border-brand-yellow bg-band px-4 pt-4 pb-3.5 sm:px-6">
      <div className="flex items-center gap-3.5 rounded-[var(--radius-lg)] bg-surface py-3 pr-3.5 pl-4.5 shadow-ask focus-within:shadow-ask-focus">
        <SunMark className="size-[26px] shrink-0" onDark />
        <div className="flex min-w-0 flex-1 items-center">{field}</div>
        {sendButton}
      </div>

      {/*
        THE `.under` ROW: the mode control and one line of disclaimer, side by
        side. Two things that were three stacked blocks.
      */}
      <div className="mt-2.5 flex flex-wrap items-center gap-3.5">
        <AnswerModeControl mode={mode} onModeChange={onModeChange} />
        <p className="min-w-50 flex-1 text-[10.5px] leading-snug text-band-label">
          {MANAGER_NOTE_SHORT}
        </p>
      </div>
    </div>
  );
}

/**
 * THE ANSWER-MODE CONTROL, PLUS THE EXPLANATION THAT TRAVELS WITH IT.
 *
 * Exported because the band renders it in the empty state and the dock renders
 * it in the answered state, and the artifact shows the same control in both.
 * Two copies would be two option lists and two tooltips to keep in step.
 *
 * Radix ToggleGroup, so it is a real radio-style group: arrow keys move between
 * options, the selection carries `data-state` rather than only a colour, and
 * each option is its own labelled button.
 */
export function AnswerModeControl({
  mode,
  onModeChange,
  className,
}: {
  mode: AnswerMode;
  onModeChange: (mode: AnswerMode) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 items-center gap-1", className)}>
      <SegmentedControl
        ariaLabel="Answer mode"
        /*
          The brand tone, because this is the answer-length control the band
          also shows and the two must not disagree. Every other segmented
          control keeps the near-black selected state, so yellow stays reserved
          for the two things the direction spends it on: this, and the rail pill
          that says where you are.
        */
        tone="brand"
        value={mode}
        onValueChange={(next) => onModeChange(next as AnswerMode)}
        options={MODE_OPTIONS}
      />

      {/*
        THE TWO REMOVED BLOCKS OF PROSE, IN ONE FOCUSABLE AFFORDANCE. A real
        button rather than a hover target on static text: a tooltip that only
        appears on hover is not reachable by keyboard or by touch, which would
        have moved the explanation out of the way by making it unavailable.
      */}
      <Tooltip
        content={
          <div className="space-y-1.5">
            <ul className="space-y-1">
              {MODES.map((entry) => (
                <li key={entry}>{ANSWER_MODE_HELPER[entry]}</li>
              ))}
            </ul>
            <p className="border-t border-border pt-1.5">{MANAGER_NOTE}</p>
          </div>
        }
      >
        <Button
          variant="ghost"
          size="iconSm"
          type="button"
          aria-label="About answer modes and Sunny's limits"
          className="shrink-0 text-band-muted-foreground hover:text-hover-surface-foreground"
        >
          <Info />
        </Button>
      </Tooltip>
    </div>
  );
}
