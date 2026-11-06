import { differentEmployeeNewFormEnabled } from "@/lib/config/chat-quality-flags";
import { accountSentences, requestIncident } from "@/lib/ai/remap-incident";
import type { AskRequest, AskResponse } from "@/lib/ai/types";
import type { RosterEmployee } from "@/lib/forms/employee-match";
import { namingTheForm, typedPeopleAfterFor } from "@/lib/forms/other-employee";
import { cardEmployee } from "@/lib/forms/same-form-other-person";
import { TEMPLATE_SEEDS } from "@/lib/forms/library";
import { detectTemplateIntent } from "@/lib/forms/template-intent";

/**
 * ============================================================================
 * "NOW ONE FOR <B> AT <STORE> FOR BEING LATE ON 10-20-26" IS <B>'S OWN CARD
 * ============================================================================
 *
 * DIFFERENT_EMPLOYEE_NEW_FORM_ENABLED (QA live B21-4, 25 Oct 2026, #224; the
 * old-PR audit, 6 Nov 2026; same flag in both apps; default off). With <A>'s
 * Corrective Action card on screen, "now one for Test Employee Two at Lawrence
 * for being late on 10-20-26" was read as more of <A>'s card: the card stayed
 * <A>'s and <B>'s turn joined its sources, so <B>'s incident would be drafted
 * onto <A>'s form. With <A>'s form created and open, <B> got no card ("I
 * haven't changed the Corrective Action Form for <A>").
 *
 * With the flag on, a turn is <B>'s request when, read with the existing
 * readers only:
 *
 *   - it asks for a form for somebody: "one / another one / the same for …"
 *     or a form named ("a CA for …"), with the person typed after "for" read
 *     whole, in any case, and never a person the manager ruled out ("not for
 *     <B>", "do not make one for <B>") — `other-employee.ts`, #224's reader;
 *   - that person is, by their whole name, somebody on the manager's roster
 *     who is not the card's (or the open form's) employee — never by
 *     `samePerson`, which reads "Test Employee Two" as "Test Employee";
 *   - the turn gives <B>'s account (`requestIncident` / `accountSentences`).
 *     A turn naming <B> with no account is SAME_FORM_OTHER_PERSON's (a copy of
 *     <A>'s form), never this.
 *
 * Then the turn is read as a request of its own, from that turn only: the
 * form named in place of "one", no earlier turn, no card continued and no form
 * open — so <B>'s card is built from <B>'s account alone, and <A>'s card and
 * form are not touched. Create reads the conversation the same way
 * (`differentEmployeeReadConversation`).
 *
 * Off: nothing here runs, and no roster is read.
 */

export interface DifferentEmployee {
  /** The card's (or the open form's) employee. */
  readonly from: string;
  /** The other roster person the turn asks a form for, as the roster spells them. */
  readonly to: string;
  /** The words the manager typed for them ("test employee two"). */
  readonly typed: string;
}

const norm = (text: string) =>
  text
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^a-z0-9' -]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .join(" ");

/** A roster person's whole names: first or preferred first name, and the surname. */
function wholeNames(person: RosterEmployee): string[] {
  return [person.firstName, person.preferredFirstName ?? ""]
    .filter((first) => first.trim() !== "")
    .map((first) => norm(`${first} ${person.lastName}`));
}

/** The roster person a typed name is, by their whole name: the longest run of its words that is one. */
function rosterPersonTyped(typed: string, people: readonly RosterEmployee[]): RosterEmployee | null {
  const words = norm(typed).split(" ");
  for (let length = words.length; length >= 2; length -= 1) {
    const name = words.slice(0, length).join(" ");
    const found = people.filter((person) => wholeNames(person).includes(name));
    if (found.length === 1) return found[0]!;
    if (found.length > 1) return null;
  }
  return null;
}

/** The roster ids the card's employee can be: by their whole name, or by their first name alone. */
function idsOf(employee: string, people: readonly RosterEmployee[]): Set<string> {
  const name = norm(employee);
  const whole = people.filter((person) => wholeNames(person).includes(name));
  if (whole.length > 0) return new Set(whole.map((person) => person.id));
  const first = name.split(" ")[0]!;
  return new Set(people.filter((person) => norm(person.firstName) === first || norm(person.preferredFirstName ?? "") === first).map((person) => person.id));
}

