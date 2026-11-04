import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";

import type { RosterEmployee } from "./employee-match";
import { readEmployeeMentions } from "./proposal";
import { anchorsOnRoster, installRosterAnchor, lowercaseRosterFirstNameIn, rosterAnchored } from "./roster-shape";

/**
 * FORM_NAME_FROM_ROSTER_ENABLED: whether the message being read names
 * somebody on the roster, for this request only. Entered by the chat route
 * for the whole turn (`enterRosterAnchor`), and held by the grounding step
 * around the proposal it reads (`ai/grounded-turn.ts`); read by
 * `answer-not-a-name.ts` through `rosterAnchored`.
 */
const anchor = new AsyncLocalStorage<boolean>();

installRosterAnchor(() => anchor.getStore());

export function withRosterAnchor<T>(anchored: boolean, run: () => T): T {
  // Never takes back an anchor the route already found for this message.
  return anchor.run(anchored || rosterAnchored(), run);
}

/** From here to the end of this request, the message's anchor is this. */
export function enterRosterAnchor(anchored: boolean): void {
  anchor.enterWith(anchored);
}

/**
 * The message names somebody on the roster: a name candidate that is an
 * exact or close match, or a roster first or preferred name typed in
 * lowercase ("for perpetua", which the name reader does not take for a name).
 */
export function messageAnchoredOnRoster(text: string, roster: readonly RosterEmployee[]): boolean {
  if (roster.length === 0) return false;
  if (readEmployeeMentions(text).names.some((name) => anchorsOnRoster(name, roster))) return true;
  return lowercaseRosterFirstNameIn(text, roster);
}
