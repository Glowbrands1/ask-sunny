import { firstNameSuggestEnabled } from "@/lib/config/chat-quality-flags";
import { displayName, type RosterEmployee } from "@/lib/forms/employee-match";

import type { ChatActor } from "./form-proposal";
import type { AskRequest, AskResponse } from "./types";
import type { ChatMessage } from "@/types";

/**
 * ============================================================================
 * A FIRST NAME ALONE: THE MANAGER IS ASKED WHO, FROM THEIR OWN ROSTER
 * ============================================================================
 *
 * FIRST_NAME_SUGGEST_ENABLED (QA and Pau, 28 Oct 2026; same flag in both
 * apps). "quinn was late on 10/20, write her up" and "I have an employee quinn
 * who …" lost the quinn ("Who is this … for?"), and "create a ca for quinn …"
 * went ahead with a card for the bare first name. With the flag on, a reply
 * that asks who the form is for, or a card whose employee is one word, is
 * replaced by a question about the people on the manager's own roster (the
 * scoped roster — additional salons included, nobody outside it) whose first
 * name that is:
 *
 *   two or more   "Did you mean **Quinn Marlowe** or **Quinn Ashby**? Tell me
 *                 which, or give the full name."
 *   one           "Is this for **Quinn Marlowe**? Tell me if that should change."
 *   none          the reply as it was
 *
 * Only the question: no card until the manager answers, and never accepted
 * for them. Asked once — the next turn is read as the answer
 * (`withFirstNameAnswer`), and a reply after that is left as it is. Not when
 * the turn is a question, a confirm question is already showing, the
 * manager's turns name somebody in full, or the name is the manager's own.
 */

const ONE = /^Is this for \*\*([^*]+)\*\*\? Tell me if that should change\./;
const MANY = /^Did you mean (.+?)\? Tell me which, or give the full name\./;

/** Words that are names on some rosters and ordinary words in a manager's sentence. */
const ORDINARY = new Set([
  "will", "may", "can", "mark", "bill", "grant", "june", "april", "august", "art", "rich", "hope", "joy", "faith",
  "dawn", "summer", "chase", "pat", "ray", "rose", "jean", "sue", "miles", "max", "page", "drew", "lane", "price",
  "young", "king", "long", "major", "frank", "earl", "sunny", "star", "storm", "honey", "amber", "ruby", "jade",
  "sky", "autumn", "winter", "reed", "rob", "don", "guy", "jack", "nick", "sterling", "carol", "penny", "victory",
]);

const ASKS_WHO =
  /\bWho is this (?:\*\*[^*]+\*\* |form )?for\?|\bIs this for [^?]+\? Tell me (?:her|his|their) full name\.|\bI still need [^.]+ full name\b/;