/** The words of a request that only ask for the form: "now one for", "a CA for", "can you do another". */
const REQUEST_WORD =
  /^(?:now|one|another|the|same|thing|for|a|an|can|could|you|please|make|me|do|create|start|draft|write|up|need|i|want|to|also|and|ca|c\/a|corrective|action|form|coaching|verbal|written|warning|new|too|as|well)$/;

/** What the reader found says what happened: a word beyond the request and the name ("now one for" is not an account). */
function saysWhatHappened(told: string, name: string): boolean {
  const own = new Set(norm(name).split(" "));
  return norm(told)
    .split(" ")
    .some((word) => /[a-z0-9]/.test(word) && !own.has(word) && !REQUEST_WORD.test(word));
}

const ASKS_ONE = /\b(?:one|another(?:\s+one)?|(?:the\s+)?same(?:\s+thing)?)\s+for\s/i;

/** <B>'s own request in this turn, read from this turn alone; null when the turn is not that. */
export function readDifferentEmployee(input: {
  readonly question: string;
  readonly employeeName: string | null | undefined;
  readonly people: readonly RosterEmployee[];
}): DifferentEmployee | null {
  const from = input.employeeName?.trim();
  const question = input.question.trim();
  if (!differentEmployeeNewFormEnabled() || !from || !question || input.people.length === 0) return null;
  if (!ASKS_ONE.test(question) && detectTemplateIntent(question).kind === "none") return null;
  const own = idsOf(from, input.people);
  const others = typedPeopleAfterFor(question, [from])
    .map((typed) => rosterPersonTyped(typed, input.people))
    .filter((person): person is RosterEmployee => person !== null && !own.has(person.id));
  const distinct = [...new Map(others.map((person) => [person.id, person])).values()];
  if (distinct.length !== 1) return null;
  const person = distinct[0]!;
  const to = `${person.firstName} ${person.lastName}`;
  // <B>'s account: what the incident or account reader finds about <B> in this turn. None: not this request.
  const typed = typedPeopleAfterFor(question, [from]).find((name) => rosterPersonTyped(name, input.people)?.id === person.id) ?? to;
  const account = [to, typed].some((name) =>
    [
      requestIncident({ text: question, employeeName: name, slotClause: () => false }),
      ...accountSentences([question], name),
    ].some((told) => told !== null && saysWhatHappened(told, name)),
  );
  return account ? { from, to, typed: wholeTyped(typed, person) } : null;
}

/** The words of a typed run that are the person's whole name ("TEST EMPLOYEE TWO AT" → "TEST EMPLOYEE TWO"). */
function wholeTyped(typed: string, person: RosterEmployee): string {
  const words = typed.trim().split(/\s+/);
  for (let length = words.length; length >= 2; length -= 1) {
    if (wholeNames(person).includes(norm(words.slice(0, length).join(" ")))) return words.slice(0, length).join(" ");
  }
  return typed;
}

/**
 * The turn as a request of its own: the form named in place of "one" when the
 * turn names none, and the person as the roster spells them ("test employee
 * two" → "Test Employee Two"), so the card names them as the roster does.
 */
function ownRequest(question: string, templateName: string | null, reading?: DifferentEmployee): string {
  const named = templateName && detectTemplateIntent(question).kind === "none" ? namingTheForm(question, templateName) : question;
  if (!reading || reading.typed === reading.to) return named;
  const at = named.indexOf(reading.typed);
  return at < 0 ? named : `${named.slice(0, at)}${reading.to}${named.slice(at + reading.typed.length)}`;
}

/**
 * With <A>'s card on screen (`continueProposalTemplateKey`, nothing created)
 * or, from the chat route, <A>'s form open (`open`): <B>'s request, read as a
 * request of its own from this turn only — no earlier turn, no card continued,
 * no form open. Anything else: the request as it is.
 */
export function withDifferentEmployee<T extends AskRequest>(
  request: T,
  people: readonly RosterEmployee[],
  open?: { readonly employeeName: string | null; readonly templateName: string | null } | null,
): T {
  if (!differentEmployeeNewFormEnabled()) return request;
  const afterCreate = open !== undefined;
  if (!afterCreate && (!request.continueProposalTemplateKey || request.activeFormInstanceId)) return request;
  const history = request.history as Parameters<typeof cardEmployee>[0];
  const reading = readDifferentEmployee({ question: request.question, employeeName: afterCreate ? open?.employeeName : earlierEmployee(history, people), people });
  if (!reading) return request;
  const templateName = afterCreate ? (open?.templateName ?? null) : (templateNameOf(history) ?? templateNameOfKey(request.continueProposalTemplateKey));
  return {
    ...request,
    question: ownRequest(request.question, templateName, reading),
    history: [],
    continueProposalTemplateKey: undefined,
    activeFormInstanceId: undefined,
    activeFormCandidateIds: undefined,
    differentEmployeeFor: { employeeName: reading.to },
  };
}

