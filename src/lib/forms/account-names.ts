import { AsyncLocalStorage } from "node:async_hooks";

/**
 * ============================================================================
 * EVERY NAME THE TURN'S ROSTER HOLDS — FOR THE ACCOUNT'S SPELLING (QA's #772 bar, 14 Nov 2026)
 * ============================================================================
 *
 * The sibling gate's probe on the #772 re-land (QA, ported here): "Manuel saw her …" became "manual saw her …". `cardAccountText` must never
 * edit a roster name (every person, not only the form's employee), nor a close typo of one. The roster is loaded
 * during the turn (`withinRosterLimit`, which production's `loadScopedRoster` and the replay pack's stand-in both go
 * through), after the account line's caller has started, so the names are collected into the turn's own set
 * (`withAccountNames`, opened by `deliverFormProposal`). Outside a turn there is no set: only the employee's own name is
 * protected, as before.
 */
const names = new AsyncLocalStorage<Set<string>>();

export function withAccountNames<T>(run: () => T): T {
  return names.run(new Set(), run);
}

/** Every word of each person's names, lowercased, into the turn's set. */
export function noteAccountNames(people: readonly { readonly firstName?: string | null; readonly lastName?: string | null; readonly preferredFirstName?: string | null }[]): void {
  const set = names.getStore();
  if (!set) return;
  for (const person of people) {
    for (const part of [person.firstName, person.lastName, person.preferredFirstName]) {
      for (const word of (part ?? "").toLowerCase().split(/[^a-z'’-]+/)) if (word.length >= 2) set.add(word);
    }
  }
}

/** The turn's roster name words (lowercased); empty outside a turn. */
export function accountNames(): ReadonlySet<string> {
  return names.getStore() ?? new Set();
}
