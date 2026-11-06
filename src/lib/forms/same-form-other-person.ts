import { sameFormOtherPersonEnabled } from "@/lib/config/chat-quality-flags";
import { accountSentences, requestIncident } from "@/lib/ai/remap-incident";
import type { AskRequest, AskResponse } from "@/lib/ai/types";
import { JOIN } from "@/lib/forms/bounded-context";
import { matchEmployeeName, type RosterEmployee } from "@/lib/forms/employee-match";
import { extractEmployeeNames, samePerson } from "@/lib/forms/proposal";
import { swapName } from "@/lib/forms/same-form-copy";
import { detectTemplateIntent } from "@/lib/forms/template-intent";
import { statedWarningLevel, type StatedWarningLevel } from "@/lib/forms/warning-level";

/**
 * ============================================================================
 * "CAN YOU DO THE SAME THING FOR <B> BUT SWITCH IT TO A WRITTEN"
 * ============================================================================
 *
 * SAME_FORM_OTHER_PERSON_ENABLED (QA's overnight scan sf-s11, 4 Nov 2026, and
 * coding3 (a), 5 Nov 2026; same flag in both apps; default off). With <A>'s
 * Corrective Action card on screen — or created and open — the manager asked
 * for the same form for <B>. The card stayed <A>'s and the request sentence
 * was written into its Observation of Offense (or <A>'s card took the new
 * level); no card for <B>. The person reader (`employeeState`) treats <B> as a
 * name said in passing, and the new-person request needs a form named.
 *
 * With the flag on, a turn is such a request when, read with the existing
 * readers only:
 *
 *   - it names exactly one person on the manager's roster other than the
 *     card's (or the open form's) employee (`extractEmployeeNames`, kept by
 *     `matchEmployeeName`; <A>'s first or preferred name is <A>);
 *   - the incident and account readers find no account in it
 *     (`requestIncident`, `accountSentences`) — so "she was rude to <B> when
 *     he reminded her" is more of <A>'s account, never a request for <B>;
 *   - it names no form (`detectTemplateIntent`), so a request for a form of
 *     its own goes where it always went.
 *
 * Then <B>'s card is read from the turns <A>'s card was read from, <A>'s name
 * swapped for <B>'s (`swapName`, the copy's own swap), and this turn's warning
 * level (`statedWarningLevel`) as the newest turn. <A>'s card and form are not
 * touched. At Create the drafting notes are read the same way
 * (`sameFormOtherPersonNotes`): never the request sentence as the account,
 * never <A>'s name on <B>'s form, and the level only as the card's field.
 *
 * Off: nothing here runs, and no roster is read.
 */

export interface SameFormOtherPerson {
  /** The card's (or the open form's) employee. */
  readonly from: string;
  /** The one other roster person the turn names. */
  readonly to: string;
  /** The level the turn states for the new card, or null. */
  readonly level: StatedWarningLevel | null;
}

/** The roster people a typed name can be: the exact one, or those the name check would ask about. */
function rosterIdsOf(name: string, people: readonly RosterEmployee[]): string[] {
  const match = matchEmployeeName(name, people);
  if (match.kind === "exact") return [match.employee.id];
  if (match.kind === "confirm") return match.candidates.map((candidate) => candidate.employee.id);
  return [];
}

/** Whether a typed name is this employee: the same words, a first name, or the same roster person. */
function isEmployee(name: string, employee: string, people: readonly RosterEmployee[]): boolean {
  if (samePerson(name, employee)) return true;
  const own = new Set(rosterIdsOf(employee, people));
  return rosterIdsOf(name, people).some((id) => own.has(id));
}

/** The names a turn says that are somebody on the roster; every name read when there is no roster. */
function rosterPeopleIn(turn: string, people: readonly RosterEmployee[]): string[] {
  const names = extractEmployeeNames(turn);
  if (people.length === 0) return names;
  return names.filter((name) => rosterIdsOf(name, people).length > 0);
}

/**
 * The level this turn states: the whole turn as the level reader reads it,
 * else the words after the other person's name read the same way, from the
 * longest ending down ("… for <B> but switch it to a written").
 */
function turnLevel(turn: string, to: string): StatedWarningLevel | null {
  const whole = statedWarningLevel(turn);
  if (whole) return whole;
  const at = turn.toLowerCase().lastIndexOf(to.toLowerCase());
  if (at < 0) return null;
  const words = turn.slice(at + to.length).trim().split(/\s+/).filter(Boolean);
  for (let start = 0; start < words.length; start += 1) {
    const level = statedWarningLevel(words.slice(start).join(" "));
    if (level) return level;
  }
  return null;
}

