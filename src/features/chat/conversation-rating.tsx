"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Star } from "lucide-react";

import { submitFeedback } from "@/lib/feedback/client";
import { logTurnEvent } from "@/lib/analytics/telemetry";
import {
  COMMENT_MAX_LENGTH,
  FEEDBACK_OUTCOMES,
  FEEDBACK_RATINGS,
  OUTCOME_LABEL,
  RATING_LABEL,
  feedbackDraftProblem,
  type FeedbackDraft,
  type FeedbackRating,
  type SavedFeedback,
} from "@/lib/feedback/types";
import { cn } from "@/lib/utils/cn";

/**
 * =============================================================================
 * RATE THIS CONVERSATION — PASSIVE, OPTIONAL, AND NEVER IN THE WAY
 * =============================================================================
 *
 * WHAT THIS REPLACES, because the difference is the whole change. `AnswerFeedback`
 * drew itself under EVERY answer, on every surface, saying "How helpful was this
 * answer? / Required before your next question" — and it meant it: the composer
 * refused input and every send path returned early until somebody rated. A
 * manager asking for a form was told to rate the question they had just been
 * asked, the form cards under it did nothing when clicked, and the conversation
 * looked like it had ended. Reviews are secondary; completing the person's task
 * is primary.
 *
 * So there is ONE control per conversation, it is a line of quiet text with a
 * star on it, and nothing anywhere waits on it. Everything else about feedback
 * is unchanged: same `submitFeedback`, same endpoint, same table, same
 * dashboard.
 *
 * =============================================================================
 * STILL ONE COMPONENT FOR EVERY ASK SUNNY SURFACE
 * =============================================================================
 *
 * Nine places can answer a question — the chat tab, the Overview band, the five
 * report ask bars, the Google Reviews bar and the Sales Totals panel — and this
 * renders under all of them. A control that differed by surface would produce
 * ratings that are not comparable, and the dashboard's premise is that a 2 from
 * the Spa Engagement bar means what a 2 from the chat tab means.
 *
 * =============================================================================
 * IT ATTACHES TO A TURN, WHICH IS WHY ANALYTICS STILL WORKS
 * =============================================================================
 *
 * `turnId` is the server's name for one answered turn — the `activity_events`
 * row — and it is what the rating is keyed to, so the role, the salon, the
 * surface and the topic are a join away and are already correct. The caller
 * picks that turn with `conversationRatingTarget`, which prefers an
 * already-rated turn so an edit upserts the existing row instead of opening a
 * second one. See `lib/feedback/conversation.ts`.
 *
 * NO TURN, NO CONTROL. An answer whose activity insert did not land has nothing
 * to attach a rating to, so this renders nothing rather than a form that would
 * fail on save with nothing the person could do about it.
 *
 * =============================================================================
 * ONLY THE STARS ARE REQUIRED
 * =============================================================================
 *
 * The outcome and the comment are offered and neither is demanded. A required
 * comment on a voluntary form is not a richer record; it is why the form gets
 * abandoned. The save button is never disabled — it stays enabled and SAYS what
 * is missing in `role="alert"`, which is the one thing a screen reader can
 * actually hear.
 *
 * THE STAR CONTROL IS A RADIO GROUP, NOT FIVE BUTTONS, so assistive technology
 * is told these five things are one choice with one answer, and arrow keys move
 * between them without a `keydown` handler to maintain.
 */
