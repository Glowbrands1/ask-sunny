"use client";

import { isDemoMode } from "@/lib/config/runtime";
import type {
  FeedbackOutcome,
  FeedbackRating,
  SavedFeedback,
} from "./types";

/**
 * SAVING FEEDBACK FROM THE BROWSER.
 *
 * ============================================================================
 * ONE SEAM, SO EVERY SURFACE SAVES THE SAME WAY
 * ============================================================================
 *
 * Nine places can draw the feedback panel. If each posted for itself, the day
 * the endpoint grows a field would be the day eight of them quietly stopped
 * sending it — and the failure would show up as a gap in a dashboard nobody
 * looks at until a quarter later. The panel calls this; this is the only thing
 * that knows the URL.
 *
 * ============================================================================
 * DEMO MODE SAVES NOTHING, AND STILL WORKS
 * ============================================================================
 *
 * The preview surface runs on `MockAIProvider`: no `/api/chat` call, no
 * server-recorded turn, and therefore no `activity_events` row for feedback to
 * attach to. Posting anyway would be refused by `assertLiveMode` — and worse,
 * it would leave a manager demonstrating the product stuck behind a save that
 * can never succeed, because the next question is gated on it.
 *
 * So demo mode resolves locally. The panel behaves exactly as it does live: the
 * rules apply, the confirmation appears, editing works, the gate releases. What
 * does not happen is a write, which is the standing rule in both directions —
 * live mode never shows a demo record, and demo mode never puts invented
 * activity into production analytics. A seeded 5-star rating from a
 * presentation would be indistinguishable from a real one the moment it landed.
 */

export interface SubmitFeedbackInput {
  turnId: string;
  rating: FeedbackRating;
  gotWhatNeeded: FeedbackOutcome;
  comment: string;
  /** Browser-local, for tracing a complaint back to the thread. */
  conversationId?: string;
  messageId?: string;
}

export async function submitFeedback(
  input: SubmitFeedbackInput,
): Promise<SavedFeedback> {
  if (isDemoMode()) return localOnly(input);

  /*
   * TRIMMED HERE AS WELL AS SERVER-SIDE, and the duplication is deliberate.
   * The route trims because it must never trust a body; this trims so the
   * comment that goes over the wire is the comment that gets stored, and a
   * reader comparing a request in a network tab against a row in the database
   * sees the same string. Neither bound relies on the other.
   */
  const body = { ...input, comment: input.comment.trim() };

  let response: Response;
  try {
    response = await fetch("/api/chat/feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error(
      "Your feedback could not be sent. Check your connection and try again.",
    );
  }

  const payload = (await response.json().catch(() => ({}))) as {
    feedback?: SavedFeedback;
    error?: string;
  };

  if (!response.ok || !payload.feedback) {
    /*
     * THE SERVER'S OWN MESSAGE IS PREFERRED, because it is the one that knows
     * what went wrong — "a comment is required", or "that answer is not yours
     * to rate". A generic fallback covers the case where the response carried
     * no body at all.
     */
    throw new Error(
      payload.error ?? "Your feedback could not be saved. Please try again.",
    );
  }

  return payload.feedback;
}

/**
 * What the browser already said about these turns, so a reopened thread shows
 * it rather than an empty form.
 *
 * NEVER THROWS. This is a convenience read: its failure means a manager sees a
 * blank form for feedback they already gave, which is mildly annoying, and its
 * failure must not stop a conversation rendering. The panel treats an empty
 * result and a failed one identically because there is nothing useful to do
 * differently.
 */
export async function loadOwnFeedback(
  turnIds: string[],
): Promise<SavedFeedback[]> {
  if (isDemoMode() || turnIds.length === 0) return [];

  try {
    const params = new URLSearchParams();
    for (const id of turnIds) params.append("turn", id);
    const response = await fetch(`/api/chat/feedback?${params.toString()}`);
    if (!response.ok) return [];
    const payload = (await response.json()) as { feedback?: SavedFeedback[] };
    return payload.feedback ?? [];
  } catch {
    return [];
  }
}

/**
 * A demo-mode save. Shaped exactly like a real one so nothing downstream has to
 * know which it got — including an id, because the panel keys its confirmation
 * off one.
 */
function localOnly(input: SubmitFeedbackInput): SavedFeedback {
  return {
    /*
     * PREFIXED SO IT IS OBVIOUS IN A CONSOLE OR A REACT DEVTOOLS TREE. Nothing
     * reads this value, and it never reaches a database — the prefix is for the
     * person debugging, who should not have to wonder whether a preview session
     * wrote to production.
     */
    id: `demo-feedback-${input.turnId}`,
    turnId: input.turnId,
    rating: input.rating,
    gotWhatNeeded: input.gotWhatNeeded,
    comment: input.comment.trim(),
    updatedAt: new Date().toISOString(),
  };
}
