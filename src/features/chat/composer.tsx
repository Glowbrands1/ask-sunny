"use client";

import { useEffect, useRef } from "react";
import { ArrowUp, ImagePlus, Mic, Paperclip } from "lucide-react";

import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/controls";
import { Tooltip } from "@/components/ui/overlays";
import { ANSWER_MODE_HELPER, ANSWER_MODE_LABEL, MANAGER_NOTE } from "@/data/demo/chat";
import { cn } from "@/lib/utils/cn";
import type { AnswerMode } from "@/types";

const MODE_OPTIONS = (["quick", "standard", "detailed"] as AnswerMode[]).map(
  (mode) => ({ value: mode, label: ANSWER_MODE_LABEL[mode] }),
);

/**
 * Composer.
 *
 * Text input works. File attach, image attach, and voice are rendered as
 * clearly disabled affordances with a tooltip that says what they will do —
 * they are never made to look functional.
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
    <div className="border-t border-border bg-[color-mix(in_srgb,var(--background)_92%,transparent)] px-4 pt-3.5 pb-4 backdrop-blur-md sm:px-6">
      <div className="mx-auto w-full max-w-3xl">
        {/* Answer mode */}
        <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <SegmentedControl
            ariaLabel="Answer mode"
            value={mode}
            onValueChange={(next) => onModeChange(next as AnswerMode)}
            options={MODE_OPTIONS}
          />
          <p className="text-xs text-muted-foreground">{ANSWER_MODE_HELPER[mode]}</p>
        </div>

        {/* Input */}
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
            <div className="flex items-center gap-0.5">
              {[
                {
                  icon: Paperclip,
                  label: "Attach a file",
                  hint: "Coming later — attach a PDF, Daily Stats export, Word or Excel file and it stays in context for the rest of the conversation.",
                },
                {
                  icon: ImagePlus,
                  label: "Attach an image",
                  hint: "Coming later — send a photo of a report, a schedule, or an equipment display.",
                },
                {
                  icon: Mic,
                  label: "Voice input",
                  hint: "Coming later — speak your question instead of typing it.",
                },
              ].map((affordance) => (
                <Tooltip key={affordance.label} content={affordance.hint}>
                  {/* span wrapper: disabled buttons do not fire the events a tooltip needs */}
                  <span className="inline-flex">
                    <Button
                      variant="ghost"
                      size="iconSm"
                      disabled
                      aria-label={`${affordance.label} (coming later)`}
                      className="!opacity-40"
                    >
                      <affordance.icon />
                    </Button>
                  </span>
                </Tooltip>
              ))}
              <span className="ml-1 hidden text-[11px] text-subtle-foreground sm:inline">
                Coming later
              </span>
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

        <p className="mt-2.5 text-[11px] leading-relaxed text-subtle-foreground">
          {MANAGER_NOTE}
        </p>
      </div>
    </div>
  );
}