/** The same form for one other roster person, read from this turn alone; null when the turn is not that. */
export function readSameFormOtherPerson(input: {
  readonly question: string;
  readonly employeeName: string | null | undefined;
  readonly people: readonly RosterEmployee[];
}): SameFormOtherPerson | null {
  const from = input.employeeName?.trim();
  const question = input.question.trim();
  if (!sameFormOtherPersonEnabled() || !from || !question) return null;
  if (detectTemplateIntent(question).kind !== "none") return null;
  const others = rosterPeopleIn(question, input.people).filter((name) => !isEmployee(name, from, input.people));
  const distinct = others.filter((name, index) => others.findIndex((other) => samePerson(other, name)) === index);
  if (distinct.length !== 1) return null;
  const to = distinct[0]!;
  // An account of what happened — read by the incident reader or the account reader — is never this request.
  if (requestIncident({ text: question, employeeName: to, slotClause: () => false }) !== null) return null;
  if (accountSentences([question], to).length > 0) return null;
  return { from, to, level: turnLevel(question, to) };
}

interface CardTurn {
  readonly id?: string;
  readonly role: string;
  readonly content: unknown;
  readonly formProposal?: { readonly employeeName?: string | null; readonly sourceMessageIds?: readonly string[] } | null;
}

/**
 * Whose card was on screen: the newest card's employee where the turns carry
 * one, else the person the newest manager turn names (the server reads the
 * conversation without its cards).
 */
function cardEmployee(history: readonly CardTurn[], people: readonly RosterEmployee[]): string | null {
  for (const turn of [...history].reverse()) {
    const card = turn.formProposal?.employeeName?.trim();
    if (card) return card;
  }
  for (const turn of [...history].reverse()) {
    if (turn.role !== "user" || typeof turn.content !== "string") continue;
    const named = rosterPeopleIn(turn.content, people)[0];
    if (named) return named;
  }
  return null;
}

function names(turn: string, employee: string, people: readonly RosterEmployee[]): boolean {
  return rosterPeopleIn(turn, people).some((name) => isEmployee(name, employee, people));
}

/**
 * The manager's turns about <A>'s card, where no card says which: from the
 * first turn naming <A> after the last turn naming anybody else.
 */
function turnsAbout<T extends { readonly content: string }>(users: readonly T[], employee: string, people: readonly RosterEmployee[]): T[] {
  let start = users.length;
  for (let index = users.length - 1; index >= 0; index -= 1) {
    const named = rosterPeopleIn(users[index]!.content, people);
    if (named.some((name) => !isEmployee(name, employee, people))) break;
    if (named.length > 0) start = index;
  }
  return users.slice(start);
}

/**
 * With <A>'s card on screen (`continueProposalTemplateKey`, nothing created)
 * or, from the chat route, <A>'s form open (`openEmployee`): <B>'s request,
 * read as the turns <A>'s card was read from — one turn each, <A>'s name
 * swapped for <B>'s — so the intake starts <B>'s card as it does for any
 * request that names another person. This turn's level goes on the card
 * (`withSameFormSources`). Anything else: the request as it is.
 */
export function withSameFormOtherPerson<T extends AskRequest>(
  request: T,
  people: readonly RosterEmployee[],
  openEmployee?: string | null,
): T {
  if (!sameFormOtherPersonEnabled()) return request;
  const afterCreate = openEmployee !== undefined;
  if (!afterCreate && (!request.continueProposalTemplateKey || request.activeFormInstanceId)) return request;
  const history = request.history as readonly CardTurn[];
  const reading = readSameFormOtherPerson({ question: request.question, employeeName: openEmployee ?? cardEmployee(history, people), people });
  if (!reading) return request;
  const users = history.filter(
    (turn): turn is CardTurn & { id: string; content: string } => turn.role === "user" && typeof turn.content === "string" && typeof turn.id === "string",
  );
  const sourceIds = new Set([...history].reverse().find((turn) => turn.formProposal?.sourceMessageIds?.length)?.formProposal?.sourceMessageIds ?? []);
  const fromCard = users.filter((turn) => sourceIds.has(turn.id));
  const sources = (fromCard.length > 0 ? fromCard : turnsAbout(users, reading.from, people)).filter(
    (turn) => !readSameFormOtherPerson({ question: turn.content, employeeName: reading.from, people }),
  );
  // <B> is put where <A> was named; turns that never named <A> cannot say who the new card is for.
  if (!sources.some((turn) => names(turn.content, reading.from, people))) return request;
  return {
    ...request,
    question: sources.map((turn) => swapName(turn.content, reading.from, reading.to)).join("\n"),
    continueProposalTemplateKey: undefined,
    activeFormInstanceId: undefined,
    sameFormFor: { sourceMessageIds: sources.map((turn) => turn.id), level: reading.level },
  };
}

