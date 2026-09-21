/**
 * A conversation could not be read or written.
 *
 * ITS OWN CLASS RATHER THAN A REUSED ONE, for the same reason `IngestionError`
 * and `EmbeddingError` are their own: the status and the sentence differ from
 * everything else, and a caller that has to pattern-match on a message string
 * to tell "you may not" from "we could not" will eventually get it wrong.
 *
 * 503, AND RETRYING IS GENUINELY WORTH IT. Nothing was lost when this is
 * raised: the conversation is still in the browser's own IndexedDB, which is
 * what the person is reading. The sync layer backs off and tries again, and the
 * thread on screen is untouched either way.
 *
 * IT IS NEVER RAISED FOR "NOT YOURS". That is an `AuthError("forbidden")` and
 * the two must stay distinguishable — telling somebody their own conversation
 * is unavailable when in fact they were refused, or the reverse, is how an
 * authorization bug hides behind an outage.
 */
export class ChatStoreError extends Error {
  readonly code = "chat_unavailable" as const;
  readonly status = 503;

  constructor(message: string) {
    super(message);
    this.name = "ChatStoreError";
  }
}

/**
 * What a caller is told when a conversation is not theirs, and when it does not
 * exist.
 *
 * DELIBERATELY THE SAME SENTENCE FOR BOTH, exactly as `assertOwnTurn` does for
 * a turn. "That conversation does not exist" and "that conversation is not
 * yours" are both true statements, and answering them differently turns the
 * endpoint into an oracle for which ids are real — which is the entire value of
 * guessing ids in the first place.
 */
export const CONVERSATION_REFUSED =
  "That conversation is not available. You can only open conversations from your own Ask Sunny history.";
