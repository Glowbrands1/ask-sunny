import "server-only";

import { oneFormEachPersonEnabled, twoFormsEachPersonEnabled, twoFormsOwnPersonEnabled } from "@/lib/config/chat-quality-flags";
import { AFFIRMATIVE } from "@/lib/forms/employee-match";
import { readFormRequests, type FormRequest } from "@/lib/forms/form-requests";
import { TEMPLATE_SEEDS } from "@/lib/forms/library";
import { personRosterNames } from "@/lib/forms/person-guard";
import { detectTemplateIntent } from "@/lib/forms/template-intent";

import type { AskRequest, AskResponse } from "./types";

/**
 * ============================================================================
 * TWO FORMS FOR TWO PEOPLE: THE CARD IS ITS OWN CLAUSE'S PERSON, NEVER THE
 * OTHER FORM'S (TWO_FORMS_OWN_PERSON_ENABLED, default off; QA, Sunny tester
 * after the flip, 6 Nov 2026, row 6)
 * ============================================================================
 *
 * "Coaching form for <R>. Also a CA for <R2>." gave ONE Coaching card whose
 * employee was R2: the models' reading of the Corrective Action's person won
 * over the coaching request's own "for <R>", and the Corrective Action was
 * lost without a word. This app makes one card per message (the sibling app
 * makes one per request; a full port is its own item).
 *
 * A post-step on the finished answer, like `withTitleOfTheEmployee`. When the
 * message is two or more form requests (`forms/form-requests.ts`, the sibling
 * app's reader): the card keeps its employee only when its own clause names
 * them; otherwise the employee, and the salon read from them, are cleared and
 * the card asks who. Either way the reply names every other request back.
 * Off, the answer is returned untouched.
 */

const NAME_OF = new Map(TEMPLATE_SEEDS.map((seed) => [seed.key, seed.name]));

