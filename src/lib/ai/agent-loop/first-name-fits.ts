import { firstNameMustFitEnabled } from "@/lib/config/chat-quality-flags";
import { displayName, sameSurnameOtherFirstName, typedWithSurname, type RosterEmployee } from "@/lib/forms/employee-match";

import type { ToolContext } from "./tools";

/**
 * ============================================================================
 * A SHARED LAST NAME IS NOT THE SAME PERSON (FIRST_NAME_MUST_FIT_ENABLED)
 * ============================================================================
 *
 * QA, 15 Nov 2026: a shared last name with a first name that fits nobody is never the same person. (The Ask Bubbles
 * report that raised it was a preferred first name, which already matches.) Invented example: the manager types "Soren
 * Fairweather"; find_staff finds nobody, but a search for the surname alone finds the roster's Marisol Fairweather, and
 * her id seated her. With the flag, a roster person is refused when the manager typed a full name with their last name
 * and a first name that is not theirs, and no name the manager typed with that surname fits them. A "yes" to this
 * chat's own question naming them is the manager choosing them.
 */

/** A yes, the offered person's own first name, or a pronoun for them: the manager took the offer. */
const TOOK = /^\s*(?:yes|yeah|yep|yup|ya|correct|right|sure|ok(?:ay)?|y)\b|^\s*(?:(?:yes|yeah|yep|yup)[\s,]+)?(?:that['’]?s\s+|it['’]?s\s+)?(?:her|him|them|she|he|that\s+one|the\s+one)\b/i;
const REFUSED = /^\s*(?:no|nope|nah|not)\b/i;

/** The turn after one of this chat's questions about this person took them ("yes", "marisol", "yeah that's her", "her"). */
function tookOffer(turn: string, person: RosterEmployee): boolean {
  if (REFUSED.test(turn)) return false;
  if (TOOK.test(turn)) return true;
  const firsts = [person.firstName, person.preferredFirstName ?? ""].map((name) => name.trim().toLowerCase()).filter(Boolean);
  const words = turn.toLowerCase().split(/[^\p{L}'’-]+/u).filter(Boolean);
  return firsts.some((first) => words.includes(first));
}

/**
 * The manager accepted this roster person once in this chat: the turn right after a question of the chat's that named
 * them ("Did you mean **<A>**?", "<typed> isn't on your staff list. Did you mean <A>, …") took them. From then on they
 * are accepted for the rest of the chat. Only that next turn is read, never every turn (QA's review of #1008).
 */
function accepted(context: ToolContext, person: RosterEmployee): boolean {
  const name = displayName(person);
  const turns = [...context.history.map((turn) => ({ role: turn.role, content: String(turn.content ?? "") })), { role: "user", content: context.question }];
  return turns.some((turn, index) => {
    if (turn.role !== "assistant" || !turn.content.includes(name) || !/Did you mean|isn['’]t on your staff list|Is this for/i.test(turn.content)) return false;
    const next = turns.slice(index + 1).find((later) => later.role === "user");
    return next ? tookOffer(next.content, person) : false;
  });
}

/**
 * The name the model passed this turn (a find_staff query, the card's employee_name) that is someone else with this
 * person's last name, or null. Only names with a first name are checked: a surname alone has no first name to check.
 * The manager's own message is never read for it (QA's review of #1008: "coach fairweather", "Dr Fairweather" are a
 * verb and a title, not first names). Null with the flag off, or once the manager accepted this person.
 */
export function otherPersonTyped(context: ToolContext, person: RosterEmployee, names: readonly string[]): string | null {
  if (!firstNameMustFitEnabled()) return null;
  const surname = names.filter((said) => typedWithSurname(said, person));
  const other = surname.filter((said) => sameSurnameOtherFirstName(said, person));
  // A name passed with this person's own first name ("marisol fairweather") is them.
  if (other.length === 0 || other.length < surname.length) return null;
  if (accepted(context, person)) return null;
  return other[other.length - 1]!;
}

/** What the chat asks instead, in the manager's words. */
export function otherPersonQuestion(typed: string, person: RosterEmployee): string {
  // A word typed in lower case is said back capitalised ("soren" → "Soren"); any other word as typed.
  const said = typed.trim().split(/\s+/).map((word) => (word === word.toLowerCase() ? word.charAt(0).toUpperCase() + word.slice(1) : word)).join(" ");
  return `${said} isn't on your staff list. Did you mean ${displayName(person)}, or someone else?`;
}
