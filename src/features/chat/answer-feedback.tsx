"use client";

import { useState } from "react";
import { Check, Pencil, Star } from "lucide-react";

import { submitFeedback } from "@/lib/feedback/client";
import {
  COMMENT_MAX_LENGTH,
  FEEDBACK_OUTCOMES,
  FEEDBACK_RATINGS,
  OUTCOME_LABEL,
  RATING_LABEL,
  feedbackDraftProblem,
  type FeedbackDraft,
  type FeedbackOutcome,
  type FeedbackRating,
  type SavedFeedback,
} from "@/lib/feedback/types";
import { cn } from "@/lib/utils/cn";

/**
 * =============================================================================
 * THE FEEDBACK PANEL — ONE COMPONENT, EVERY ASK SUNNY SURFACE
 * =============================================================================
 *
 * Nine places can answer a question: the chat tab, the Overview band, the five
 * report tabs' ask bars, the Google Reviews bar, and the Sales Totals panel.
 * This renders under all of them, and it is ONE component rather than nine
 * because the alternative was tried elsewhere in this codebase and is recorded
 * as a mistake — `useInlineAsk` exists precisely because two copies of a send
 * path became two audit trails that drifted apart silently.
 *
 * The same argument applies harder here. A feedback control that differs by
 * surface produces ratings that are not comparable, and the dashboard's whole
 * premise is that a 2 from the Spa Engagement bar means the same thing as a 2
 * from the chat tab.
 *
 * =============================================================================
 * IT RATES ONE ANSWER, NOT THE CONVERSATION
 * =============================================================================
 *
 * `turnId` is the server's name for the turn — the `activity_events` row it was
 * recorded as — and it is the whole reason this is useful for debugging rather
 * than just for morale. A 1-star lands on a specific answer, on a specific
 * surface, about a specific topic. "That conversation was bad" points at
 * nothing anybody can open.
 *
 * NO PANEL WITHOUT A `turnId`. An answer whose activity insert did not land has
 * nothing to attach a rating to, so the panel does not render — rather than
 * rendering a form that would fail on save with nothing the person could do
 * about it. Analytics is best-effort by design and must never fail an answer;
 * this is what that decision costs, stated where it is paid.
 *
 * =============================================================================
 * ALL THREE FIELDS ARE REQUIRED — AND THE COST IS NAMED
 * =============================================================================
 *
 * Rating, outcome and comment, per the brief. The comment is the one that
 * earns the friction: a distribution of stars tells you morale, and a queue of
 * sentences tells you what to fix. A 1-star with no words is a dead end.
 *
 * WHAT MAKES IT TOLERABLE RATHER THAN PUNITIVE, and each of these is a
 * deliberate choice rather than a default:
 *
 *   - The save button is never disabled. A disabled button with no explanation
 *     is the single most common accessibility failure in a form like this:
 *     screen-reader users get no announcement, and nobody learns what is
 *     missing by clicking a button that does nothing. It stays enabled and
 *     SAYS what is missing, in `role="alert"`, naming the fields.
 *   - The panel opens collapsed to a single line. A four-control form under
 *     every answer would dominate a thread of six.
 *   - Once saved it collapses back to the rating and an Edit link.
 *
 * =============================================================================
 * THE STAR CONTROL IS A RADIO GROUP, NOT FIVE BUTTONS
 * =============================================================================
 *
 * Five buttons is what this usually is, and it is wrong for the same reason a
 * disabled save is: it tells assistive technology nothing about the fact that
 * these five things are one choice with one answer. A `radiogroup` does, which
 * means a screen reader announces "3 of 5" and arrow keys move between them —
 * behaviour a keyboard user already expects and gets for free from the native
 * elements rather than from a `keydown` handler we would have to maintain.
 *
 * The visual star is a label; the input underneath it is a real radio. Each
 * carries a WORD as well as a number ("Somewhat helpful"), because "3 stars"
 * says what you are selecting and not what it means.
 */
