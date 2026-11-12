/** The parts of a turn `sameTurn` compares. */
interface TurnText {
  readonly question: string;
  readonly history: readonly { readonly role: string; readonly content: string }[];
}

/**
 * CHAT_PARALLEL_LOADS_ENABLED / CHAT_PARALLEL_REWRITE_ENABLED (QA, 9 Nov 2026): a promise started early and awaited
 * later. Its rejection is not reported as unhandled meanwhile, and it still reaches that await, where today's code
 * would have thrown it.
 */
export function held<T>(promise: Promise<T>): Promise<T> {
  promise.catch(() => undefined);
  return promise;
}

/** CHAT_PARALLEL_REWRITE_ENABLED: the same question and the same turns before it, so a read started early read this turn. */
export function sameTurn(a: TurnText, b: TurnText): boolean {
  return (
    a.question === b.question &&
    a.history.length === b.history.length &&
    a.history.every((turn, index) => turn.role === b.history[index]!.role && turn.content === b.history[index]!.content)
  );
}

/**
 * CHAT_PARALLEL_REWRITE_ENABLED: a read started early from the turn as it was. `take` gives that read when the turn is
 * still the same (`sameTurn`), and otherwise runs it again from the turn as it is now, exactly as it would have run
 * there with the flag off. `reruns` says which, for the trace.
 */
export function startedFor<T, U extends TurnText>(asked: U, read: (turn: U) => Promise<T>) {
  const early = held(read(asked));
  return {
    reruns: (turn: U): boolean => !sameTurn(asked, turn),
    take: (turn: U): Promise<T> => (sameTurn(asked, turn) ? early : read(turn)),
  };
}
