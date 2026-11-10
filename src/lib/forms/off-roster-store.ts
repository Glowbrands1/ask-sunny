import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";

import { installAcceptedOffRoster } from "./off-roster-confirm";

/**
 * OFF_ROSTER_CONFIRM_ENABLED: the off-roster name the manager took this turn ("use <name>"), for
 * `roster-only-names.ts`. Entered once by the chat route.
 */
const accepted = new AsyncLocalStorage<string>();

installAcceptedOffRoster(() => accepted.getStore());

/** From here to the end of this request, the manager has taken this name as typed. */
export function enterAcceptedOffRoster(name: string): void {
  accepted.enterWith(name);
}
