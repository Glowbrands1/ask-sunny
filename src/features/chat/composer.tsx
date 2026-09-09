"use client";

import { useEffect, useRef } from "react";
import { ArrowUp, Info } from "lucide-react";

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

  return (
    <div className="shrink-0 border-t border-border bg-[color-mix(in_srgb,var(--background)_92%,transparent)] px-4 pt-3 pb-3 backdrop-blur-md sm:px-6">
      <div className="mx-auto w-full max-w-3xl">
        <div
          className={cn(
            "rounded-[var(--radius-lg)] border border-border-strong bg-surface p-2 shadow-soft transition-[border-color,box-shadow]",
            "focus-within:border-primary focus-within:shadow-raised",
          )}
        >
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
            placeholder="Ask about policies, coaching, operations, performance, training — or ask Sunny to create a form."
            className="scroll-slim max-h-50 w-full resize-none bg-transparent px-2.5 py-2 text-sm leading-relaxed text-foreground placeholder:text-subtle-foreground focus-visible:outline-none"
          />

          <div className="flex items-center justify-between gap-2 px-1 pt-1">
            <div className="flex min-w-0 items-center gap-1">
              {/*
                THE SAME CONTROL, ON A ROW THAT ALREADY EXISTED. Radix
                ToggleGroup, so it is a real radio-style group: arrow keys move
                between options, the selection carries `data-state` rather than
                only a colour, and each option is its own labelled button.
              */}
              <SegmentedControl
                ariaLabel="Answer mode"
                /*
                  The brand tone, because this is the answer-length control the
                  band also shows and the two must not disagree. Every other
                  segmented control keeps the near-black selected state, so
                  yellow stays reserved for the two things the direction spends
                  it on: this, and the rail pill that says where you are.
                */
                tone="brand"
                value={mode}
                onValueChange={(next) => onModeChange(next as AnswerMode)}
                options={MODE_OPTIONS}
              />

              {/*
                THE TWO REMOVED BLOCKS OF PROSE, IN ONE FOCUSABLE AFFORDANCE.
                A real button rather than a hover target on static text: a
                tooltip that only appears on hover is not reachable by keyboard
                or by touch, which would have moved the explanation out of the
                way by making it unavailable.
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
                  className="shrink-0 text-subtle-foreground"
                >
                  <Info />
                </Button>
              </Tooltip>
            </div>

            <Button
              size="iconSm"
              onClick={submit}
              disabled={!value.trim() || busy}
              aria-label="Send message"
            >
              <ArrowUp />
            </Button>
          </div>
        </div>

        <p className="mt-2 text-[11px] leading-snug text-subtle-foreground">
          {MANAGER_NOTE_SHORT}
        </p>
      </div>
    </div>
  );
}
