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

/** The manager turns from the last one that asks for a form; all of them when none does. */
export function currentFormRequestTurns(turns: readonly string[]): readonly string[] {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    if (startsFormRequest(turns[index] ?? "")) return turns.slice(index);
  }
  return turns;
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
