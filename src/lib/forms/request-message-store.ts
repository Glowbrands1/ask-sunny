import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";

import { installRequestMessage } from "./request-slot";

/**
 * FORM_NAME_FROM_ROSTER_ENABLED (step 5, part 2): the manager's message for
 * this turn, for `request-slot.ts`. Entered once by the chat route; read by
 * every name reader of the turn through `namesSomebody` and the person guard.
 */
const message = new AsyncLocalStorage<string>();

installRequestMessage(() => message.getStore());

/** From here to the end of this request, the turn's message is this. */
export function enterRequestMessage(text: string): void {
  message.enterWith(text);
}
