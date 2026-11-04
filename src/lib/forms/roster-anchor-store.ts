import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";

import { installRosterAnchor } from "./roster-shape";

/**
 * FORM_NAME_FROM_ROSTER_ENABLED: whether the message being read names
 * somebody on the roster, for this request only. Set by the grounding step
 * around the proposal it reads (`ai/grounded-turn.ts`); read by
 * `answer-not-a-name.ts` through `rosterAnchored`.
 */
const anchor = new AsyncLocalStorage<boolean>();

installRosterAnchor(() => anchor.getStore());

export function withRosterAnchor<T>(anchored: boolean, run: () => T): T {
  return anchor.run(anchored, run);
}
