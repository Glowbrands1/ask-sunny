import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/server";
import { AuthError } from "@/lib/auth/types";
import type {
  FeedbackOutcome,
  FeedbackRating,
  FeedbackStatus,
  SavedFeedback,
} from "./types";

/**
 * WRITING AND MODERATING FEEDBACK.
 *
 * ============================================================================
 * THE ONE CHECK EVERYTHING HERE RESTS ON
 * ============================================================================
 *
 * A person may leave feedback about an answer THEY asked for, and about no
 * other. That is enforced in `assertOwnTurn` by reading the turn's own
 * `actor_user_id` and comparing it to the session's subject — not by trusting a
 * field in the request, and not by a row-level policy.
 *
 * IT CANNOT BE A ROW-LEVEL POLICY, and the reason is worth stating so nobody
 * "completes" the migration later by adding one. Every read and write in this
 * application runs server-side under the secret key, which holds `service_role`
 * and bypasses RLS by design — that is the posture the whole schema is built
 * on. A policy here would be decoration: it would bind nobody, while looking
 * exactly like the thing doing the work. The check is in code because code is
 * where the caller's identity actually is.
 *
 * WHAT A FORGED `turnId` BUYS: nothing. It names a row the caller did not
 * author, `assertOwnTurn` finds a different `actor_user_id`, and the write is
 * refused with 403 before anything is inserted. An id for a turn that does not
 * exist is refused the same way rather than being reported as missing, so the
 * endpoint cannot be used to probe which ids are real.
 */

/** A row that does not exist and a row belonging to somebody else read alike. */
const REFUSED =
  "That answer is not yours to rate. Feedback can only be left on answers from your own conversations.";

async function assertOwnTurn(turnId: string, userId: string): Promise<void> {
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from("activity_events")
    .select("actor_user_id")
    .eq("id", turnId)
    .maybeSingle();

  /*
   * A DATABASE FAILURE IS NOT A REFUSAL. Treating an unreachable Supabase as
   * "not yours" would tell a person their own answer belongs to somebody else,
   * which is both wrong and alarming. It is its own error and it is a 503.
   */
  if (error) {
    throw new AuthError(
      "no_provider",
      "Your feedback could not be saved just now. Please try again.",
    );
  }

  /*
   * NO ROW AND SOMEBODY ELSE'S ROW GET THE SAME ANSWER, deliberately. Returning
   * "that turn does not exist" for one and "that turn is not yours" for the
   * other turns this endpoint into an oracle for which event ids are real.
   *
   * A NULL ACTOR IS ALSO REFUSED. Machine-driven events — an emailed workbook —
   * have no person behind them and belong to nobody, so nobody may rate them.
   * `null === userId` is false, which is the behaviour we want, but it is
   * spelled out here because the correct result arriving by accident is how it
   * gets broken later.
   */
  const actor = (data?.actor_user_id as string | null | undefined) ?? null;
  if (!data || actor === null || actor !== userId) {
    throw new AuthError("forbidden", REFUSED);
  }
}

export interface SaveFeedbackInput {
  turnId: string;
  userId: string;
  rating: FeedbackRating;
  /** Optional: null when the person rated and said nothing else. */
  gotWhatNeeded: FeedbackOutcome | null;
  /** Optional: empty when the person rated and said nothing else. */
  comment: string;
  clientConversationId?: string | null;
  clientMessageId?: string | null;
}

/**
 * Save a person's feedback about one answer, replacing their previous feedback
 * about that same answer if they had any.
 *
 * AN UPSERT, NOT AN INSERT, and the unique constraint is what makes it one. A
 * person has ONE opinion about one answer at a time; changing their mind is an
 * edit. Without that, a double-click is two rows and the average moves twice
 * for a single opinion — and "19 responses" stops meaning nineteen people.
 *
 * `onConflict` names the constraint's own columns rather than its name, so the
 * behaviour survives the constraint being renamed.
 */
export async function saveFeedback(
  input: SaveFeedbackInput,
): Promise<SavedFeedback> {
  await assertOwnTurn(input.turnId, input.userId);

  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from("ask_sunny_feedback")
    .upsert(
      {
        activity_event_id: input.turnId,
        user_id: input.userId,
        rating: input.rating,
        /*
         * AN UNANSWERED OPTIONAL FIELD IS NULL, NOT A GUESS.
         *
         * Both columns were `not null`; the migration that makes rating
         * voluntary relaxes them, because the alternative was worse in the one
         * way that matters here — storing 'yes' or an empty string for somebody
         * who said neither would put invented opinions into the same average
         * the dashboard reports as what leaders said. Absent reads as absent:
         * the outcome counts exclude it, and the comment queue has nothing to
         * show. See `20260917001000_feedback_optional_words.sql`.
         */
        got_what_needed: input.gotWhatNeeded,
        comment: input.comment.trim().length > 0 ? input.comment.trim() : null,
        client_conversation_id: input.clientConversationId ?? null,
        client_message_id: input.clientMessageId ?? null,
      },
      { onConflict: "activity_event_id,user_id" },
    )
    .select("id, activity_event_id, rating, got_what_needed, comment, updated_at")
    .single();

  if (error || !data) {
    throw new Error(`Feedback could not be saved: ${error?.message ?? "no row returned"}`);
  }

  /*
   * THE MODERATION STATE IS DELIBERATELY NOT TOUCHED BY AN EDIT.
   *
   * The upsert above lists only the person's own fields, so a comment revised
   * after an administrator marked it `in_review` stays `in_review` — the
   * administrator is still working on it, and resetting their queue because
   * somebody fixed a typo would make the queue useless. `updated_at` moves on
   * its own through the trigger, which is what tells them the text changed.
   */
  return toSavedFeedback(data as Record<string, unknown>);
}

