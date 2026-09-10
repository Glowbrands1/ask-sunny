"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { ArrowUp, X } from "lucide-react";

import { SunMark } from "@/components/brand-mark";
import { SUGGESTED_PROMPTS } from "@/data/demo/chat";
import { useSession } from "@/lib/session/session-context";
import { useAppStore } from "@/lib/store/app-store";
import { cn } from "@/lib/utils/cn";
import { formatLongDate, formatTime, greetingForHour } from "@/lib/utils/date";
import { businessHour, businessToday } from "@/lib/business-date";
import { formatNumber } from "@/lib/utils/format";
import { useInlineAsk } from "@/features/chat/use-inline-ask";
import { AnswerSheet } from "./answer-sheet";
import type { AnswerMode, ChatMessage } from "@/types";

const MODES: { value: AnswerMode; label: string }[] = [
  { value: "quick", label: "Quick" },
  { value: "standard", label: "Standard" },
  { value: "detailed", label: "Detailed" },
];

/** The four the direction shows, taken from the app's own prompt list. */
const BAND_PROMPTS = SUGGESTED_PROMPTS.slice(0, 4);

/**
 * =============================================================================
 * THE BAND — Ask Sunny stops being a card and becomes the top of the page
 * =============================================================================
 *
 * The direction's central move: a near-black surface with real area across the
 * top third, carrying the greeting and a REAL INPUT a manager can type into the
 * moment the page loads. Before this, Ask Sunny was a white card in the middle
 * of the Overview with an "Open" button — the page talked about the assistant
 * instead of offering it.
 *
 * FIVE STATES, all of them here:
 *
 *   1. At rest      the bar is the first thing on the page
 *   2. Typing       yellow focus glow, coral caret, clear control, the answer
 *                   length selector appears, the prompts stay reachable
 *   3. Thinking     yellow dots and the real knowledge-base document count
 *   4. Answered     the answer lands on PAPER under the bar, not on near-black
 *   5. Collapsed    the overview behind it collapses to one strip (rendered by
 *                   the Overview itself, which owns that content)
 *
 * WHY THE ANSWER IS ON WHITE: a six-paragraph policy answer read on near-black
 * is worse than on white, so the band stays dark and the sheet under it is
 * paper, with the reading measure held near 78 characters.
 *
 * AN INLINE ANSWER IS A REAL CHAT TURN. This writes to the same conversation
 * store the chat screen uses, through the same provider, so a question typed on
 * the dashboard appears in history exactly as if it had been asked on the chat
 * page. The direction is explicit that anything else would lose an audit trail
 * for advice a manager may act on.
 *
 * IT HOLDS A CONVERSATION, NOT ONE QUESTION. This was capped at a single turn:
 * once an answer landed the composer went read-only and every route onward went
 * to the chat page. Asked to be lifted, because answering a policy question
 * usually takes two or three exchanges and walking to another screen for the
 * second one loses the thing that made asking here worth it.
 *
 * SO THE THREAD IS THE CONVERSATION IN THE STORE, not local state. The band
 * keeps only the conversation's ID and reads its messages back from the same
 * store the chat page reads, which buys three things that a local array would
 * not: the exchange survives a refresh, `history` sent with each follow-up is
 * the real thread rather than an empty list, and "Continue in Ask Sunny" still
 * adopts the SAME conversation instead of replaying it.
 *
 * NEWEST EXCHANGE FIRST, which is the one place this deliberately departs from
 * the chat page. The composer is at the TOP here — it is the band — so a
 * chronological thread would push each new answer further below the fold and
 * make the manager scroll to read what they just asked for. Question and answer
 * stay together as a pair; the pairs run newest to oldest.
 *
 * WHAT STILL HANDS OFF: creating a form. That is a multi-step flow against a
 * real instance and a pinned template version, and it lives on the chat page —
 * the Overview must not grow a second path into HR records.
 */
