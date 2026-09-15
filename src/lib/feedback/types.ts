/**
 * ASK SUNNY FEEDBACK — the shared vocabulary.
 *
 * Client-safe: unions, labels and pure functions. No database client, no
 * secret, no server-only import. The browser validates a draft with the same
 * code the route validates it with, so the two can never disagree about what
 * "complete" means — a form that enables its own save button by one rule and is
 * refused by another is the worst version of this feature.
 *
 * THE GRAIN IS ONE ANSWER. Every type here is about a single assistant turn,
 * named by the server-minted `turnId` that came back with it. A rating that
 * described a whole conversation would be unactionable: a thread spans a dozen
 * turns and two surfaces, and "that was a 2" points at none of them.
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

/** What a person fills in about one answer. */
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

/** Feedback as it comes back, so the panel can show what was already said. */
export interface SavedFeedback {
  id: string;
  turnId: string;
  rating: FeedbackRating;
  gotWhatNeeded: FeedbackOutcome;
  comment: string;
  updatedAt: string;
}

/**
 * Whether a draft may be submitted, and what is missing if not.
 *
 * ALL THREE FIELDS ARE REQUIRED, which is what the brief asked for and is worth
 * being deliberate about: a required comment is the difference between a
 * distribution of stars nobody can act on and a queue of specific, fixable
 * complaints. The cost is real — some people will type "n/a" — and it is still
 * the better trade, because a 1-star with no words is a dead end.
 *
 * THE MESSAGE NAMES WHAT IS MISSING rather than saying "please complete the
 * form". A person who has filled in two of three fields should not have to work
 * out which one the button is waiting on.
 */
export function feedbackDraftProblem(draft: FeedbackDraft): string | null {
  const missing: string[] = [];
  if (!isFeedbackRating(draft.rating)) missing.push("a star rating");
  if (!isFeedbackOutcome(draft.gotWhatNeeded)) {
    missing.push("whether you got what you needed");
  }
  if (draft.comment.trim().length === 0) missing.push("a comment");

  if (missing.length === 0) {
    /*
     * The length check comes after the presence checks so a long comment is
     * reported as too long rather than as missing — they are different problems
     * and only one of them is the person's mistake.
     */
    if (draft.comment.length > COMMENT_MAX_LENGTH) {
      return `Your comment is ${draft.comment.length} characters. Please shorten it to ${COMMENT_MAX_LENGTH} or fewer.`;
    }
    return null;
  }

  if (missing.length === 1) return `Please add ${missing[0]}.`;
  const last = missing[missing.length - 1];
  return `Please add ${missing.slice(0, -1).join(", ")} and ${last}.`;
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