export function AnswerFeedback({
  turnId,
  conversationId,
  messageId,
  saved,
  onSaved,
  className,
}: {
  /** The server's name for this turn. No id, no panel — see the header. */
  turnId: string | undefined;
  /** Browser-local, stored opaquely so a complaint can be traced to a thread. */
  conversationId?: string;
  messageId?: string;
  /** What this person already said, if they have said anything. */
  saved?: SavedFeedback;
  /**
   * Told the host that feedback now exists for this turn.
   *
   * The host persists it on the message, which is what releases the gate on the
   * next question and what makes the answer still show its rating after a
   * refresh. This component deliberately keeps no opinion about where feedback
   * is stored — the chat screen, the Overview band and the report bars all hold
   * their threads differently.
   */
  onSaved: (feedback: SavedFeedback) => void;
  className?: string;
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
        gotWhatNeeded: draft.gotWhatNeeded as FeedbackOutcome,
        comment: draft.comment,
        conversationId,
        messageId,
      });
      onSaved(feedback);
      setOpen(false);
    } catch (error) {
      /*
       * THE FAILURE IS SHOWN IN THE SAME PLACE THE VALIDATION IS, and the panel
       * stays open with the person's words intact. Losing a typed complaint to
       * a failed request would be a particularly bad way to handle feedback
       * about things going wrong.
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

  /* --------------------------------------------------- saved, collapsed -- */

  if (saved && !open) {
    return (
      <div
        className={cn(
          "flex flex-wrap items-center gap-2.5 border-t border-border-row px-5 py-3 sm:px-6",
          className,
        )}
      >
        <span className="inline-flex items-center gap-1.5 text-[11.5px] font-bold text-foreground">
          <Check className="size-3.5 text-measure-positive-foreground" aria-hidden />
          Thanks — your feedback helps improve Sunny.
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
          THE RATING IS ALSO STATED IN WORDS, because the stars above are
          `aria-hidden` — they are a picture of a number, and a screen reader
          reading "star star star" five times is noise rather than information.
        */}
        <span className="sr-only">
          You rated this {saved.rating} out of 5 — {RATING_LABEL[saved.rating]}.
          Got what you needed: {OUTCOME_LABEL[saved.gotWhatNeeded]}.
        </span>
        <span className="text-[11px] text-muted-foreground">
          {OUTCOME_LABEL[saved.gotWhatNeeded]}
        </span>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="ml-auto inline-flex items-center gap-1 text-[11px] font-bold text-muted-foreground underline underline-offset-2 transition-colors hover:text-foreground"
        >
          <Pencil className="size-3" aria-hidden />
          Edit your feedback
        </button>
      </div>
    );
  }

  /* ------------------------------------------------- unsaved, collapsed -- */

  if (!open) {
    return (
      <div
        className={cn(
          "flex flex-wrap items-center gap-3 border-t border-border-row px-5 py-3 sm:px-6",
          className,
        )}
      >
        <p className="text-[11.5px] font-bold text-foreground">
          How helpful was this answer?
        </p>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="pill-action border border-border-strong bg-surface text-foreground"
        >
          Give feedback
        </button>
        <p className="text-[11px] text-muted-foreground">
          Required before your next question
        </p>
      </div>
    );
  }

  /* -------------------------------------------------------------- open -- */

  return (
    <div
      className={cn(
        "space-y-3.5 border-t border-border-row bg-surface-muted px-5 py-4 sm:px-6",
        className,
      )}
    >
      {/* ------------------------------------------------------- rating -- */}
      <fieldset>
        <legend className="text-[11.5px] font-bold text-foreground">
          How helpful was this answer?
        </legend>
        <div
          role="radiogroup"
          aria-label="How helpful was this answer?"
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
          Did you get what you needed?
        </legend>
        <div
          role="radiogroup"
          aria-label="Did you get what you needed?"
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
          What worked, what was missing, or what should Sunny improve?
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
          placeholder="Tell us what happened — the more specific, the more we can fix."
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
          {busy ? "Saving…" : saved ? "Update feedback" : "Save feedback"}
        </button>
        {saved ? (
          <button
            type="button"
            onClick={() => {
              setDraft({
                rating: saved.rating,
                gotWhatNeeded: saved.gotWhatNeeded,
                comment: saved.comment,
              });
              setProblem(null);
              setOpen(false);
            }}
            disabled={busy}
            className="text-[11.5px] font-bold text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            Cancel
          </button>
        ) : null}

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
