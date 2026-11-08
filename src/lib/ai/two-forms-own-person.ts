import "server-only";

import { twoFormsEachPersonEnabled, twoFormsOwnPersonEnabled } from "@/lib/config/chat-quality-flags";
import { AFFIRMATIVE } from "@/lib/forms/employee-match";
import { readFormRequests, type FormRequest } from "@/lib/forms/form-requests";
import { TEMPLATE_SEEDS } from "@/lib/forms/library";

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
  if (!twoFormsEachPersonEnabled() || !AFFIRMATIVE.test(input.question)) return null;
  const last = [...(input.history ?? [])].reverse().find((turn) => turn.role === "assistant");
  const match = typeof last?.content === "string" ? NEXT_FORM_OFFER.exec(last.content) : null;
  return match ? `Create ${article(match[1]!)} ${match[1]} for ${match[2]}.` : null;
}
