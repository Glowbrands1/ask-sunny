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

/*
 * QA's re-review of #1008 (15 Nov 2026): acceptance is a WHITELIST. "yes", "yeah", "correct", "that's her/him", the
 * offered first name alone, or "yes, <offered first name>" — and nothing that says otherwise ("not", "no", "someone
 * else", "new", "but", another first name). "she's new", "Soren, not Marisol", "sure but it's soren", "right, it's
 * someone else", "ok so who else is on the list?" are not acceptance.
 */
const YES = String.raw`(?:yes|yeah|correct)`;
const THATS = String.raw`(?:that['’]?s|thats)\s+(?:her|him)`;
const DENIES = /\b(?:not|no|someone\s+else|new|but)\b/i;

/** The turn after one of this chat's questions about this person took them, by the whitelist above. */
function tookOffer(turn: string, person: RosterEmployee): boolean {
  const said = turn.trim().toLowerCase().replace(/[.!\s]+$/, "");
  if (DENIES.test(said)) return false;
  const firsts = [person.firstName, person.preferredFirstName ?? ""]
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean)
    .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const first = firsts.length > 0 ? `(?:${firsts.join("|")})` : "(?!)";
  return new RegExp(String.raw`^(?:${YES}|${THATS}|${YES}[\s,]+${THATS}|${first}|${YES}[\s,]+${first})$`, "i").test(said);
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

/*
 * QA's re-review of #1008, finding 1: the model can look up only the surname ("fairweather") and seat the roster person,
 * so the manager's own words in THIS request are read too: "<word> <surname>", where <word> is not on the stop list
 * below and does not fit the seated person's first or preferred name, is someone else. A stray question is cheap; a
 * wrong person is not.
 */
const NOT_A_FIRST_NAME = new Set([
  // articles and prepositions
  "a", "an", "the", "for", "about", "with", "to", "on", "at", "of", "from", "by", "in", "up", "into", "onto", "over", "re",
  // titles
  "mr", "ms", "mrs", "mx", "dr", "miss",
  // HR verbs
  "coach", "warn", "document", "terminate", "fire", "discipline", "write", "verbal", "written", "ca",
]);

/** The manager's turns of this request: this message, and the turns before it that answered the chat's own questions. */
function requestTurns(context: ToolContext): string[] {
  const turns = [context.question];
  const history = context.history.map((turn) => ({ role: turn.role, content: String(turn.content ?? "") }));
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const turn = history[index]!;
    if (turn.role === "assistant") {
      // A reply that asked something (a "?", "Did you mean …") is part of this request; any other reply ends it.
      if (!/\?|Did you mean|isn['’]t on your staff list/i.test(turn.content)) break;
      continue;
    }
    if (turn.role === "user") turns.unshift(turn.content);
  }
  return turns;
}

/** The "<word> <surname>" names the manager typed in this request, stop words left out. */
function typedWithThisSurname(context: ToolContext, person: RosterEmployee): string[] {
  const surname = person.lastName.trim();
  if (!surname) return [];
  const escaped = surname.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, String.raw`\s+`);
  const before = new RegExp(String.raw`(?<![\p{L}'’-])(\p{L}[\p{L}'’-]*)\.?\s+${escaped}(?![\p{L}])`, "giu");
  return requestTurns(context).flatMap((turn) =>
    [...turn.matchAll(before)].map((match) => match[1]!).filter((word) => !NOT_A_FIRST_NAME.has(word.toLowerCase())).map((word) => `${word} ${surname}`),
  );
}

/**
 * The name the model passed this turn (a find_staff query, the card's employee_name) that is someone else with this
 * person's last name, or null. Only names with a first name are checked: a surname alone has no first name to check.
 * The manager's own words in this request are read too, with the stop list above ("coach fairweather", "Dr Fairweather"
 * are a verb and a title, not first names). Null with the flag off, or once the manager accepted this person.
 */
export function otherPersonTyped(context: ToolContext, person: RosterEmployee, names: readonly string[]): string | null {
  if (!firstNameMustFitEnabled()) return null;
  // The model's names, and the manager's own "<word> <surname>" in this request (QA's re-review, finding 1).
  // Read in that order with the model's last: the name said back is the model's when it passed one.
  const surname = [...typedWithThisSurname(context, person), ...names].filter((said) => typedWithSurname(said, person));
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
