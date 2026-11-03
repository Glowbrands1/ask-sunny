import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";

import { installPersonRoster } from "./person-guard";

/**
 * The actor's roster names for this request, for `person-guard.ts`'s rule that
 * somebody on the roster is always a person. Set once per chat turn by the
 * route (PERSON_GUARD_ENABLED); read nowhere else.
 */
const personRoster = new AsyncLocalStorage<readonly string[]>();

installPersonRoster(() => personRoster.getStore());

/** From here to the end of this request, the guard reads these names as people. */
export function enterPersonRoster(names: readonly string[]): void {
  personRoster.enterWith(names);
}