function words(text: string): string[] {
  return text.toLowerCase().match(/[a-z][a-z'’-]*/g) ?? [];
}

const firstNamesOf = (person: RosterEmployee): string[] =>
  [person.firstName, person.preferredFirstName ?? ""].map((name) => name.trim().toLowerCase()).filter(Boolean);

function managerTurns(request: AskRequest): string[] {
  const earlier = (request.history ?? []).filter((turn) => turn.role === "user").map((turn) => turn.content);
  return [...earlier.slice(-3), request.question];
}

/** The one first name the manager's turns give, on this roster, or null. */
function statedFirstName(turns: readonly string[], roster: readonly RosterEmployee[], own: string | null): string | null {
  const known = new Set(roster.flatMap(firstNamesOf));
  const said = new Set(turns.flatMap(words).filter((word) => known.has(word) && !ORDINARY.has(word) && word !== own));
  return said.size === 1 ? [...said][0]! : null;
}

function namesSomebodyInFull(turns: readonly string[], roster: readonly RosterEmployee[]): boolean {
  const text = ` ${turns.join(" ").toLowerCase().replace(/[^a-z' ]+/g, " ")} `;
  return roster.some((person) =>
    firstNamesOf(person).some((first) => text.includes(` ${first} ${person.lastName.trim().toLowerCase()} `)),
  );
}

function bold(names: readonly string[]): string {
  const marked = names.map((name) => `**${name}**`);
  return marked.length <= 2 ? marked.join(" or ") : `${marked.slice(0, -1).join(", ")} or ${marked.at(-1)}`;
}

function lastAssistant(request: AskRequest): string {
  return [...(request.history ?? [])].reverse().find((turn) => turn.role === "assistant")?.content ?? "";
}

/** Every word the manager has typed in this conversation. */
function everythingSaid(request: AskRequest): Set<string> {
  const said = [...(request.history ?? []).filter((turn) => turn.role === "user").map((turn) => turn.content), request.question];
  return new Set(said.flatMap(words));
}

/**
 * QA, 28 Oct 2026 (live): "katherine was late on 10/20, write her up" with
 * one Katherine on the roster gave a card for her full name at once — a
 * reader found the one roster person the first name fits and filled the
 * card, so the manager was never asked. A card whose employee is a roster
 * person whose last name the manager has never typed, and whose first (or
 * preferred) name they did type, was filled from that first name alone: it
 * is asked about like a one-word card. The first name, or null.
 */
function filledFromFirstName(name: string | null | undefined, request: AskRequest, roster: readonly RosterEmployee[]): string | null {
  if (!name || !/\s/.test(name.trim())) return null;
  const person = roster.find((entry) => displayName(entry).toLowerCase() === name.trim().toLowerCase());
  if (!person) return null;
  if (alreadyConfirmed(displayName(person), request)) return null;
  const said = everythingSaid(request);
  if (words(person.lastName).some((word) => said.has(word))) return null;
  return firstNamesOf(person).find((first) => said.has(first) && !ORDINARY.has(first)) ?? null;
}

/*
 * QA review, 28 Oct 2026: after "yes" the card held the name, but every later
 * turn ("make it a written warning", "create it") still showed a last name the
 * manager never typed, and the question replaced the card again. The person
 * is confirmed for the whole conversation once any earlier reply named them
 * in bold (this question, or a numbered "Did you mean"), any earlier card was
 * for them, or a form is already open.
 */
function alreadyConfirmed(fullName: string, request: AskRequest): boolean {
  if (request.activeFormInstanceId) return true;
  const target = fullName.trim().toLowerCase();
  return (request.history ?? []).some(
    (turn) =>
      turn.role === "assistant" &&
      (turn.content.toLowerCase().includes(`**${target}**`) || turn.formProposal?.employeeName?.trim().toLowerCase() === target),
  );
}

/** Cheap first look, before the roster is read: a card name whose last word the manager never typed. */
function cardNameNotTypedInFull(name: string | null | undefined, request: AskRequest): boolean {
  const parts = words(name ?? "");
  return parts.length > 1 && !everythingSaid(request).has(parts.at(-1)!);
}

export function withFirstNameSuggest(
  response: AskResponse,
  request: AskRequest,
  roster: readonly RosterEmployee[],
): AskResponse {
  if (!firstNameSuggestEnabled() || roster.length === 0) return response;
  if (request.question.trim().endsWith("?") || response.content.includes("Did you mean")) return response;
  const asked = lastAssistant(request);
  if (ONE.test(asked) || MANY.test(asked)) return response;
  const card = response.formProposal;
  const oneWordCard = Boolean(card?.employeeName && !/\s/.test(card.employeeName.trim()));
  // The card's full name was filled from a first name the manager typed alone ("katherine was late …").
  const filledFirst = oneWordCard ? null : filledFromFirstName(card?.employeeName, request, roster);
  if (!oneWordCard && !filledFirst && !(ASKS_WHO.test(response.content) && !card?.employeeName)) return response;

  const turns = managerTurns(request);
  if (!filledFirst && namesSomebodyInFull(turns, roster)) return response;
  const own = words(request.context?.userName ?? "")[0] ?? null;
  const first = oneWordCard ? card!.employeeName!.trim().toLowerCase() : (filledFirst ?? statedFirstName(turns, roster, own));
  if (!first || first === own) return response;
  const people = roster.filter((person) => firstNamesOf(person).includes(first));
  if (people.length === 0) return response;
  const names = [...new Set(people.map(displayName))];
  const content =
    names.length === 1
      ? `Is this for **${names[0]}**? Tell me if that should change.`
      : `Did you mean ${bold(names)}? Tell me which, or give the full name.`;
  // Only the question: the card waits for the answer.
  return { ...response, content, formProposal: undefined };
}

const YES =
  /^\s*(?:yes|yeah|yep|yup|yea|correct|right|sure|ok(?:ay)?|that'?s (?:right|correct|her|him|them|it|the one)|it is|yes it is)\b[\s,.!]*/i;
const ORDINALS: readonly RegExp[] = [/\b(?:first|1st|one)\b|^\s*1\b/i, /\b(?:second|2nd|two)\b|^\s*2\b/i, /\b(?:third|3rd|three)\b|^\s*3\b/i];

/**
 * The manager's answer to that question, read as the name: "yes" is the one
 * person asked about; "the second" or "ashby" is the one option it names;
 * "no, Quinn Ashby" or a full name is that name. The turn is then the
 * manager's own request again with the name in full ("create a ca for Quinn
 * Marlowe. she was late …"), since no card holds it. Anything else is read as
 * it is.
 */
export function withFirstNameAnswer(request: AskRequest, aliases: Aliases = () => []): AskRequest {
  if (!firstNameSuggestEnabled()) return request;
  return answeredNow(withEarlierAnswers(request, aliases), aliases);
}

/** The first and preferred names of the roster person with this full name. */
type Aliases = (fullName: string) => readonly string[];

/**
 * QA / Pau, 29 Oct 2026: "pls create a coaching form for kit dov" (Kit is
 * Katrin Dovetail's preferred name) → "Is this for **Katrin Dovetail**?" →
 * "yes" lost the request: the turn that gave the name was found by "Katrin",
 * which the manager never typed. When the conversation has asked this
 * question, the roster is read so the preferred name finds that turn too.
 */
export async function withFirstNameAnswerFor(request: AskRequest, actor: ChatActor): Promise<AskRequest> {
  if (!firstNameSuggestEnabled()) return request;
  const asked = (request.history ?? []).some((turn) => turn.role === "assistant" && (ONE.test(turn.content) || MANY.test(turn.content)));
  if (!asked) return withFirstNameAnswer(request);
  const { loadScopedRoster } = await import("@/lib/forms/employee-roster");
  const roster = await loadScopedRoster(actor.scope);
  return withFirstNameAnswer(request, (fullName) =>
    roster.filter((person) => displayName(person).toLowerCase() === fullName.trim().toLowerCase()).flatMap(firstNamesOf),
  );
}

/** The first name the question was asked about, or the chosen person's own first or preferred name. */
function firstNamePattern(options: readonly string[], chosen: string, aliases: Aliases): RegExp {
  const names = [...new Set([words(options[0]!)[0]!, ...aliases(chosen)])].map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`\\b(?:${names.join("|")})\\b`, "i");
}

/**
 * QA review, 28 Oct 2026: the answer only rewrote ITS turn, so the turns
 * after it ("make it a written warning", "create it") read the raw history
 * again — the first name alone, "yes" — lost the person, and the question was
 * asked again in place of the card. Every question of this kind earlier in
 * the conversation that the manager answered puts the chosen name, in full,
 * into the manager's turn that gave the first name, as the answer itself did.
 */
function withEarlierAnswers(request: AskRequest, aliases: Aliases): AskRequest {
  const history = request.history ?? [];
  let next: ChatMessage[] | null = null;
  for (const { index, reply, options, chosen } of answeredQuestions(history)) {
    const first = firstNamePattern(options, chosen.name, aliases);
    const turns: ChatMessage[] = next ?? [...history];
    for (let at = index - 1; at >= 0; at -= 1) {
      const said = turns[at]!;
      if (said.role !== "user" || !first.test(said.content)) continue;
      if (said.content.toLowerCase().includes(chosen.name.toLowerCase())) break;
      turns[at] = { ...said, content: said.content.replace(first, chosen.name) };
      break;
    }
    // The answer itself ("ashby", "the second", "yes") is that name, so no later reading takes "ashby" for one.
    turns[index + 1] = { ...reply, content: `${chosen.name}${chosen.rest}` };
    next = turns;
  }
  return next ? { ...request, history: next } : request;
}

/** Every question of this kind in the conversation that the manager's next turn answered, with the name chosen. */
function answeredQuestions<T extends { readonly role: string; readonly content: string }>(conversation: readonly T[]) {
  const answered: { index: number; reply: T; options: string[]; chosen: { name: string; rest: string } }[] = [];
  conversation.forEach((turn, index) => {
    const reply = conversation[index + 1];
    if (turn.role !== "assistant" || reply?.role !== "user") return;
    const one = ONE.exec(turn.content);
    const many = one ? null : MANY.exec(turn.content);
    if (!one && !many) return;
    const options = one ? [one[1]!] : [...many![1]!.matchAll(/\*\*([^*]+)\*\*/g)].map((match) => match[1]!.trim());
    const chosen = chosenName(reply.content.trim(), options, Boolean(one));
    if (chosen) answered.push({ index, reply, options, chosen });
  });
  return answered;
}

/**
 * The names the manager accepted from this question in the conversation —
 * "yes" to "Is this for **Katrin Dovetail**?", "ashby" or "the second" from
 * "Did you mean …", or a full name typed in answer. Pau, live, 29 Oct 2026
 * (her wording, the name invented): "pls create a coaching form for katrin
 * dov" → "yes" → Create refused the card as "out of date: the conversation
 * now says the form is for katrin dov", because the creation check (`proposal-currency.ts`) counted only the
 * older close-match questions as accepted. Off: none.
 */
export function firstNameSuggestAccepted(
  conversation: readonly { readonly role: string; readonly content: string }[],
): { name: string; answeredAt: number }[] {
  if (!firstNameSuggestEnabled()) return [];
  return answeredQuestions(conversation).map(({ index, chosen }) => ({ name: chosen.name, answeredAt: index + 1 }));
}

function answeredNow(request: AskRequest, aliases: Aliases): AskRequest {
  const asked = lastAssistant(request);
  const reply = request.question.trim();
  const one = ONE.exec(asked);
  const many = one ? null : MANY.exec(asked);
  if (!one && !many) return request;
  const options = one ? [one[1]!] : [...many![1]!.matchAll(/\*\*([^*]+)\*\*/g)].map((match) => match[1]!.trim());
  const chosen = chosenName(reply, options, Boolean(one));
  if (!chosen) return request;
  const first = firstNamePattern(options, chosen.name, aliases);
  const said = [...(request.history ?? [])].reverse().find((turn) => turn.role === "user" && first.test(turn.content));
  return {
    ...request,
    question: said ? said.content.replace(first, chosen.name) + chosen.rest : chosen.name + chosen.rest,
  };
}

function chosenName(reply: string, options: readonly string[], single: boolean): { name: string; rest: string } | null {
  const text = reply.toLowerCase();
  const full = options.find((name) => text.includes(name.toLowerCase()));
  if (full) return { name: full, rest: "" };
  if (single) {
    const yes = YES.exec(reply);
    if (yes && !/\b(?:no|not|nope|wrong)\b/i.test(reply)) {
      const rest = reply.slice(yes[0].length).trim();
      return { name: options[0]!, rest: rest ? ` ${rest}` : "" };
    }
  } else {
    const byOrdinal = ORDINALS.findIndex((pattern) => pattern.test(reply));
    if (byOrdinal >= 0 && options[byOrdinal]) return { name: options[byOrdinal]!, rest: "" };
    const named = options.filter((name) => {
      const shared = new Set(options.flatMap((other) => (other === name ? [] : words(other))));
      return words(name).some((word) => !shared.has(word) && words(reply).includes(word));
    });
    if (named.length === 1) return { name: named[0]!, rest: "" };
  }
  // "no, Quinn Ashby", "it's Quinn Ashby": another full name, as typed.
  const other = /^(?:no|nope|not\s+\w+)?[\s,.!-]*(?:it'?s|it\s+is|this\s+is\s+for|for)?\s*([A-Za-z][A-Za-z'’-]+\s+[A-Za-z][A-Za-z'’-]+)\s*[.!]?$/i.exec(reply);
  if (other && !/^(?:yes|yeah|yep)\b/i.test(other[1]!)) return { name: other[1]!, rest: "" };
  return null;
}

/**
 * The step in the answer chain: the roster is read only for a reply this could
 * replace. Off, the response as it was and nothing is read.
 */
export async function withFirstNameSuggestFor(
  response: AskResponse,
  request: AskRequest,
  actor: ChatActor,
): Promise<AskResponse> {
  if (!firstNameSuggestEnabled()) return response;
  const card = response.formProposal;
  const oneWordCard = Boolean(card?.employeeName && !/\s/.test(card.employeeName.trim()));
  const maybeFilled = cardNameNotTypedInFull(card?.employeeName, request);
  if (!oneWordCard && !maybeFilled && !(ASKS_WHO.test(response.content) && !card?.employeeName)) return response;
  const { loadScopedRoster } = await import("@/lib/forms/employee-roster");
  return withFirstNameSuggest(response, request, await loadScopedRoster(actor.scope));
}
