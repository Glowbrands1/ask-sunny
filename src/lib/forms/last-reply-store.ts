import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";

import { installLastReply } from "@/lib/ai/form-state";

/**
 * SECOND_REQUEST_OWN_ACCOUNT_ENABLED (QA's live round 7b, 9 Nov 2026): the app's reply before this turn, for
 * `ai/form-state.ts` stateForTurn — the answer to the app's own question continues the same request. Entered once by
 * the chat route, only with the flag on; read nowhere else.
 */
const lastReply = new AsyncLocalStorage<string>();

installLastReply(() => lastReply.getStore());

/** From here to the end of this request, the app's reply before this turn is this. */
export function enterLastReply(text: string): void {
  lastReply.enterWith(text);
}