/**
 * A person's own feedback for a set of turns, so a reopened thread shows what
 * they already said rather than an empty form.
 *
 * SCOPED TO THE CALLER BY THE QUERY ITSELF (`user_id = ...`), not by filtering
 * afterwards. Nobody reads anybody else's feedback through this path, including
 * an administrator — moderation is its own function with its own gate.
 */
export async function ownFeedbackForTurns(
  userId: string,
  turnIds: string[],
): Promise<SavedFeedback[]> {
  if (turnIds.length === 0) return [];

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("ask_sunny_feedback")
    .select("id, activity_event_id, rating, got_what_needed, comment, updated_at")
    .eq("user_id", userId)
    .in("activity_event_id", turnIds);

  if (error) {
    throw new Error(`Feedback could not be read: ${error.message}`);
  }

  return (data ?? []).map((row) => toSavedFeedback(row as Record<string, unknown>));
}

function toSavedFeedback(row: Record<string, unknown>): SavedFeedback {
  return {
    id: String(row.id),
    turnId: String(row.activity_event_id),
    rating: Number(row.rating) as FeedbackRating,
    gotWhatNeeded: (row.got_what_needed as FeedbackOutcome | null) ?? null,
    comment: row.comment === null || row.comment === undefined ? "" : String(row.comment),
    updatedAt: String(row.updated_at),
  };
}

/* ------------------------------------------------------------ moderation -- */

export interface ModerationInput {
  feedbackId: string;
  adminUserId: string;
  status?: FeedbackStatus;
  resolutionNote?: string | null;
  /** True hides, false restores. Undefined leaves the hidden state alone. */
  hidden?: boolean;
}

/**
 * An administrator's action on one feedback item.
 *
 * WHO ACTED AND WHEN IS WRITTEN BY THIS FUNCTION, NEVER BY THE CALLER. The
 * route passes the session's own subject; there is no field in the request body
 * that can name a different administrator, which is what keeps "resolved by"
 * worth reading.
 *
 * THE HANDS ARE STAMPED ON THE TRANSITION THAT EARNED THEM. Moving to
 * `resolved` or `dismissed` records who closed it and when; reopening to
 * `pending` or `in_review` CLEARS both, because a stale "resolved by Paulyne,
 * 3 September" sitting on an open item is a lie about who is holding it. The
 * note survives reopening — it is the working history, not the closing act.
 *
 * HIDING IS SEPARATE FROM STATUS, and both may arrive in one call. They answer
 * different questions: status is "has anybody dealt with this", hidden is "may
 * this text appear on the dashboard". An abusive comment about a real bug is
 * hidden AND pending, and collapsing the two would force somebody to choose
 * between showing the abuse and losing the bug.
 */
export async function moderateFeedback(input: ModerationInput): Promise<void> {
  const supabase = getSupabaseAdmin();

  const patch: Record<string, unknown> = {};

  if (input.status !== undefined) {
    patch.status = input.status;
    const closing = input.status === "resolved" || input.status === "dismissed";
    patch.resolved_by = closing ? input.adminUserId : null;
    patch.resolved_at = closing ? new Date().toISOString() : null;
  }

  if (input.resolutionNote !== undefined) {
    /* An empty note is a cleared note, not an empty string in the column. */
    const note = input.resolutionNote?.trim() ?? "";
    patch.resolution_note = note.length > 0 ? note : null;
  }

  if (input.hidden !== undefined) {
    patch.hidden_at = input.hidden ? new Date().toISOString() : null;
    patch.hidden_by = input.hidden ? input.adminUserId : null;
  }

  /*
   * NOTHING TO CHANGE IS NOT AN UPDATE. An empty patch would otherwise fire the
   * touch trigger and move `updated_at`, making an item look edited because
   * somebody opened it.
   */
  if (Object.keys(patch).length === 0) return;

  const { error } = await supabase
    .from("ask_sunny_feedback")
    .update(patch)
    .eq("id", input.feedbackId);

  if (error) {
    throw new Error(`Feedback could not be updated: ${error.message}`);
  }
}

/**
 * Permanently remove one piece of feedback.
 *
 * ============================================================================
 * THIS IS NOT MODERATION, AND THE DISTINCTION IS THE WHOLE POINT
 * ============================================================================
 *
 * `moderateFeedback`'s hide exists so an administrator can take an abusive or
 * mistakenly-pasted comment off the dashboard WITHOUT being able to make it as
 * though nobody complained. That property is what makes "we had no complaints
 * about that release" a sentence somebody can check, and it is unchanged.
 *
 * This is the other thing: a QA rating that was never real feedback in the
 * first place. A test five-star left while verifying the feature is not a
 * complaint being buried — it is noise that would otherwise move a production
 * average forever, and no amount of hiding removes it from the record of what
 * leaders actually said.
 *
 * So the two verbs stay separate, and the UI makes this one harder to reach.
 *
 * ============================================================================
 * IT DOES NOT TOUCH THE TURN
 * ============================================================================
 *
 * `ask_sunny_feedback.activity_event_id` cascades FROM the event TO the
 * feedback, never the other way, so deleting a rating cannot remove the record
 * that a question was asked. That is the correct direction: the question really
 * was asked and really was answered, and the usage figures should keep saying
 * so. What is being removed is an opinion about it.
 *
 * The `delete` below names the feedback table and nothing else, and a test
 * asserts the event survives.
 */
export async function deleteFeedback(feedbackId: string): Promise<void> {
  const supabase = getSupabaseAdmin();

  const { error } = await supabase
    .from("ask_sunny_feedback")
    .delete()
    .eq("id", feedbackId);

  if (error) {
    throw new Error(`Feedback could not be deleted: ${error.message}`);
  }
}
