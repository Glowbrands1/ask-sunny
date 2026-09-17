"use client";

import { useState } from "react";
import { ArrowUp, X } from "lucide-react";

import { SunMark } from "@/components/brand-mark";
import { ConversationRating } from "@/features/chat/conversation-rating";
import { useInlineAsk } from "@/features/chat/use-inline-ask";
import { AnswerSheet } from "@/features/dashboard/answer-sheet";

/**
 * THE BAND'S ASK BAR, SCOPED TO THE REVIEW QUEUE.
 *
 * IT ANSWERS HERE rather than throwing the reader at the chat screen, for the
 * reason the report tabs already record: being sent elsewhere means reading the
 * answer with the queue no longer on it. The same shared `useInlineAsk` send
 * path, so a reply drafted here is a real chat turn in the same history and
 * audit trail, and `AnswerSheet` still offers "Continue in Ask Sunny" on the
 * newest exchange.
 *
 * THE SUGGESTED QUESTION NAMES THE OLDEST UNANSWERED REVIEW and carries no
 * figures — a salon and a rating, which is what identifies which review to
 * draft a reply to. It degrades to the general question when the queue is
 * empty.
 */
export function ReviewsAskBar({
  oldestOpen,
}: {
  oldestOpen: { locationName: string; rating: number; reviewerName: string } | null;
}) {
  const question = oldestOpen
    ? `Draft a reply to the ${oldestOpen.rating}-star Google review at Sun Tan City ${oldestOpen.locationName} from ${oldestOpen.reviewerName}, and tell me what to coach the Salon Director on.`
    : "How should we work the Google review queue this week, and what should I coach?";

  const [value, setValue] = useState("");
  const { send, busy, conversationId, exchanges, reset, ratingTarget, recordFeedback } =
    useInlineAsk({ surface: "google_reviews" });

  const submit = (text: string) => {
    const asked = text.trim() || question;
    setValue("");
    void send(asked);
  };

  const newestFirst = [...exchanges].reverse();

  return (
    <div>
      <div className="flex items-center gap-3 rounded-[14px] bg-surface py-2.5 pr-3 pl-4 shadow-ask focus-within:shadow-ask-focus">
        <SunMark className="size-6 shrink-0" onDark />
        <label htmlFor="reviews-ask" className="sr-only">
          Ask Sunny about reviews
        </label>
        <textarea
          id="reviews-ask"
          rows={1}
          value={value}
          disabled={busy}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit(value);
            }
          }}
          placeholder={`Ask Sunny about reviews — ${question}`}
          className="scroll-slim max-h-24 min-w-0 flex-1 resize-none bg-transparent text-[13.5px] leading-snug text-foreground placeholder:text-placeholder-foreground focus-visible:outline-none"
        />
        {conversationId ? (
          <button
            type="button"
            onClick={reset}
            aria-label="Clear this conversation"
            className="grid size-7 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-hover-surface hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => submit(value)}
          disabled={busy}
          aria-label="Ask Sunny about reviews"
          className="grid size-[34px] shrink-0 place-items-center rounded-full bg-brand-yellow text-brand-yellow-foreground transition-opacity disabled:opacity-40"
        >
          <ArrowUp className="size-3.5" strokeWidth={2.5} />
        </button>
      </div>

      {busy ? (
        <p
          className="mt-2.5 flex items-center gap-2.5 text-[11px] text-band-muted-foreground"
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
          Reading the review queue
        </p>
      ) : null}

      {/* The answer on paper, on the band — never prose printed on near-black. */}
      {conversationId && newestFirst.length > 0 ? (
        <div className="mt-3 overflow-hidden rounded-[var(--radius-lg)] bg-surface shadow-raised">
          {newestFirst.map((exchange, index) => (
            <div key={exchange.question.id}>
              <div className="flex flex-wrap items-baseline gap-2.5 border-b border-border-row px-5 pt-4 pb-3">
                <span className="eyebrow shrink-0">You asked</span>
                <span className="min-w-0 flex-1 text-[13.5px] font-bold text-foreground">
                  {exchange.question.content}
                </span>
              </div>
              {exchange.answer ? (
                <AnswerSheet
                  message={exchange.answer}
                  conversationId={conversationId}
                  onDismiss={reset}
                  onAsk={(next) => submit(next)}
                  showContinue={index === 0}
                />
              ) : null}
            </div>
          ))}

          {ratingTarget ? (
            <ConversationRating
              tone="panel"
              turnId={ratingTarget.turnId}
              messageId={ratingTarget.messageId}
              conversationId={conversationId}
              saved={ratingTarget.saved}
              onSaved={(feedback) => recordFeedback(ratingTarget.messageId, feedback)}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