export function ConversationRating({
  turnId,
  conversationId,
  messageId,
  saved,
  onSaved,
  className,
  /**
   * Where this sits. `inline` is the chat thread's own foot; `panel` is a host
   * that draws it inside a bordered card and wants the row to span it.
   */
  tone = "inline",
}: {
  /** The turn the rating attaches to. No id, no control — see the header. */
  turnId: string | undefined;
  /** Browser-local, stored opaquely so a complaint can be traced to a thread. */
  conversationId?: string;
  messageId?: string;
  /** What this person already said about this conversation, if anything. */
  saved?: SavedFeedback;
  /**
   * Told the host that feedback now exists for this turn.
   *
   * The host persists it on the message, which is what makes the conversation
   * read as rated after a refresh and what stops it being asked about twice.
   * This component keeps no opinion about where feedback is stored — the chat
   * screen, the Overview band and the report bars all hold their threads
   * differently.
   */
  onSaved: (feedback: SavedFeedback) => void;
  className?: string;
  tone?: "inline" | "panel";
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<FeedbackDraft>(() =>
    saved
      ? {
          rating: saved.rating,
          gotWhatNeeded: saved.gotWhatNeeded,
          comment: saved.comment,
        }
      : { rating: null, gotWhatNeeded: null, comment: "" },
  );
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  /*
   * WHETHER THIS HOST GOT SOMETHING TO RATE.
   *
   * The production defect was invisible from the browser: an answer arrived,
   * this rendered nothing, and no signal said whether that was because the turn
   * was missing or because nobody scrolled. One line per mount closes that gap.
   *
   * KEYED ON THE TURN so a re-render is not a second line, and carrying an
   * opaque id and nothing else. There is no field here a question could reach.
   */
  const reported = useRef<string | null>(null);
  useEffect(() => {
    const key = turnId ?? "none";
    if (reported.current === key) return;
    reported.current = key;
    logTurnEvent(turnId ? "feedback.host.rateable" : "feedback.host.unrateable", {
      turnId: turnId ?? null,
      where: "ConversationRating",
    });
  }, [turnId]);

  if (!turnId) return null;

  const save = async () => {
    const complaint = feedbackDraftProblem(draft);
    if (complaint) {
      setProblem(complaint);
      return;
    }

    setBusy(true);
    setProblem(null);
    try {
      const feedback = await submitFeedback({
        turnId,
        /* Narrowed by `feedbackDraftProblem` returning null above. */
        rating: draft.rating as FeedbackRating,
        gotWhatNeeded: draft.gotWhatNeeded,
        comment: draft.comment,
        conversationId,
        messageId,
      });
      onSaved(feedback);
      setOpen(false);
    } catch (error) {
      /*
       * THE FAILURE IS SHOWN WHERE THE VALIDATION IS, and the form stays open
       * with the person's words intact. Losing a typed complaint to a failed
       * request would be a particularly bad way to handle feedback about things
       * going wrong.
       */
      setProblem(
        error instanceof Error
          ? error.message
          : "Your feedback could not be saved. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  const row = cn(
    "flex flex-wrap items-center gap-2.5",
    tone === "panel" ? "border-t border-border-row px-5 py-3 sm:px-6" : "py-1",
    className,
  );

  /* ------------------------------------------------------------ closed -- */

  if (!open) {
    return (
      <div className={row}>
        {saved ? (
          <>
            {/*
              RATED, AND SAYING SO QUIETLY. The brief's own suggestion — the
              passive action becomes "Rated ✓" — and it is what stops a person
              being asked twice about a conversation they already rated.
            */}
            <span className="inline-flex items-center gap-1.5 text-[11.5px] font-bold text-muted-foreground">
              <Check className="size-3.5 text-measure-positive-foreground" aria-hidden />
              Rated
            </span>
            <span className="inline-flex items-center gap-0.5" aria-hidden>
              {FEEDBACK_RATINGS.map((value) => (
                <Star
                  key={value}
                  className={cn(
                    "size-3.5",
                    value <= saved.rating
                      ? "fill-brand-yellow text-brand-yellow"
                      : "text-border-strong",
                  )}
                />
              ))}
            </span>
            {/*
              THE RATING IN WORDS, because the stars above are `aria-hidden` —
              they are a picture of a number, and "star star star" five times is
              noise rather than information.
            */}
            <span className="sr-only">
              You rated this conversation {saved.rating} out of 5 —{" "}
              {RATING_LABEL[saved.rating]}.
            </span>
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="text-[11px] font-bold text-muted-foreground underline underline-offset-2 transition-colors hover:text-foreground"
            >
              Edit your rating
            </button>
          </>
        ) : (
          /*
            THE WHOLE OF THE AUTOMATIC PROMPT, REDUCED TO THIS. Muted text and
            an outline star, so it does not compete with the answer above it or
            with the composer below it — and nothing whatsoever depends on it
            being pressed.
          */
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="inline-flex items-center gap-1.5 text-[11px] font-bold text-muted-foreground underline underline-offset-2 transition-colors hover:text-foreground"
          >
            <Star className="size-3.5" aria-hidden />
            Rate this conversation
          </button>
        )}
      </div>
    );
  }

  /* -------------------------------------------------------------- open -- */

  return (
    <div
      className={cn(
        "space-y-3.5 rounded-lg border border-border-row bg-surface-muted px-5 py-4 sm:px-6",
        tone === "panel" && "rounded-none border-x-0 border-b-0",
        className,
      )}
    >
      {/* ------------------------------------------------------- rating -- */}
      <fieldset>
        <legend className="text-[11.5px] font-bold text-foreground">
          How was your Ask Sunny experience?
        </legend>
        <div
          role="radiogroup"
          aria-label="How was your Ask Sunny experience?"
          className="mt-1.5 flex items-center gap-1"
        >
          {FEEDBACK_RATINGS.map((value) => {
            const active = draft.rating !== null && value <= draft.rating;
            return (
              <label
                key={value}
                title={`${value} — ${RATING_LABEL[value]}`}
                className="cursor-pointer rounded-md p-0.5 focus-within:ring-2 focus-within:ring-brand-yellow focus-within:outline-none"
              >
                {/*
                  A REAL RADIO, VISUALLY HIDDEN RATHER THAN `display: none`.
                  `sr-only` keeps it focusable and announced; `hidden` would
                  take it out of the tab order and the accessibility tree, which
                  is the bug this pattern is usually written with.
                */}
                <input
                  type="radio"
                  name={`rating-${turnId}`}
                  value={value}
                  checked={draft.rating === value}
                  disabled={busy}
                  onChange={() => setDraft((d) => ({ ...d, rating: value }))}
                  className="sr-only"
                />
                <Star
                  aria-hidden
                  className={cn(
                    "size-5 transition-colors",
                    active
                      ? "fill-brand-yellow text-brand-yellow"
                      : "text-border-strong",
                  )}
                />
                <span className="sr-only">
                  {value} — {RATING_LABEL[value]}
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {/* ------------------------------------------------------ outcome -- */}
      <fieldset>
        <legend className="text-[11.5px] font-bold text-foreground">
          Did you get what you needed?{" "}
          <span className="font-normal text-muted-foreground">(optional)</span>
        </legend>
        <div
          role="radiogroup"
          aria-label="Did you get what you needed? (optional)"
          className="mt-1.5 flex flex-wrap gap-2"
        >
          {FEEDBACK_OUTCOMES.map((outcome) => (
            <label
              key={outcome}
              className={cn(
                "cursor-pointer rounded-full border px-3.5 py-1.5 text-[11.5px] font-bold transition-colors focus-within:ring-2 focus-within:ring-brand-yellow",
                draft.gotWhatNeeded === outcome
                  ? "border-band bg-band text-band-foreground"
                  : "border-border-strong bg-surface text-foreground hover:border-brand-yellow",
              )}
            >
              <input
                type="radio"
                name={`outcome-${turnId}`}
                value={outcome}
                checked={draft.gotWhatNeeded === outcome}
                disabled={busy}
                onChange={() =>
                  setDraft((d) => ({ ...d, gotWhatNeeded: outcome }))
                }
                className="sr-only"
              />
              {OUTCOME_LABEL[outcome]}
            </label>
          ))}
        </div>
      </fieldset>

      {/* ------------------------------------------------------ comment -- */}
      <div>
        <label
          htmlFor={`comment-${turnId}`}
          className="text-[11.5px] font-bold text-foreground"
        >
          Anything Sunny should do better?{" "}
          <span className="font-normal text-muted-foreground">(optional)</span>
        </label>
        <textarea
          id={`comment-${turnId}`}
          rows={3}
          value={draft.comment}
          disabled={busy}
          maxLength={COMMENT_MAX_LENGTH}
          onChange={(event) =>
            setDraft((d) => ({ ...d, comment: event.target.value }))
          }
          className="scroll-slim mt-1.5 w-full resize-none rounded-lg border border-border-strong bg-surface px-3 py-2 text-[13px] leading-snug text-foreground placeholder:text-placeholder-foreground focus-visible:border-brand-yellow focus-visible:outline-none"
          placeholder="What worked, what was missing — the more specific, the more we can fix."
        />
      </div>

      {/* ------------------------------------------------------- actions -- */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy}
          className="pill-action bg-band text-band-foreground disabled:opacity-40"
        >
          {busy ? "Saving…" : saved ? "Update rating" : "Submit feedback"}
        </button>
        <button
          type="button"
          onClick={() => {
            setDraft(
              saved
                ? {
                    rating: saved.rating,
                    gotWhatNeeded: saved.gotWhatNeeded,
                    comment: saved.comment,
                  }
                : { rating: null, gotWhatNeeded: null, comment: "" },
            );
            setProblem(null);
            setOpen(false);
          }}
          disabled={busy}
          className="text-[11.5px] font-bold text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          Cancel
        </button>

        {/*
          `role="alert"` so a screen reader hears what is missing at the moment
          the person tries to save, rather than discovering it by tabbing back
          through the form. It is the reason the save button stays enabled.
        */}
        {problem ? (
          <p
            role="alert"
            className="text-[11.5px] font-bold text-measure-flagged-foreground"
          >
            {problem}
          </p>
        ) : null}
      </div>
    </div>
  );
}