/** A form's name by its key ("dpoa" → "Corrective Action Form"). */
function templateNameOfKey(key: string | null | undefined): string | null {
  return TEMPLATE_SEEDS.find((seed) => seed.key === key)?.name ?? null;
}

/**
 * Whose card was on screen: the newest card's employee where the turns carry
 * one, else the newest manager turn's person typed whole after "for" and on
 * the roster, else coding 3's reading (`cardEmployee`).
 */
function earlierEmployee(history: Parameters<typeof cardEmployee>[0], people: readonly RosterEmployee[]): string | null {
  if (history.some((turn) => turn.formProposal?.employeeName?.trim())) return cardEmployee(history, people);
  for (const turn of [...history].reverse()) {
    if (turn.role !== "user" || typeof turn.content !== "string") continue;
    for (const typed of typedPeopleAfterFor(turn.content).reverse()) {
      const found = rosterPersonTyped(typed, people);
      if (found) return `${found.firstName} ${found.lastName}`;
    }
  }
  return cardEmployee(history, people);
}

/** The newest card's form name in the turns. */
function templateNameOf(history: readonly { readonly formProposal?: unknown }[]): string | null {
  for (const turn of [...history].reverse()) {
    const name = (turn.formProposal as { templateName?: string | null } | null | undefined)?.templateName;
    if (name) return name;
  }
  return null;
}

/**
 * <B>'s card: its draft sources are this turn alone, so Create drafts it from
 * <B>'s account only and never from <A>'s turns. Where the card's person was
 * read as the first words of <B>'s whole name only ("Test" for "Test Employee
 * Two": the name reader stops at "Employee"), the card names <B> as the
 * reading did, by the roster's whole name; the close-name note that asked
 * "Test Employee or Test Employee Two" no longer applies.
 */
export function withDifferentEmployeeSources(response: AskResponse, request: AskRequest): AskResponse {
  const card = response.formProposal;
  const read = request.differentEmployeeFor;
  if (!card || !read || !differentEmployeeNewFormEnabled() || !request.questionMessageId) return response;
  const sources = [request.questionMessageId];
  const cut = cutShort(card.employeeName, read.employeeName);
  if (sources.join() === card.sourceMessageIds.join() && !cut) return response;
  const named = cut ? { employeeName: read.employeeName, wovenCloseMatch: undefined } : {};
  return { ...response, formProposal: { ...card, sourceMessageIds: sources, ...named } };
}

/** The card's person is the first words of <B>'s whole name, and fewer of them. */
function cutShort(cardName: string | null | undefined, whole: string): boolean {
  const card = norm(cardName ?? "").split(" ").filter(Boolean);
  const words = norm(whole).split(" ");
  return card.length > 0 && card.length < words.length && card.every((word, index) => word === words[index]);
}

/**
 * THE CONVERSATION CREATE CHECKS, READ THE WAY THE CHAT READ IT. The create
 * route checks a card against the conversation the browser sends, where <B>'s
 * request follows <A>'s turns and names two people. The chat read <B>'s
 * request as a request of its own, so Create reads it the same way: from that
 * turn on, with the form named in place of "one". Nothing stored is changed;
 * only the check reads this.
 */
export function differentEmployeeReadConversation<T extends { readonly role: string; readonly content: string }>(
  turns: T[],
  people: readonly RosterEmployee[],
): T[] {
  if (!differentEmployeeNewFormEnabled()) return turns;
  let read = turns;
  for (let index = read.length - 1; index > 0; index -= 1) {
    const turn = read[index]!;
    if (turn.role !== "user" || typeof turn.content !== "string") continue;
    const before = read.slice(0, index) as unknown as Parameters<typeof cardEmployee>[0];
    if (!readDifferentEmployee({ question: turn.content, employeeName: earlierEmployee(before, people), people })) continue;
    read = [{ ...turn, content: ownRequest(turn.content, "form") }, ...read.slice(index + 1)];
    break;
  }
  return read;
}
