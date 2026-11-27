"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, FileText, Info, Paperclip, X } from "lucide-react";

import { SunMark } from "@/components/brand-mark";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/controls";
import { Tooltip } from "@/components/ui/overlays";
import {
  ANSWER_MODE_HELPER,
  ANSWER_MODE_LABEL,
  MANAGER_NOTE,
  MANAGER_NOTE_SHORT,
} from "@/data/answer-modes";
import { cn } from "@/lib/utils/cn";
import { LONG_MESSAGE_LIMIT, messageLengthStatus } from "@/lib/chat/message-limit";
import { chatLongMessageClientEnabled } from "@/lib/config/chat-quality-flags";
import { VoiceButton } from "@/features/voice/voice-button";
import { appendTranscript } from "@/features/voice/voice-draft";
import { CHAT_ATTACH_ACCEPT, MAX_FILES_PER_MESSAGE, attachmentProblem } from "@/lib/attachments/file-parts";
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
 *
 * ============================================================================
 * THE ATTACH BUTTON CAME BACK WHEN IT WORKED (Pau, 26 Nov 2026)
 * ============================================================================
 *
 * One paperclip inside the input pill, where the dead attach button used to sit beside it, so the dock is no taller
 * at rest. Files waiting to be sent show as chips above the pill, each with its remove button, only while there are
 * any. The DM L10 panel's mechanism (`features/l10/assistant/attachments.ts`): the same limits (5 files, 10 MB each),
 * the same browser-side encoding; the main chat also takes Word, Excel and text files, which the server reads as text
 * (an older .doc or .xls is refused by name, with how to re-save it). Paste and drop add files too, as in the panel.
 * The row keeps room for one more round button beside it (a dictation mic, planned separately).
 */