export function AskBand({
  /** Told the Overview so it can collapse itself to a strip. */
  onActiveChange,
  className,
}: {
  onActiveChange?: (active: boolean) => void;
  className?: string;
}) {
  const { primaryLocationName, user } = useSession();
  /* Only the document COUNT is read here — the shared hook owns the thread. */
  const { documents } = useAppStore();

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const greeting = greetingForHour(businessHour());
  /* Salon accounts are shared, so greet the team rather than the salon. */
  const greetingName = user.isSalonAccount
    ? `${user.name} team`
    : (user.name.split(" ")[0] ?? user.name);

  const [value, setValue] = useState("");
  const [focused, setFocused] = useState(false);

  /*
   * THE SEND PATH IS SHARED WITH THE REPORT TABS' ASK BAR — see
   * `features/chat/use-inline-ask.ts`. Everything this file used to hold here
   * (the conversation id, the thread read back from the store, the provider
   * call, the failed-turn append, the exchange pairing) moved there unchanged
   * when the report tabs were asked to answer in place too. Two copies would be
   * two audit trails to keep in step, and a question quietly missing from
   * history is exactly the gap the notes above warn about.
   */
  const { send, busy, mode, setMode, conversationId, exchanges, reset: resetThread } =
    useInlineAsk({ onActiveChange });

  const submit = useCallback(
    (text: string) => {
      setValue("");
      setFocused(false);
      void send(text);
    },
    [send],
  );

  const reset = () => {
    resetThread();
    setValue("");
  };

  /* Typing = focused, or holding text. */
  const typing = focused || value.trim().length > 0;

  /*
   * NEWEST EXCHANGE FIRST, which is the one place this deliberately departs
   * from the chat page. The composer is at the TOP here — it is the band — so a
   * chronological thread would push each new answer further below the fold and
   * make the manager scroll to read what they just asked for. The hook returns
   * oldest-first, so the reversal is this file's decision.
   */
  const newestFirst = useMemo(() => [...exchanges].reverse(), [exchanges]);

  return (
    <section
      aria-label="Ask Sunny"
      className={cn("shrink-0 border-b-4 border-brand-yellow bg-band", className)}
      /* The corner glow: the one sanctioned appearance of the red-light red. */
      style={{ backgroundImage: "var(--band-glow)" }}
    >
      <div className="px-5 pt-6 pb-7 sm:px-6">
        {/* ---------------------------------------------------- band head -- */}
        <div className="mb-4 flex flex-col gap-3 sm:mb-[18px] sm:flex-row sm:items-end sm:gap-4">
          <div className="min-w-0">
            <h1 className="display text-[26px] text-band-foreground sm:text-[30px]">
              {greeting},{" "}
              <span className="text-brand-yellow">{greetingName}</span>
            </h1>
            <p className="mt-1.5 text-xs text-band-muted-foreground">
              {formatLongDate(businessToday())}
            </p>
          </div>

          {/*
            THE ANSWER LENGTH SELECTOR TAKES THE LOCATION PILL'S PLACE while
            typing. Both are the same object in the direction — the top-right
            slot of the band — because a manager choosing how long an answer
            should be is doing it in the same second they type, and a control
            that is always on screen is one more thing to read at 7am.

            It is not decorative: `quick | standard | detailed` is the
            AnswerMode the chat API already takes, so this drives the real
            request.
          */}
          {typing ? (
            <div
              role="radiogroup"
              aria-label="Answer length"
              className="flex shrink-0 gap-0.5 rounded-full border border-band-pill-border bg-band-chip-surface p-[3px] sm:ml-auto"
            >
              {MODES.map((option) => {
                const on = option.value === mode;
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    /* Keep focus in the composer: choosing a length must not
                       collapse the typing state it belongs to. */
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      setMode(option.value);
                      inputRef.current?.focus();
                    }}
                    className={cn(
                      "rounded-full px-2.5 py-1.5 text-[9px] font-black tracking-[0.07em] uppercase transition-colors",
                      on
                        ? "bg-brand-yellow text-brand-yellow-foreground"
                        : "text-band-muted-foreground hover:text-band-chip-foreground",
                    )}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          ) : (
            <span className="pill-action shrink-0 self-start border border-band-pill-border text-brand-yellow sm:ml-auto sm:self-auto">
              {primaryLocationName}
            </span>
          )}
        </div>

        {/* -------------------------------------------------------- the ask -- */}
        <AskCard
          inputRef={inputRef}
          value={value}
          onChange={setValue}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onSubmit={() => submit(value)}
          /*
           * X CLEARS THE SMALLEST THING FIRST: a half-typed question if there
           * is one, otherwise the whole inline exchange. Reversing that would
           * mean one keystroke on Escape wipes a conversation the manager was
           * mid-way through adding to.
           */
          onClear={() => {
            if (value.length > 0) {
              setValue("");
              inputRef.current?.focus();
              return;
            }
            reset();
          }}
          typing={typing}
          busy={busy}
          /* The cold-start prompts, and only at cold start: once there is an
             exchange the answer's own follow-ups are the better next step. */
          prompts={exchanges.length === 0 ? BAND_PROMPTS : []}
          onPrompt={(prompt) => submit(prompt)}
          resettable={exchanges.length > 0}
        />

        {/* ------------------------------------------------------ thinking -- */}
        {busy ? (
          <p
            className="mt-3.5 flex items-center gap-2.5 text-[11.5px] text-band-muted-foreground"
            aria-live="polite"
          >
            <span className="flex items-center gap-1" aria-hidden>
              {[1, 0.55, 0.28].map((opacity, index) => (
                <span
                  key={index}
                  className="size-1.5 rounded-full bg-brand-yellow"
                  style={{
                    opacity,
                    animation: "sunny-pulse-dot 1.1s ease-in-out infinite",
                    animationDelay: `${index * 0.16}s`,
                  }}
                />
              ))}
            </span>
            {/*
              THE KNOWLEDGE BASE STAYS VISIBLE while Sunny reads. The count is
              the real number of documents in scope — not a decorative figure —
              so it goes up when somebody uploads a policy.
            */}
            Reading {formatNumber(documents.length)}{" "}
            {documents.length === 1 ? "document" : "documents"} in your knowledge base
          </p>
        ) : null}
      </div>

      {/* -------------------------------------------------------- answers -- */}
      {conversationId
        ? newestFirst.map((exchange, index) => (
            <div key={exchange.question.id}>
              {/*
                THE QUESTION, ABOVE ITS OWN ANSWER. With one turn the composer
                held the question and nothing else was needed. In a thread the
                composer is empty and ready for the next one, so each exchange
                has to say what was asked or the answers read as replies to
                nothing.
              */}
              <AskedLine message={exchange.question} />
              {exchange.answer ? (
                <AnswerSheet
                  message={exchange.answer}
                  conversationId={conversationId}
                  onDismiss={reset}
                  /* Follow-ups continue HERE now. Handing off mid-thought is
                     what this change exists to stop. */
                  onAsk={(question) => submit(question)}
                  /* One hand-off link, on the newest exchange. Repeating it
                     under every answer is a column of the same button. */
                  showContinue={index === 0}
                />
              ) : null}
            </div>
          ))
        : null}
    </section>
  );
}

/* ========================================================================== */

/** The manager's own turn, on the paper, above the answer it produced. */
function AskedLine({ message }: { message: ChatMessage }) {
  return (
    <div className="flex flex-wrap items-baseline gap-2.5 border-b border-border-row bg-background px-5 pt-4 pb-3 sm:px-6">
      <span className="eyebrow shrink-0">You asked</span>
      <span className="min-w-0 flex-1 text-[13.5px] font-bold text-foreground">
        {message.content}
      </span>
      <span className="shrink-0 text-[10.5px] text-muted-foreground">
        {formatTime(message.createdAt)}
      </span>
    </div>
  );
}

/* ========================================================================== */

function AskCard({
  inputRef,
  value,
  onChange,
  onFocus,
  onBlur,
  onSubmit,
  onClear,
  typing,
  busy,
  prompts,
  onPrompt,
  resettable,
}: {
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  value: string;
  onChange: (next: string) => void;
  onFocus: () => void;
  onBlur: () => void;
  onSubmit: () => void;
  onClear: () => void;
  typing: boolean;
  busy: boolean;
  prompts: string[];
  onPrompt: (prompt: string) => void;
  /** There is an inline exchange to clear, so offer the control. */
  resettable: boolean;
}) {
  /*
   * THE COMPOSER IS NEVER READ-ONLY ANY MORE.
   *
   * It used to be `locked` the moment an answer arrived — the textarea went
   * `readOnly`, its value was forced back to the question that had been asked,
   * and the send button was disabled. That WAS the one-question cap, and it is
   * gone: the field stays live and empty so the next question can be typed
   * straight into it. `busy` still disables it for the length of a request,
   * which is what stops a double send.
   *
   * The at-rest block (the display-face invitation) shows only at cold start,
   * because a two-line invitation above an exchange that is already underway is
   * asking a manager to start something they are in the middle of.
   */
  const showPlaceholderBlock = !typing && !resettable && value.length === 0;

  return (
    <div
      className={cn(
        "flex gap-4 rounded-[18px] bg-surface transition-shadow duration-200",
        /*
         * The controls align to the LINE BEING TYPED ON, not to the middle of
         * the card. Whenever the suggestion chips are showing, the card is tall
         * and centring floats the send button halfway down the chip stack —
         * which reads as belonging to the chips rather than to the input.
         */
        "items-start",
        showPlaceholderBlock ? "p-[18px] pl-5" : "p-[17px] pl-5",
      )}
      /*
        The hard yellow underline is the ask bar at rest; focus ADDS the glow
        rather than replacing it, so the bar never changes shape as you type.
      */
      style={{ boxShadow: typing ? "var(--shadow-ask-focus)" : "var(--shadow-ask)" }}
    >
      {/*
        The sun inside the card is brand, not function, and at 390px it costs
        50px of the line a manager is typing on — which pushed the text and the
        suggestion chips into a narrow column. The mark is already in the chrome
        directly above, so below `sm` the input gets the width instead.

        The direction specifies no mobile behaviour at all (every mockup is
        min-width 960), so this is a judgement call rather than the artifact's.
      */}
      <SunMark
        className={cn("hidden shrink-0 sm:block", showPlaceholderBlock && "mt-0.5", "size-[34px]")}
        onDark
      />

      <div className="min-w-0 flex-1">
        {showPlaceholderBlock ? (
          <label htmlFor="band-ask" className="block cursor-text">
            <span className="display mb-0.5 block text-[18px] text-foreground">
              Ask Sunny anything about running your salon
            </span>
            <span className="block text-[15px] text-placeholder-foreground">
              Policy, coaching, operations, performance, training — with the
              source shown every time.
            </span>
          </label>
        ) : null}

        {/*
          One real textarea in every state. The at-rest treatment is a LABEL
          above it rather than a placeholder attribute, because the direction
          sets that line in the display face at 18px and a placeholder cannot
          carry two type treatments — but it is a label, so clicking it focuses
          the field and screen readers still get one named input.
        */}
        <textarea
          id="band-ask"
          ref={inputRef}
          rows={1}
          value={value}
          disabled={busy}
          onFocus={onFocus}
          onBlur={onBlur}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              onSubmit();
            }
            if (event.key === "Escape") onClear();
          }}
          aria-label="Ask Sunny a question"
          placeholder={showPlaceholderBlock ? undefined : "Ask Sunny a question"}
          className={cn(
            "w-full resize-none bg-transparent text-foreground outline-none placeholder:text-placeholder-foreground",
            showPlaceholderBlock
              ? "mt-2 h-6 text-[15px]"
              : "text-base font-bold",
            /*
              THE CARET IS CORAL. The one place the attention colour appears
              without meaning attention — it is the text cursor, and the
              direction draws it that way because a 2px yellow caret on white
              is invisible.
            */
            "caret-measure-flagged",
          )}
        />

        {/* Suggestions are CONTENT, so they live inside the card and align to
            the words above them — not to the card's outer edge. They stay
            reachable while typing, which is the point of putting them here. */}
        {prompts.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {prompts.map((prompt) => (
              <button
                key={prompt}
                type="button"
                disabled={busy}
                /* mousedown, not click: a blur would drop the typing state
                   before the click ever landed. */
                onMouseDown={(event) => {
                  event.preventDefault();
                  onPrompt(prompt);
                }}
                className="rounded-full border border-border-strong bg-background px-3.5 py-1.5 text-[11.5px] font-bold text-foreground transition-colors hover:border-brand-yellow disabled:opacity-50"
              >
                {prompt}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {typing || resettable || value.length > 0 ? (
        <button
          type="button"
          onClick={onClear}
          aria-label={value.length > 0 ? "Clear" : "Clear this conversation"}
          className="grid size-[26px] shrink-0 place-items-center rounded-full bg-clear-surface text-muted-foreground transition-colors hover:text-foreground"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      ) : null}

      <button
        type="button"
        onClick={onSubmit}
        disabled={busy || value.trim().length === 0}
        aria-label="Ask Sunny"
        className={cn(
          "grid size-11 shrink-0 place-items-center rounded-full bg-brand-yellow text-brand-yellow-foreground transition-opacity disabled:opacity-45",
          showPlaceholderBlock && "mt-0.5",
        )}
      >
        <ArrowUp className="size-[17px]" strokeWidth={2.4} aria-hidden />
      </button>
    </div>
  );
}
