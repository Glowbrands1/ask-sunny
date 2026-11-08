import { currentRequestStart } from "@/lib/ai/remap-incident";

import { JOIN } from "./bounded-context";
import { detectTemplateIntent } from "./template-intent";

/**
 * THE REQUEST NOW BEING WRITTEN (SECOND_REQUEST_OWN_ACCOUNT_ENABLED; QA's audit, 7 Nov 2026)
 *
 * With a Corrective Action for <A> already made in a chat, "I need another corrective action for <A>, his cash drawer
 * was short $20" was read over the whole chat: the card said "Late Opening, as you said", its Action Plan reviewed
 * Late Opening, and the created form's Policy Violated was Late Opening. A turn that asks for a form starts the request
 * now being written; the policy is read from that turn on. Follow-up turns ("no payroll deduct", "it was a verbal") ask
 * for no form and stay part of it. The callers decide when to use this (behind the flag).
 */

/** The turn asks for a form: a named form, or a Corrective Action it asks to have made. */
export function startsFormRequest(turn: string): boolean {
  const intent = detectTemplateIntent(turn);
  return intent.kind === "explicit" || (intent.kind === "corrective_action" && intent.requestedCreation === true);
}

/**
 * The manager turns of the request now being written: from the later request that starts its own (a request turn with
 * its own incident, `ai/remap-incident.ts` currentRequestStart — the same reading the Observation is cut by); all of
 * them otherwise. QA's Sunny round-3 gate, 7 Nov 2026: cutting at the last turn that names a form left ordinary
 * single-request cards with no Policy line — the account said before the request ("she was rude to a guest …" → "make
 * a CA for her"), a window's state lines ("The form is the Corrective Action Form."), or a closing "salon location is
 * kearney. create corrective action" after the account were read as a new request with nothing in it.
 */
export function currentFormRequestTurns(turns: readonly string[]): readonly string[] {
  const start = currentRequestStart({ turns, employeeName: null, slotClause: () => false });
  return start > 0 ? turns.slice(start) : turns;
}

/** This turn starts a request of its own after `earlier` turns (`form-state.ts` stateForTurn). */
export function startsNewRequest(earlier: readonly string[], turn: string): boolean {
  return earlier.length > 0 && currentFormRequestTurns([...earlier, turn]).length === 1;
}

/**
 * The incident a resent draft is looked up by (`ai/grounded-turn.ts` reopenSameIncident): every manager turn, or —
 * `ownRequest`, SECOND_REQUEST_OWN_ACCOUNT_ENABLED — only the request now being written.
 */
export function reopenIncidentText(said: readonly string[], ownRequest: boolean): string {
  return (ownRequest ? currentFormRequestTurns(said) : said).join("\n").trim().slice(0, 2000);
}

/** The same over a window's joined text (`bounded-context.ts` JOIN); a turn holding a blank line reads as several. */
export function currentFormRequestText(text: string): string {
  return currentFormRequestTurns(text.split(JOIN)).join(JOIN);
}
