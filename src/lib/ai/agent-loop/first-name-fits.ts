import { firstNameMustFitEnabled } from "@/lib/config/chat-quality-flags";
import { AFFIRMATIVE, displayName, sameSurnameOtherFirstName, typedWithSurname, type RosterEmployee } from "@/lib/forms/employee-match";
import { NOT_A_NAME, NOT_A_TYPED_NAME } from "@/lib/forms/name-words";
import { extractEmployeeNames } from "@/lib/forms/proposal";

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

function managerTurns(context: ToolContext): string[] {
  return [...context.history.filter((turn) => turn.role === "user").map((turn) => String(turn.content ?? "")), context.question];
}

/** Words before a surname that are no first name ("write up fairweather", "for fairweather", "ms fairweather"). */
const NOT_A_FIRST = new Set(["up", "for", "to", "on", "of", "with", "about", "the", "a", "an", "ms", "mrs", "mr", "miss", "named", "called", "employee", "ca", "write", "her", "his", "is", "was"]);

/**
 * The names the manager typed with this person's surname, as typed in any case: the name readers' own, and the word
 * straight before the surname ("write up soren fairweather" — the classic reader reads no lowercase name after "write up").
 */
function typedWithThisSurname(turn: string, person: RosterEmployee): string[] {
  const surname = person.lastName.trim();
  if (surname === "") return [];
  const escaped = surname.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  const before = new RegExp(String.raw`(?<![\p{L}'’-])(\p{L}[\p{L}'’-]*)\s+${escaped}(?![\p{L}])`, "giu");
  const words = [...turn.matchAll(before)]
    .map((match) => match[1]!)
    .filter((word) => {
      const key = word.toLowerCase();
      return !NOT_A_FIRST.has(key) && !NOT_A_TYPED_NAME.has(key) && !NOT_A_NAME.has(key);
    })
    .map((word) => `${word} ${surname}`);
  return [...extractEmployeeNames(turn), ...words];
}

/** The chat's last reply named this person and the manager said yes to it. */
function saidYesTo(context: ToolContext, name: string): boolean {
  const last = [...context.history].reverse().find((turn) => turn.role === "assistant");
  return AFFIRMATIVE.test(context.question) && String(last?.content ?? "").includes(name);
}

/** The name the manager typed that is someone else with this person's last name, or null. Null with the flag off. */
export function otherPersonTyped(context: ToolContext, person: RosterEmployee): string | null {
  if (!firstNameMustFitEnabled()) return null;
  const name = displayName(person);
  if (saidYesTo(context, name)) return null;
  const typed = managerTurns(context).flatMap((turn) => typedWithThisSurname(turn, person));
  const surname = typed.filter((said) => typedWithSurname(said, person));
  const other = surname.filter((said) => sameSurnameOtherFirstName(said, person));
  // The manager also typed this person's own first name with the surname ("I meant marisol fairweather"): it is them.
  if (other.length === 0 || other.length < surname.length) return null;
  return other[other.length - 1]!;
}

/** What the chat asks instead, in the manager's words. */
export function otherPersonQuestion(typed: string, person: RosterEmployee): string {
  // A word typed in lower case is said back capitalised ("soren" → "Soren"); any other word as typed.
  const said = typed.trim().split(/\s+/).map((word) => (word === word.toLowerCase() ? word.charAt(0).toUpperCase() + word.slice(1) : word)).join(" ");
  return `${said} isn't on your staff list. Did you mean ${displayName(person)}, or someone else?`;
}
