import { offRosterConfirmEnabled } from "@/lib/config/chat-quality-flags";
import type { AskRequest } from "@/lib/ai/types";

import { normalizeTypedName } from "./employee-match";

/**
 * ============================================================================
 * A PERSON WHO IS NOT IN WOVEN (OFF_ROSTER_CONFIRM_ENABLED; QA, the flip-3
 * gate, 6 Nov 2026)
 * ============================================================================
 *
 * With FORM_NAME_FROM_ROSTER_ENABLED a card's employee comes from the roster
 * only (`roster-only-names.ts`), so a form for somebody just removed from
 * Woven, or not added yet, asked "Who is this form for?" on every answer and
 * never made a card — and a card with no employee has no Create button.
 *
 * With this flag the not-found note offers the name as typed ("reply **use
 * <name>**"). The manager's next turn takes it when it is "use <that name>",
 * "yes" / "use that name", or that same name typed again; a different name
 * ("use <another>") is not taken and is read, and looked up, as any name is.
 * The card then carries the typed name and says it is not from Woven, in the
 * reply and in the card's note. The offer is never made for a near miss of a
 * roster person: that is asked as them. The app's own offer words only; no
 * phrase list of the manager's.
 */

/** The offer, after "I couldn't find **<name>** in the Woven roster …". */
export function offRosterOffer(name: string): string {
  return `If **${name}** isn't in Woven (for example, just removed or not added yet), reply **use ${name}** and I'll put that name on the form as you typed it.`;
}

/** The line the reply starts with once the name is taken. */
export function offRosterTakenLine(name: string): string {
  return `**${name}** isn't in the Woven roster, so the form uses the name as you typed it.`;
}

/** The card's note under the employee (`wovenCloseMatch`, shown under the card). */
export function offRosterCardNote(name: string): string {
  return `Not in Woven — ${name} is the name as you typed it.`;
}

const OFFER = /reply \*\*use ([^*]+)\*\* and I'll put that name on the form/;

/** The name the assistant turn offered, or null. */
export function offeredOffRosterName(content: string | undefined): string | null {
  return content ? (OFFER.exec(content)?.[1]?.trim() ?? null) : null;
}

const same = (a: string, b: string) => normalizeTypedName(a) === normalizeTypedName(b);

/** The offered name the manager's turn takes, or null (no offer, a "no", or another name). */
export function acceptedOffRosterName(question: string, offered: string | null): string | null {
  if (!offered) return null;
  const said = question.trim().replace(/[.!]+$/, "").trim();
  if (/\b(?:no|not|nope|wrong)\b/i.test(said)) return null;
  const use = /^(?:(?:yes|yeah|yep|ok(?:ay)?)[\s,]+)?(?:please\s+)?use\s+(.+)$/i.exec(said);
  if (use) {
    const what = use[1]!.trim();
    // "use that name", "use it": the offered one. Another name is not taken.
    return /^(?:that(?:\s+name)?|it|this(?:\s+name)?|the\s+name)$/i.test(what) || same(what, offered) ? offered : null;
  }
  if (/^(?:yes|yeah|yep|correct|ok(?:ay)?)\b/i.test(said)) return offered;
  return same(said, offered) ? offered : null;
}

/* ------------------------------------------------ the accepted name -- */

let readAccepted: () => string | undefined = () => undefined;

/** The server installs the turn's store (`off-roster-store.ts`); a test or the browser reads none. */
export function installAcceptedOffRoster(read: () => string | undefined): void {
  readAccepted = read;
}

/** The off-roster name the manager took this turn, or undefined. */
export function acceptedOffRoster(): string | undefined {
  return offRosterConfirmEnabled() ? readAccepted() : undefined;
}

/** The accepted name is this card's employee. */
export function isAcceptedOffRoster(employee: string): boolean {
  const accepted = acceptedOffRoster();
  return Boolean(accepted && same(accepted, employee));
}

/**
 * The turn that answers the offer, read as the manager's turn that typed the name (the request, the exit
 * lines), so the card is drafted from what they said. Null when the turn takes no offer, or the flag is off.
 */
export function withOffRosterAnswer(request: AskRequest): { request: AskRequest; accepted: string } | null {
  if (!offRosterConfirmEnabled()) return null;
  const history = request.history ?? [];
  const lastAssistant = [...history].reverse().find((turn) => turn.role === "assistant");
  const accepted = acceptedOffRosterName(request.question, offeredOffRosterName(lastAssistant?.content));
  if (!accepted) return null;
  const typed = [...history]
    .reverse()
    .find((turn) => turn.role === "user" && turn.content.toLowerCase().includes(accepted.toLowerCase()) && !same(turn.content, accepted));
  return { request: { ...request, question: typed?.content ?? accepted }, accepted };
}
