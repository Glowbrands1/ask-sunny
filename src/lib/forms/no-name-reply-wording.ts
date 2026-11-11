import { noNameReplyWordingEnabled } from "@/lib/config/chat-quality-flags";

/**
 * ============================================================================
 * A REPLY WITH NO NAME ON THE CARD READS CLEANLY (NO_NAME_REPLY_WORDING_ENABLED)
 * ============================================================================
 *
 * Sunny round 22 live test (QA, 11 Nov 2026): "create a CA for ima employee" rightly made no card, but the reply said
 * "… Corrective Action Form for the the employee." and "… policy with the the employee.", and "You can create it now"
 * over a card with no Create button. The name "ima employee" was taken off the reply as "the employee", and its word
 * "employee" was then taken off again inside the words just put in (`roster-only-names.ts`, withoutUnseatedName). With
 * the flag on, what was put in is held aside until every word of the name is done, and a card with no employee says the
 * draft can be created once the name is given. Off, as before.
 */

const HELD = "\u0001";

/** What the name is replaced with: held aside with the flag on, so the name's own words never match inside it. */
export function standInForName(): string {
  return noNameReplyWordingEnabled() ? HELD : "the employee";
}

/** The held stand-ins, as the reply says them. */
export function withStandInsSaid(line: string): string {
  return line.includes(HELD) ? line.split(HELD).join("the employee") : line;
}

const CREATE_NOW = /\bYou can create it now and fill it in yourself\b/g;

/** With no employee on the card there is no Create button: the note says it can be created once the name is given. */
export function withoutCreateNowWhenNoEmployee(content: string, employeeName: string | null | undefined): string {
  if (!noNameReplyWordingEnabled() || employeeName?.trim()) return content;
  return content.replace(CREATE_NOW, "Once you tell me who it's for, you can create it and fill it in yourself");
}