export function Composer({
  value,
  onChange,
  onSubmit,
  mode,
  onModeChange,
  busy,
  autoFocus,
  conversationId,
  onVoiceText,
  files = [],
  onFilesChange,
  fileError,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  /** Files waiting to be sent with the next question. Without `onFilesChange` there is no attach button. */
  files?: File[];
  onFilesChange?: (files: File[]) => void;
  /** A picked file the browser could not read when the question was sent. */
  fileError?: string;
  mode: AnswerMode;
  onModeChange: (mode: AnswerMode) => void;
  /**
   * A turn is in flight.
   *
   * THE ONLY REASON THIS FIELD EVER REFUSES INPUT. There used to be a second —
   * `blocked`, meaning the previous answer had not been rated — and it is gone
   * along with the rule behind it. A composer that stops accepting questions
   * until somebody fills in a rating is a composer people conclude is broken.
   */
  busy: boolean;
  autoFocus?: boolean;
  /** VOICE_INPUT_ENABLED: the conversation the mic's spelling hints come from, when there is one. */
  conversationId?: string | null;
  /** VOICE_INPUT_ENABLED: told the transcript the mic put in the box, so the send can say it came from voice. */
  onVoiceText?: (transcript: string, traceId: string) => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  /* VOICE_INPUT_ENABLED: the mic's notices and errors sit where the length notice does. */
  const [voiceSlot, setVoiceSlot] = useState<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileNote, setFileNote] = useState("");
  const attaching = Boolean(onFilesChange);
  const atFileLimit = files.length >= MAX_FILES_PER_MESSAGE;

  /* The panel's `addFiles`: refused files are named in one line; past the limit, the rest are left out and it says so. */
  const addFiles = (picked: FileList | File[] | null | undefined) => {
    if (!onFilesChange || !picked) return;
    const problems: string[] = [];
    const ok: File[] = [];
    for (const file of Array.from(picked)) {
      const problem = attachmentProblem(file, "chat");
      if (problem) problems.push(problem);
      else ok.push(file);
    }
    const room = Math.max(0, MAX_FILES_PER_MESSAGE - files.length);
    if (ok.length > room) problems.push(`Limit of ${MAX_FILES_PER_MESSAGE} files reached.`);
    if (room > 0 && ok.length > 0) onFilesChange([...files, ...ok.slice(0, room)]);
    setFileNote(problems.join(" "));
  };

  // Unchanged. One row at rest, grows with the content, stops at 200px and
  // scrolls inside itself from there.
  useEffect(() => {
    const node = textareaRef.current;
    if (!node) return;
    node.style.height = "auto";
    node.style.height = `${Math.min(200, node.scrollHeight)}px`;
  }, [value]);

  /*
   * CHAT_LONG_MESSAGE_ENABLED (QA approved, 25 Oct 2026): the limit is
   * 12,000 characters. From 90% of it a line under the field says how many
   * are left; over it, the line says how long the message is and send is
   * disabled. The text is never cut. Off, `length` is null and the composer
   * renders and sends exactly as before.
   */
  const length = chatLongMessageClientEnabled() ? messageLengthStatus(value, LONG_MESSAGE_LIMIT) : null;
  const overLimit = length !== null && !length.canSend;

  const hasSomething = value.trim() !== "" || files.length > 0;
  const submit = () => {
    if (!hasSomething || busy || overLimit) return;
    setFileNote("");
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
        disabled={busy}
        autoFocus={autoFocus}
        aria-describedby={length?.notice ? "chat-input-length" : undefined}
        onChange={(event) => onChange(event.target.value)}
        onPaste={(event) => {
          if (!attaching || !event.clipboardData?.files?.length) return;
          event.preventDefault();
          addFiles(event.clipboardData.files);
        }}
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
      disabled={!hasSomething || busy || overLimit}
      aria-label="Send message"
      /*
        THE ROUND YELLOW SEND. Yellow is a fill here rather than an encoded
        value, and it is one of the two filled blocks the direction allows a
        screen.
      */
      className="clay-sun-button grid size-11 shrink-0 place-items-center rounded-full text-brand-yellow-foreground transition-opacity disabled:opacity-40"
    >
      <ArrowUp className="size-[15px]" strokeWidth={2.5} />
    </button>
  );

  const attachButton = attaching ? (
    <>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={CHAT_ATTACH_ACCEPT}
        className="hidden"
        data-testid="chat-attach-input"
        onChange={(event) => {
          addFiles(event.target.files);
          event.target.value = "";
        }}
      />
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={busy || atFileLimit}
        aria-label={atFileLimit ? `Limit of ${MAX_FILES_PER_MESSAGE} files reached` : "Attach a file"}
        title={atFileLimit ? `Limit of ${MAX_FILES_PER_MESSAGE} files reached` : "Attach a file: images, PDF, Word, Excel or text"}
        className="grid size-9 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-hover-surface hover:text-hover-surface-foreground disabled:opacity-40"
      >
        <Paperclip className="size-[17px]" />
      </button>
    </>
  ) : null;

  return (
    /*
      THE DOCK. Near-black with the 4px yellow top edge, so the page is
      bookended in dark chrome and the conversation between them reads as a
      document on paper.
    */
    <div
      className="clay-band mx-3 mb-3 shrink-0 px-4 pt-4 pb-3.5 sm:px-6"
      onDragOver={(event) => {
        if (attaching && event.dataTransfer?.types?.includes("Files")) event.preventDefault();
      }}
      onDrop={(event) => {
        if (!attaching || !event.dataTransfer?.files?.length) return;
        event.preventDefault();
        addFiles(event.dataTransfer.files);
      }}
    >
      {files.length > 0 ? (
        <ul aria-label="Files to send" className="mb-2.5 flex flex-wrap gap-1.5">
          {files.map((file, index) => (
            <li
              key={`${file.name}-${index}`}
              data-testid="chat-attachment-chip"
              className="inline-flex min-h-8 max-w-full items-center gap-1.5 rounded-full bg-surface py-0.5 pr-0.5 pl-3 text-xs font-semibold text-foreground"
            >
              <FileText aria-hidden className="size-3.5 shrink-0" />
              <span className="max-w-56 truncate">{file.name}</span>
              <button
                type="button"
                aria-label={`Remove ${file.name}`}
                onClick={() => onFilesChange?.(files.filter((_, at) => at !== index))}
                className="grid size-7 shrink-0 place-items-center rounded-full hover:bg-hover-surface"
              >
                <X className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex items-center gap-3.5 rounded-full bg-surface py-2.5 pr-2.5 pl-5 shadow-ask focus-within:shadow-ask-focus">
        <SunMark className="size-[26px] shrink-0" onDark />
        <div className="flex min-w-0 flex-1 items-center">{field}</div>
        {attachButton}
        {/*
          VOICE_INPUT_ENABLED: the mic, only for a person voice is on for (`useVoiceAccess`); otherwise nothing is
          rendered here. The transcript is appended to the text for the manager to check; Send is unchanged.
        */}
        <VoiceButton
          surface="chat"
          conversationId={conversationId ?? null}
          disabled={busy}
          messageSlot={voiceSlot}
          onText={(transcript, { traceId }) => {
            onChange(appendTranscript(value, transcript));
            onVoiceText?.(transcript, traceId);
            textareaRef.current?.focus();
          }}
          className="size-11 rounded-full text-muted-foreground hover:bg-hover-surface hover:text-foreground"
        />
        {sendButton}
      </div>

      {fileNote || fileError ? (
        <p role="alert" data-testid="chat-attachment-error" className="mt-2 text-[11.5px] leading-snug font-semibold text-brand-yellow">
          {fileNote || fileError}
        </p>
      ) : null}

      {length?.notice ? (
        <p
          id="chat-input-length"
          role={length.state === "over" ? "alert" : "status"}
          data-state={length.state}
          className={cn("mt-2 text-[11.5px] leading-snug", length.state === "over" ? "font-semibold text-brand-yellow" : "text-band-label")}
        >
          {length.notice}
        </p>
      ) : null}
      <div ref={setVoiceSlot} id="chat-input-voice" />

      {/*
        THE `.under` ROW: the mode control and one line of disclaimer, side by
        side. Two things that were three stacked blocks.
      */}
      {/*
        NO "PLEASE RATE THE ANSWER ABOVE BEFORE ASKING YOUR NEXT QUESTION" LINE.

        It was here, in yellow, and it was accurate — the field really did stop
        accepting questions. Both are gone: rating is a passive action at the
        foot of the conversation and nothing in the composer consults it.
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
