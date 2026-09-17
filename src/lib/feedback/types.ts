/**
 * ASK SUNNY FEEDBACK — the shared vocabulary.
 *
 * Client-safe: unions, labels and pure functions. No database client, no
 * secret, no server-only import. The browser validates a draft with the same
 * code the route validates it with, so the two can never disagree about what
 * "complete" means — a form that enables its own save button by one rule and is
 * refused by another is the worst version of this feature.
 *
 * THE STORED GRAIN IS ONE ANSWER. Every type here is about a single assistant
 * turn, named by the server-minted `turnId` that came back with it — which is
 * what lets a rating be joined to a role, a salon, a surface and a topic.
 *
 * WHAT A PERSON RATES IS THE CONVERSATION. The control is one passive "Rate
 * this conversation" action, and it attaches what they said to a turn inside
 * that thread rather than inventing a second, coarser record beside the one
 * every analytics read already joins through. See
 * `lib/feedback/conversation.ts`.
 *
 * ONLY THE STARS ARE REQUIRED. The outcome and the comment were both mandatory,
 * on the reasoning that a 1-star with no words is a dead end — which is true,
 * and was the wrong trade once the rating stopped being something people were
 * made to do. A required field on a voluntary form is not a richer record; it
 * is the reason somebody abandons the form and the record is nothing at all.
 */

export const FEEDBACK_RATINGS = [1, 2, 3, 4, 5] as const;

export type FeedbackRating = (typeof FEEDBACK_RATINGS)[number];

export function isFeedbackRating(value: unknown): value is FeedbackRating {
  return (FEEDBACK_RATINGS as readonly unknown[]).includes(value);
}

/**
 * "Did you get what you needed?"
 *
 * THREE ANSWERS, AND THE MIDDLE ONE IS THE POINT. An answer that was correct
 * but incomplete is both the most common real failure and the most fixable, and
 * a yes/no control forces it into whichever neighbour the person feels
 * charitable about that morning. Half of those readings are wrong, and nothing
 * downstream can recover which half.
 */
export const FEEDBACK_OUTCOMES = ["yes", "partially", "no"] as const;

export type FeedbackOutcome = (typeof FEEDBACK_OUTCOMES)[number];

export const OUTCOME_LABEL: Record<FeedbackOutcome, string> = {
  yes: "Yes",
  partially: "Partially",
  no: "No",
};

export function isFeedbackOutcome(value: unknown): value is FeedbackOutcome {
  return (FEEDBACK_OUTCOMES as readonly unknown[]).includes(value);
}

/**
 * The moderation workflow. Mirrors `public.feedback_status`.
 *
 * `dismissed` is not `resolved`. Resolved says somebody fixed the thing;
 * dismissed says somebody decided there was nothing to fix. Collapsing them
 * would make "how much of what leaders reported did we act on" unanswerable,
 * which is the one number this queue exists to produce.
 */
export const FEEDBACK_STATUSES = [
  "pending",
  "in_review",
  "resolved",
  "dismissed",
] as const;

export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

export const STATUS_LABEL: Record<FeedbackStatus, string> = {
  pending: "Pending",
  in_review: "In review",
  resolved: "Resolved",
  dismissed: "Dismissed",
};

export function isFeedbackStatus(value: unknown): value is FeedbackStatus {
  return (FEEDBACK_STATUSES as readonly unknown[]).includes(value);
}

/** Matches the column constraint exactly, so the two cannot drift apart. */
export const COMMENT_MAX_LENGTH = 2000;
export const RESOLUTION_NOTE_MAX_LENGTH = 2000;

/** What a person fills in about a conversation. Only `rating` is required. */
export interface FeedbackDraft {
  rating: FeedbackRating | null;
  gotWhatNeeded: FeedbackOutcome | null;
  comment: string;
}

export const EMPTY_DRAFT: FeedbackDraft = {
  rating: null,
  gotWhatNeeded: null,
  comment: "",
};

/**
 * Feedback as it comes back, so the control can show what was already said.
 *
 * `gotWhatNeeded` is null and `comment` is empty when the person rated and said
 * nothing else, which is now an ordinary submission rather than a rejected one.
 */
export interface SavedFeedback {
  id: string;
  turnId: string;
  rating: FeedbackRating;
  gotWhatNeeded: FeedbackOutcome | null;
  comment: string;
  updatedAt: string;
}

/**
 * Whether a draft may be submitted, and what is missing if not.
 *
 * THE STARS ARE THE ONLY REQUIREMENT. A rating with no words is still a real
 * signal — it moves the average for a surface, a role and a salon — and the
 * alternative is what this replaces: a voluntary control that refuses to accept
 * the thing somebody actually wanted to say.
 *
 * The comment is still BOUNDED, because a paste of an entire report is a
 * different problem from a short sentence, and the column says 2000 either way.
 *
 * THE MESSAGE NAMES WHAT IS MISSING rather than saying "please complete the
 * form", and the save button stays enabled so a screen reader hears it.
 */
export function feedbackDraftProblem(draft: FeedbackDraft): string | null {
  if (!isFeedbackRating(draft.rating)) return "Please choose a star rating.";

  if (draft.comment.length > COMMENT_MAX_LENGTH) {
    return `Your comment is ${draft.comment.length} characters. Please shorten it to ${COMMENT_MAX_LENGTH} or fewer.`;
  }

  return null;
}

export function isFeedbackDraftComplete(draft: FeedbackDraft): boolean {
  return feedbackDraftProblem(draft) === null;
}

/**
 * The star label, read aloud by a screen reader and shown on hover.
 *
 * WORDS, NOT JUST A NUMBER. "3 stars" tells somebody using a screen reader what
 * they are selecting but not what it means, and these five points are the whole
 * scale the dashboard averages — so the wording is fixed here, once, rather
 * than invented separately by each surface that draws the control.
 */
export const RATING_LABEL: Record<FeedbackRating, string> = {
  1: "Not helpful",
  2: "Slightly helpful",
  3: "Somewhat helpful",
  4: "Helpful",
  5: "Very helpful",
};