/**
 * THE CONVERSATION CREATE CHECKS, READ THE WAY THE CHAT READ IT. The create
 * route checks a card against the conversation the browser sends, where "do
 * the same thing for <B> …" names <B> beside <A> and refused <B>'s card as
 * naming more than one person. The chat read <B>'s card from <A>'s turns with
 * <B>'s name, so Create reads that turn the same way, and <A>'s turns it was
 * read from as <B>'s request's (they no longer stand for a second person).
 * Nothing stored is changed; only the check reads this.
 */
export function sameFormReadConversation<T extends { readonly role: string; readonly content: string }>(
  turns: T[],
  people: readonly RosterEmployee[],
): T[] {
  if (!sameFormOtherPersonEnabled()) return turns;
  let read = turns;
  for (let index = 0; index < read.length; index += 1) {
    const turn = read[index]!;
    if (turn.role !== "user" || typeof turn.content !== "string") continue;
    const before = read.slice(0, index);
    const reading = readSameFormOtherPerson({ question: turn.content, employeeName: cardEmployee(before, people), people });
    if (!reading) continue;
    const users = before.filter((earlier) => earlier.role === "user" && typeof earlier.content === "string");
    const sources = turnsAbout(users, reading.from, people).filter(
      (earlier) => !readSameFormOtherPerson({ question: earlier.content, employeeName: reading.from, people }),
    );
    if (!sources.some((earlier) => names(earlier.content, reading.from, people))) continue;
    const content = sources.map((earlier) => swapName(earlier.content, reading.from, reading.to)).join("\n");
    const kept = before.filter((earlier) => !sources.includes(earlier));
    read = [...kept, { ...turn, content }, ...read.slice(index + 1)];
    index = kept.length;
  }
  return read;
}

/**
 * <B>'s card: its draft sources are <A>'s request turns and this turn, so
 * Create reads the same ones (`sameFormOtherPersonNotes`); its level is the
 * one this turn stated.
 */
export function withSameFormSources(response: AskResponse, request: AskRequest): AskResponse {
  const card = response.formProposal;
  const read = request.sameFormFor;
  if (!card || !read || !sameFormOtherPersonEnabled()) return response;
  const sources = [...read.sourceMessageIds, ...(request.questionMessageId ? [request.questionMessageId] : [])];
  const level = read.level ?? card.warningLevel;
  if (sources.join() === card.sourceMessageIds.join() && level === card.warningLevel) return response;
  return { ...response, formProposal: { ...card, sourceMessageIds: sources, ...(level ? { warningLevel: level } : {}) } };
}

/**
 * THE DRAFT, READ THE WAY THE CARD WAS. The notes Create sends are <A>'s
 * request turns and, last, "do the same thing for <B> …". When the last turn
 * is that request for the form's own employee, the notes are the earlier turns
 * with <A>'s name swapped for <B>'s — the manager's own words only, never the
 * request sentence and never a sentence the manager did not write. The level
 * this turn states goes on the form from the card (`withSameFormSources`), as
 * a stated level does. Anything else: null, and the notes are read as sent.
 */
export function sameFormOtherPersonNotes(notes: string, employeeName: string, people: readonly RosterEmployee[]): string | null {
  if (!sameFormOtherPersonEnabled() || !employeeName.trim()) return null;
  const turns = notes.split(JOIN).map((turn) => turn.trim()).filter(Boolean);
  if (turns.length < 2) return null;
  const earlier = turns.slice(0, -1);
  const named = earlier.flatMap((turn) => rosterPeopleIn(turn, people)).filter((name) => !isEmployee(name, employeeName, people));
  const from = named.at(-1);
  if (!from) return null;
  const reading = readSameFormOtherPerson({ question: turns.at(-1)!, employeeName: from, people });
  if (!reading || !isEmployee(reading.to, employeeName, people)) return null;
  const swapped = earlier.map((turn) => swapName(turn, from, employeeName));
  // The level is never written into the notes: it reaches the form as the card's own field (`warningLevel`, set at Create).
  return swapped.join(JOIN);
}
