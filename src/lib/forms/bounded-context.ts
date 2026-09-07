/**
 * ============================================================================
 * THE BOUNDED MANAGER WINDOW — ONE IMPLEMENTATION, BOTH SIDES
 * ============================================================================
 *
 * The server bounds the conversation to decide what a PROPOSAL was read from.
 * The browser bounds it again to decide what a DRAFT is written from. Those two
 * answers have to be the same set of words, or the form says something the
 * proposal never showed anybody.
 *
 * THEY WERE NOT THE SAME. `managerContext` truncated an over-long current turn
 * and kept it; `draftNotesFromConversation` walked oldest-first and stopped at
 * the first overflow. So a manager who typed more than 4,000 characters got a
 * proposal built from their (truncated) account and then a form drafted from
 * NOTHING — the browser found the first message already over budget, produced
 * an empty string, and the flow fell through to "there wasn't enough in the
 * conversation to prefill it".
 *
 * Two implementations of one rule is how that happens. So there is one, here,
 * and it is pure: no `server-only`, no imports, no identity, nothing privileged.
 *
 * ============================================================================
 * THE RULE
 * ============================================================================
 *
 *   1. The CURRENT turn is retained first, always. It is what the manager is
 *      saying right now and can never be crowded out by older content.
 *   2. Prior turns are considered NEWEST -> OLDEST while budget remains.
 *   3. A prior turn that does not fit STOPS the walk — it is not skipped in
 *      favour of an older, shorter one, because that is the same recency
 *      inversion in miniature.
 *   4. The retained set is returned in CHRONOLOGICAL order: an account of what
 *      happened reads forwards, and reversing it misstates the sequence.
 *   5. An over-long current turn is cut deterministically and MARKED. A silent
 *      cut leaves a model drafting from a partial account with no way of
 *      knowing it is partial.
 */

/** How many manager turns the bounded window may hold, including the current one. */
export const MANAGER_CONTEXT_TURNS = 6;

/** Characters the bounded window may hold in total. */
export const MANAGER_CONTEXT_CHARS = 4_000;

/** Separator between retained turns. Counted against the budget, not ignored. */
export const JOIN = "\n\n";

/** Appended when the CURRENT turn alone is longer than the whole budget. */
export const TRUNCATION_MARKER =
  "\n[This message was longer than Ask Sunny reads at once and was cut here.]";

export interface BoundedTurn {
  /** Browser-local message id. Provenance only; absent is fine. */
  id?: string;
  content: string;
}

export interface BoundedContext {
  /** RETAINED turns only, chronological — oldest first, current last. */
  messages: BoundedTurn[];
  /** Ids of the retained turns that had one. */
  ids: string[];
  /** The retained turns, joined. */
  text: string;
  /** True when the current turn alone exceeded the budget and was cut. */
  truncated: boolean;
}

/**
 * @param prior   Manager turns before the current one, CHRONOLOGICAL. Already
 *                filtered to real manager speech by the caller — this function
 *                bounds, it does not decide who said what.
 * @param current The turn being answered.
 */
export function boundManagerTurns(
  prior: BoundedTurn[],
  current: BoundedTurn,
): BoundedContext {
  /* 1. The current turn, first claim on the budget. */
  let currentContent = current.content.trim();
  let truncated = false;
  if (currentContent.length > MANAGER_CONTEXT_CHARS) {
    truncated = true;
    currentContent =
      currentContent.slice(0, Math.max(0, MANAGER_CONTEXT_CHARS - TRUNCATION_MARKER.length)) +
      TRUNCATION_MARKER;
  }

  const retained: BoundedTurn[] = [{ id: current.id, content: currentContent }];
  let remaining = MANAGER_CONTEXT_CHARS - currentContent.length;

  /* 2-3. Prior turns, newest first, while they fit whole. */
  const candidates = prior.slice(-(MANAGER_CONTEXT_TURNS - 1));
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const turn = candidates[index]!;
    const content = turn.content.trim();
    if (content === "") continue;
    const cost = content.length + JOIN.length;
    if (cost > remaining) break;
    // `unshift` keeps `retained` chronological as it grows, so step 4 is
    // already done by the time the loop ends.
    retained.unshift({ id: turn.id, content });
    remaining -= cost;
  }

  return {
    messages: retained,
    ids: retained
      .map((turn) => turn.id)
      .filter((id): id is string => typeof id === "string" && id.length > 0),
    text: retained.map((turn) => turn.content).join(JOIN),
    truncated,
  };
}
