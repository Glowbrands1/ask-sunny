"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { ArrowUp, X } from "lucide-react";

import { SunMark } from "@/components/brand-mark";
import { SUGGESTED_PROMPTS } from "@/data/demo/chat";
import { getAIProvider } from "@/lib/ai";
import { useSession } from "@/lib/session/session-context";
import { useAppStore } from "@/lib/store/app-store";
import { cn } from "@/lib/utils/cn";
import { formatLongDate, greetingForHour, nowIso } from "@/lib/utils/date";
import { businessHour, businessToday } from "@/lib/business-date";
import { createId } from "@/lib/utils/id";
import { formatNumber } from "@/lib/utils/format";
import { toChatTurnError } from "@/features/chat/chat-error";
import { AnswerSheet } from "./answer-sheet";
import type { AnswerMode, ChatConversation, ChatMessage } from "@/types";

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
 * CAP IT, THEN HAND OFF: the Overview holds ONE question. A follow-up chip, or
 * "Continue in Ask Sunny", carries the conversation to the chat page rather than
 * growing a thread on a dashboard.
 */
export function AskBand({
  /** Told the Overview so it can collapse itself to a strip. */
  onActiveChange,
  className,
}: {
  onActiveChange?: (active: boolean) => void;
  className?: string;
}) {
  const { primaryLocationName, managerDisplayName, user } = useSession();
  const { documents, addConversation, updateConversation } = useAppStore();
  const provider = useMemo(() => getAIProvider(), []);

  const [value, setValue] = useState("");
  const [focused, setFocused] = useState(false);
  const [mode, setMode] = useState<AnswerMode>("standard");
  const [busy, setBusy] = useState(false);
  const [turn, setTurn] = useState<{
    question: string;
    mode: AnswerMode;
    conversationId: string;
    answer: ChatMessage | null;
  } | null>(null);

  const inputRef = useRef<HTMLTextAreaElement>(null);

  /*
   * THE REAL HOUR, IN THE BUSINESS ZONE — not the frozen prototype anchor read
   * as UTC, which greeted every manager at whatever time of day the anchor
   * happened to fall on. Taken from the branch this landed on, where it was
   * already fixed.
   */
  const greeting = greetingForHour(businessHour());
  /* Salon accounts are shared, so greet the team rather than the salon. */
  const greetingName = user.isSalonAccount
    ? `${user.name} team`
    : (user.name.split(" ")[0] ?? user.name);

  /* Announce active-ness so the Overview can collapse behind the answer. */
  const setActive = useCallback(
    (next: boolean) => onActiveChange?.(next),
    [onActiveChange],
  );

  const send = useCallback(
    async (rawText: string) => {
      const text = rawText.trim();
      if (!text || busy) return;

      setBusy(true);
      setValue("");
      setFocused(false);

      const userMessage: ChatMessage = {
        id: createId("msg"),
        role: "user",
        content: text,
        createdAt: nowIso(),
      };

      /*
       * The conversation is created BEFORE the answer arrives, for the same
       * reason the chat screen does it: if the request fails, the question and
       * the failure are both already in history rather than lost.
       */
      const conversation: ChatConversation = {
        id: createId("conv"),
        title: provider.titleForConversation(text),
        createdAt: userMessage.createdAt,
        updatedAt: userMessage.createdAt,
        attachedDocumentIds: [],
        messages: [userMessage],
      };
      addConversation(conversation);

      setTurn({ question: text, mode, conversationId: conversation.id, answer: null });
      setActive(true);

      try {
        const response = await provider.ask({
          question: text,
          mode,
          history: [],
          /* Provenance for a form proposal; names browser-local state only. */
          questionMessageId: userMessage.id,
          /*
           * NO `todayIso`. The route fills the date from its own clock — the
           * browser used to send the frozen anchor and the route preferred it,
           * so every freshness judgement was made against a day already past.
           */
          context: {
            userName: managerDisplayName,
            locationName: primaryLocationName,
          },
        });

        const assistantMessage: ChatMessage = {
          id: createId("msg"),
          role: "assistant",
          content: response.content,
          createdAt: nowIso(),
          mode,
          citations: response.citations,
          coverage: response.coverage ?? "not_applicable",
          recommendedVideoIds: response.recommendedVideoIds,
          followUpSuggestions: response.followUpSuggestions,
          /*
           * A PROPOSAL, NOT A DRAFT. `formHandoff` and the pending-value bags
           * are gone rather than deprecated on this branch: between them they
           * carried HR field values through browser-local chat state. A
           * proposal names the template, the person and the salon, nothing else.
           */
          formProposal: response.formProposal,
          formSelection: response.formSelection,
        };

        updateConversation(conversation.id, {
          messages: [userMessage, assistantMessage],
          updatedAt: assistantMessage.createdAt,
        });
        setTurn((current) =>
          current && current.conversationId === conversation.id
            ? { ...current, answer: assistantMessage }
            : current,
        );
      } catch (caught) {
        /* A failed turn is a visible, stored turn — never silence. */
        const errorMessage: ChatMessage = {
          id: createId("msg"),
          role: "assistant",
          content: "",
          createdAt: nowIso(),
          mode,
          error: toChatTurnError(caught, text),
        };
        updateConversation(conversation.id, {
          messages: [userMessage, errorMessage],
          updatedAt: errorMessage.createdAt,
        });
        setTurn((current) =>
          current && current.conversationId === conversation.id
            ? { ...current, answer: errorMessage }
            : current,
        );
      } finally {
        setBusy(false);
      }
    },
    [
      busy,
      mode,
      provider,
      addConversation,
      updateConversation,
      managerDisplayName,
      primaryLocationName,
      setActive,
    ],
  );

  const reset = () => {
    setTurn(null);
    setValue("");
    setActive(false);
  };

  /* Typing = focused or holding text, and not already showing a turn. */
  const typing = (focused || value.trim().length > 0) && !turn;

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
          value={turn ? turn.question : value}
          onChange={setValue}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onSubmit={() => void send(value)}
          onClear={turn ? reset : () => { setValue(""); inputRef.current?.focus(); }}
          typing={typing}
          locked={Boolean(turn)}
          busy={busy}
          prompts={BAND_PROMPTS}
          onPrompt={(prompt) => void send(prompt)}
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

      {/* --------------------------------------------------------- answer -- */}
      {turn?.answer ? (
        <AnswerSheet
          message={turn.answer}
          conversationId={turn.conversationId}
          onDismiss={reset}
        />
      ) : null}
    </section>
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
  locked,
  busy,
  prompts,
  onPrompt,
}: {
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  value: string;
  onChange: (next: string) => void;
  onFocus: () => void;
  onBlur: () => void;
  onSubmit: () => void;
  onClear: () => void;
  typing: boolean;
  locked: boolean;
  busy: boolean;
  prompts: string[];
  onPrompt: (prompt: string) => void;
}) {
  const showPlaceholderBlock = !typing && !locked && value.length === 0;

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
        locked ? "items-center" : "items-start",
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
          readOnly={locked}
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
        {!locked ? (
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

      {typing || locked || value.length > 0 ? (
        <button
          type="button"
          onClick={onClear}
          aria-label={locked ? "Dismiss this answer" : "Clear"}
          className="grid size-[26px] shrink-0 place-items-center rounded-full bg-clear-surface text-muted-foreground transition-colors hover:text-foreground"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      ) : null}

      <button
        type="button"
        onClick={onSubmit}
        disabled={busy || locked || value.trim().length === 0}
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