function words(text: string): string[] {
  return text.toLowerCase().split(/[^\p{L}'’-]+/u).filter((word) => word.length > 1);
}

/** Whether the clause names this person: any of their name's words, as typed (first names, lower case). */
function namesIn(clause: string, name: string): boolean {
  const said = new Set(words(clause));
  return words(name).some((word) => said.has(word));
}

function formName(key: string): string {
  return NAME_OF.get(key) ?? (key === "dpoa" ? "Corrective Action Form" : "form");
}

export function withTwoFormsOwnPerson(response: AskResponse, request: Pick<AskRequest, "question">): AskResponse {
  if (!twoFormsOwnPersonEnabled()) return response;
  const reading = readFormRequests(request.question);
  if (!reading || reading.requests.length < 2) return response;
  const card = response.formProposal;
  if (!card) return withoutOtherFormsPersonAsked(response, reading.requests);
  const ownAt = reading.requests.findIndex((entry) => entry.templateKey === card.templateKey);
  if (ownAt < 0) return response;
  const own = reading.requests[ownAt]!;
  const others = reading.requests.filter((_, index) => index !== ownAt);

  const employee = card.employeeName?.trim() || null;
  // Its own: named in its own clause, or the reader's person for it ("a coaching form and a CA for <name>": one person for both).
  const keeps = employee !== null && (namesIn(own.clause, employee) || (own.employeeName !== null && namesIn(own.employeeName, employee)));
  const removed = employee !== null && !keeps ? employee : null;

  const alsoAsked = others.map((other: FormRequest) => {
    const who = other.employeeName ?? (removed && namesIn(other.clause, removed) ? removed : null);
    return who
      ? `You also asked for a **${formName(other.templateKey)}** for **${who}** — ask for it on its own and I'll set it up.`
      : `You also asked for a **${formName(other.templateKey)}** — ask for it on its own, with who it's for, and I'll set it up.`;
  });

  if (keeps) return { ...response, content: [response.content.trim(), ...alsoAsked].join("\n\n") };

  const name = card.templateName || formName(card.templateKey);
  const scopeProvesSalon = (card.authorizedLocationIds ?? []).length <= 1 && card.locationResolution === "resolved";
  const emptied = {
    ...card,
    employeeName: null,
    employeeRole: null,
    wovenCloseMatch: null,
    status: "needs_employee" as const,
    ...(scopeProvesSalon ? {} : { locationId: null, locationName: null, locationResolution: "needs_selection" as const }),
  };
  const content = [`Here is what I would put on a **${name}**.`, `Who is this **${name}** for? Tell me the employee's full name.`, ...alsoAsked].join("\n\n");
  return { ...response, content, formProposal: emptied };
}

/*
 * NO CARD, BUT A PERSON OFFERED. "Coaching form for <R>. Also a CA for <R2>."
 * with first names only, and the models reading R2: no card, and "Is this for
 * **<R2>**?" — the other form's person offered for a form the reply does not
 * name. That question is replaced by the requests named back, each with its
 * own person; nothing is offered.
 */
const OFFERS_A_PERSON = /\bIs this for \*\*([^*]+)\*\*\?/;

function withoutOtherFormsPersonAsked(response: AskResponse, requests: readonly FormRequest[]): AskResponse {
  const offered = OFFERS_A_PERSON.exec(response.content)?.[1];
  if (!offered || !requests.some((entry) => namesIn(entry.clause, offered))) return response;
  const list = requests.map((entry) => `a **${formName(entry.templateKey)}**${entry.employeeName ? ` for **${entry.employeeName}**` : ""}`);
  const content = `You asked for ${requests.length === 2 ? "two" : String(requests.length)} forms: ${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}. Ask for each one on its own, with the employee's full name, and I'll set it up.`;
  return { ...response, content };
}

/*
 * ============================================================================
 * EACH REQUEST WITH ITS OWN PERSON (TWO_FORMS_EACH_PERSON_ENABLED, default off; QA, Sunny live tester after flip 7,
 * 7 Nov 2026)
 * ============================================================================
 *
 * With TWO_FORMS_OWN_PERSON live, "Coaching form for <A>. Also a CA for <B>." gave ONE Coaching card with no
 * employee ("Who is this for?") and "ask for <B>'s CA on its own": the person A typed in the card's own clause was
 * dropped, and B's form was not offered. With this flag on: when the card is not its own clause's person and that
 * clause names one, the card is answered again from that clause alone, so it is A's, checked against the roster
 * as any card is; each other request that names its person is OFFERED, one line, and a plain "yes" to it is that
 * request ("Create a <form> for <B>."). A request naming nobody is still named back as before. Off, as before.
 */
const NEXT_FORM_OFFER = /\*\*Do you want an? ([^*]+?) for ([^*?]+) next\?\*\* Say \*\*yes\*\* and I'll start it\./;
const ALSO_ASKED_LINE = /^You also asked for an? \*\*[^*]+\*\*(?: for \*\*[^*]+\*\*)? — ask for it on its own[^\n]*$/;

function article(name: string): string {
  return /^[aeiou]/i.test(name) ? "an" : "a";
}

/*
 * QA, 8 Nov 2026 (round-5 follow-up, same flag): "… a CA for rowan kestrel" was offered as "for rowan kestrel next?". A
 * name typed all lower-case is shown with each word capitalised ("Rowan Kestrel", "Mary-Kate O'Neil"); a name with any
 * capital is shown as typed. The display only: the "yes" reads whatever the offer says.
 */
function shownName(name: string): string {
  return name === name.toLowerCase() ? name.replace(/(^|[\s'’-])(\p{Ll})/gu, (_, lead: string, letter: string) => `${lead}${letter.toUpperCase()}`) : name;
}

/** The other requests: an offer for each that names its person, the old line for one that does not. */
function offersFor(others: readonly FormRequest[]): string[] {
  return others.map((other) => {
    const name = formName(other.templateKey);
    return other.employeeName
      ? `**Do you want ${article(name)} ${name} for ${shownName(other.employeeName)} next?** Say **yes** and I'll start it.`
      : `You also asked for ${article(name)} **${name}** — ask for it on its own, with who it's for, and I'll set it up.`;
  });
}

export async function withEachPersonsForm(
  response: AskResponse,
  request: AskRequest,
  answer: (turn: AskRequest) => Promise<AskResponse>,
): Promise<AskResponse> {
  // ONE_FORM_EACH_PERSON_ENABLED: one form, several people — one each, the rest queued (below).
  if (oneFormEachPersonEnabled() && (peopleRequest(request.question) || queueIn(lastAssistant(request.history)))) {
    return withOneFormEachPerson(response, request, answer);
  }
  if (!twoFormsEachPersonEnabled()) return response;
  const reading = readFormRequests(request.question);
  if (!reading || reading.requests.length < 2) return response;
  const card = response.formProposal;
  const ownAt = card ? reading.requests.findIndex((entry) => entry.templateKey === card.templateKey) : 0;
  if (ownAt < 0) return response;
  const own = reading.requests[ownAt]!;
  const others = reading.requests.filter((_, index) => index !== ownAt);
  const employee = card?.employeeName?.trim() || null;
  const ownPerson = employee !== null && namesIn(own.clause, employee);

  let base = response;
  if (!ownPerson && own.employeeName) {
    const again = await answer({ ...request, question: own.clause });
    const theirs = again.formProposal?.employeeName?.trim() || null;
    if (!again.formProposal || theirs === null || !namesIn(own.clause, theirs)) return response;
    base = again;
  } else if (!ownPerson) {
    return response;
  }
  const kept = base.content
    .split("\n")
    .filter((line) => !ALSO_ASKED_LINE.test(line.trim()))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { ...base, content: [kept, ...offersFor(others)].join("\n\n") };
}

/** The manager's plain "yes" to the offer in the assistant's last message, as the request it offered. Off, null. */
export function acceptedNextFormOffer(input: Pick<AskRequest, "question" | "history">): string | null {
  const nextPerson = acceptedNextPersonOffer(input);
  if (nextPerson) return nextPerson;
  if (!twoFormsEachPersonEnabled() || !AFFIRMATIVE.test(input.question)) return null;
  const last = [...(input.history ?? [])].reverse().find((turn) => turn.role === "assistant");
  const match = typeof last?.content === "string" ? NEXT_FORM_OFFER.exec(last.content) : null;
  return match ? `Create ${article(match[1]!)} ${match[1]} for ${match[2]}.` : null;
}

/*
 * ============================================================================
 * "A COACHING FORM FOR <A>, <B>, AND <C>" IS ONE FORM EACH (ONE_FORM_EACH_PERSON_ENABLED, default off; QA's P7, Sunny
 * live on the 13b chat code, 10 Nov 2026; the people invented)
 * ============================================================================
 *
 * "Make me a coaching form for <A>, <B>, and <C> for not closing duties correctly" asked only which <A> it was, then
 * made ONE card whose Observation held "<B>, and <C> for …": the other two people were never handled. QA's decision:
 * one form each. With this flag on, such a request (one form, two or more people named in a list, the reason after
 * it) is answered for the first person alone — "a coaching form for <A> for not closing duties correctly", so a first
 * name two people share is asked first — and a "**Next:**" line names the others and the reason. While the next turns
 * are about that form (its card, or the question which person), the line is carried. A plain "yes" to it starts the
 * next person's form with the same reason ("Create a Coaching Form for <B> for not closing duties correctly."), and the
 * line goes on with the rest, until each has had theirs. Off, as before.
 */
const PERSON = String.raw`\p{Lu}[\p{L}'’-]+(?:\s+\p{Lu}[\p{L}'’-]+)?`;
/** "<lead> for <A>, <B>, and <C> <rest>": the list of two or more names after "for", and what follows it. */
const PEOPLE_LIST = new RegExp(
  String.raw`^(.*?\bfor\s+)(${PERSON}(?:(?:\s*,\s*(?:and\s+)?|\s+and\s+)${PERSON})+)(\s+(?:for|about|because|due\s+to|regarding)\b[^\n]*?)?\s*[.!]?$`,
  "u",
);
const ASKS_WHO_IT_IS = /\bIs this for \*\*[^*]+\*\*\?|\bDid you mean\b/;
const NEXT_LINE = /^\*\*Next:\*\* an? (.+?) each for (.+?)(?:, for (.+?))?\. Say \*\*yes\*\* when this one is done and I'll start the next\.$/m;

export interface PeopleRequest {
  readonly templateKey: string;
  readonly people: readonly string[];
  /** " for not closing duties correctly", as typed after the list; "" when none. */
  readonly rest: string;
  /** The request for one person: the manager's words with the list replaced by that person. */
  readonly clauseFor: (person: string) => string;
}

/** A request for one form for two or more people named in a list, or null. */
export function peopleRequest(question: string): PeopleRequest | null {
  const text = (question ?? "").trim();
  const match = PEOPLE_LIST.exec(text);
  if (!match) return null;
  const intent = detectTemplateIntent(match[1]!);
  const templateKey = intent.kind === "explicit" ? intent.templateKey : intent.kind === "corrective_action" ? "dpoa" : null;
  if (!templateKey) return null;
  const people = match[2]!.split(/\s*,\s*(?:and\s+)?|\s+and\s+/).map((name) => name.trim()).filter(Boolean);
  if (people.length < 2) return null;
  const rest = (match[3] ?? "").replace(/[.!]+$/, "");
  return { templateKey, people, rest, clauseFor: (person) => `${match[1]}${person}${rest}` };
}

/**
 * A queued first name as the one roster person it can only be ("Corwin" → "Corwin Halsey"), so the next request names
 * them in full and is never a "yes" to "Is this for …?" that the stored turns cannot read back. Two or none: as typed
 * (the next request asks which, as any request does). No roster read this turn: as typed.
 */
function fullName(typed: string): string {
  const roster = personRosterNames() ?? [];
  if (/\s/.test(typed.trim())) return typed;
  const first = typed.trim().toLowerCase();
  const matches = [...new Set(roster.filter((name) => name.trim().split(/\s+/)[0]!.toLowerCase() === first))];
  return matches.length === 1 ? matches[0]! : typed;
}

function listed(names: readonly string[]): string {
  const bold = names.map((name) => `**${name}**`);
  return bold.length <= 1 ? bold.join("") : `${bold.slice(0, -1).join(", ")} and ${bold[bold.length - 1]}`;
}

function nextLine(templateKey: string, people: readonly string[], rest: string): string {
  const name = formName(templateKey);
  const reason = rest.trim().replace(/^for\s+/i, "");
  return `**Next:** ${article(name)} ${name} each for ${listed(people)}${reason ? `, for ${reason}` : ""}. Say **yes** when this one is done and I'll start the next.`;
}

interface Queue {
  readonly form: string;
  readonly people: readonly string[];
  readonly reason: string;
}

function queueIn(content: string | undefined): Queue | null {
  const match = typeof content === "string" ? NEXT_LINE.exec(content) : null;
  if (!match) return null;
  const people = [...match[2]!.matchAll(/\*\*([^*]+)\*\*/g)].map((entry) => entry[1]!.trim());
  return people.length > 0 ? { form: match[1]!, people, reason: match[3] ?? "" } : null;
}

function lastAssistant(history: AskRequest["history"] | undefined): string | undefined {
  const turn = [...(history ?? [])].reverse().find((entry) => entry.role === "assistant");
  return typeof turn?.content === "string" ? turn.content : undefined;
}

/** ONE_FORM_EACH_PERSON_ENABLED: a plain "yes" to the "**Next:**" line, as the next person's request. Off, null. */
export function acceptedNextPersonOffer(input: Pick<AskRequest, "question" | "history">): string | null {
  if (!oneFormEachPersonEnabled() || !AFFIRMATIVE.test(input.question)) return null;
  const last = lastAssistant(input.history);
  // A "yes" to "Is this for <X>?" or "Did you mean …?" confirms that person; only a yes to a card starts the next.
  if (!last || ASKS_WHO_IT_IS.test(last)) return null;
  const queue = queueIn(last);
  if (!queue) return null;
  return `Create ${article(queue.form)} ${queue.form} for ${queue.people[0]}${queue.reason ? ` for ${queue.reason}` : ""}.`;
}

/**
 * ONE_FORM_EACH_PERSON_ENABLED, after the turn is answered: a request for several people is answered for the first,
 * with the others queued; a turn that goes on with the queue (the next person's request, the answer to "which one?",
 * or a turn about that form) carries the rest. Off, or no list and no queue, the answer as it was.
 */
export async function withOneFormEachPerson(
  response: AskResponse,
  request: AskRequest,
  answer: (turn: AskRequest) => Promise<AskResponse>,
): Promise<AskResponse> {
  if (!oneFormEachPersonEnabled()) return response;
  const asked = peopleRequest(request.question);
  if (asked) {
    const first = await answer({ ...request, question: asked.clauseFor(asked.people[0]!) });
    return { ...first, content: `${first.content.trim()}\n\n${nextLine(asked.templateKey, asked.people.slice(1).map(fullName), asked.rest)}` };
  }
  const queue = queueIn(lastAssistant(request.history));
  if (!queue) return response;
  const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const startedNext = new RegExp(String.raw`^Create an? ${escape(queue.form)} for ${escape(queue.people[0]!)}\b`, "i").test(request.question);
  /*
   * The next person's request is a new request, never a change of the card on screen: answered without it, so the
   * roster is asked as for any request ("Is this for <B> <s>?"), never the typed first name kept on the old card.
   */
  const base = startedNext ? await answer({ ...request, continueProposalTemplateKey: undefined }) : response;
  const card = base.formProposal;
  const sameForm = card ? formName(card.templateKey) === queue.form : ASKS_WHO_IT_IS.test(base.content);
  if (!sameForm) return base;
  const rest = startedNext ? queue.people.slice(1) : queue.people;
  if (rest.length === 0 || NEXT_LINE.test(base.content)) return base;
  const key = card?.templateKey ?? TEMPLATE_SEEDS.find((seed) => seed.name === queue.form)?.key ?? "";
  return { ...base, content: `${base.content.trim()}\n\n${nextLine(key, rest, queue.reason ? ` for ${queue.reason}` : "")}` };
}
