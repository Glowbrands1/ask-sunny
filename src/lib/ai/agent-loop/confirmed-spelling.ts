import { AFFIRMATIVE, displayName, saysNo, type RosterEmployee } from "@/lib/forms/employee-match";
import { notAPerson } from "@/lib/forms/person-guard";
import { extractEmployeeNames, samePerson } from "@/lib/forms/proposal";
import type { ChatMessage } from "@/types";

import { personKey, replyTurns, type NameQuestionRecord } from "./card-record";
import { holdsPhrase } from "./evidence";

/**
 * ============================================================================
 * THE ANSWER TO A "DID YOU MEAN" (fix batch items 4 and 3)
 * ============================================================================
 *
 * Pau's ruling A (15 Nov 2026): a close spelling is never seated; find_staff gives a "Did you mean" and the manager
 * answers. Item 4 (c022): the full name typed back is a yes, and the turn that typed the close spelling is that
 * person's request (it was read as another person's, so the card lost its date and the chat went 4 turns with no card).
 * Item 3 (c137): a reply that names somebody else in full is not a yes.
 *
 * What was asked comes from the server's NAME QUESTION RECORD (`card-record.ts`; QA's review of #1051), never from the
 * reply's text: a paraphrased question counts the same. The manager's answer is read with today's bare yes
 * (`AFFIRMATIVE`, to one offered person) or one offered person's full name as whole words (`holdsPhrase`, as evidence.ts
 * reads quotes). No new word list.
 */

export interface NameQuestionView {
  readonly history: readonly ChatMessage[];
  readonly question: string;
  readonly records: readonly NameQuestionRecord[];
  readonly roster: readonly RosterEmployee[];
}

export interface AnsweredNameQuestion {
  readonly record: NameQuestionRecord;
  /** The roster people the question offered, found again by key. */
  readonly offered: readonly RosterEmployee[];
  /** The manager's answer (the next manager turn after the question's reply). */
  readonly answer: string;
  /** The answer is the message being answered now. */
  readonly latest: boolean;
  /** The person the answer confirmed, and how; null when it confirmed nobody. */
  readonly confirmed: RosterEmployee | null;
  readonly by: "yes" | "full_name" | null;
}

/** A roster person's full names: legal, and preferred first name with the surname. */
function fullNames(person: RosterEmployee): string[] {
  return [...new Set([displayName(person), `${person.firstName} ${person.lastName}`, person.preferredFirstName ? `${person.preferredFirstName} ${person.lastName}` : ""])]
    .map((name) => name.replace(/\s+/g, " ").trim())
    .filter((name) => name.split(" ").length > 1);
}

/** Every recorded name question this chat's manager has answered, oldest first. */
export function answeredNameQuestions(view: NameQuestionView): AnsweredNameQuestion[] {
  const out: AnsweredNameQuestion[] = [];
  for (const [reply, record] of [...replyTurns(view.history, view.records)].sort(([a], [b]) => a - b)) {
    const next = view.history.findIndex((turn, at) => at > reply && turn.role === "user");
    const latest = next < 0;
    const answer = latest ? view.question : String(view.history[next]!.content ?? "");
    const offered = record.offeredKeys.flatMap((key) => view.roster.filter((row) => personKey(row.id) === key));
    let confirmed: RosterEmployee | null = null;
    let by: AnsweredNameQuestion["by"] = null;
    // A bare yes confirms only a question that offered one person (an offered name off the roster counts as one).
    if (offered.length === 1 && (record.offeredNameKeys?.length ?? 0) === 0 && AFFIRMATIVE.test(answer)) {
      confirmed = offered[0]!;
      by = "yes";
    } else {
      const held = offered.filter((person) => fullNames(person).some((name) => holdsPhrase(answer, name)));
      if (held.length === 1) {
        confirmed = held[0]!;
        by = "full_name";
      }
    }
    out.push({ record, offered, answer, latest, confirmed, by });
  }
  return out;
}

/** The typed-name keys the manager confirmed as this roster person: a name with one of these keys is this person. */
export function spellingKeysConfirmedFor(view: NameQuestionView, employeeId: string): string[] {
  return answeredNameQuestions(view).filter((asked) => asked.confirmed?.id === employeeId).map((asked) => asked.record.typedKey);
}

/**
 * Item 5 follow-up (Pau, 16 Nov 2026): the typed-name keys the manager confirmed as a person who is NOT on the roster: a
 * recorded question offered this name (by key), or asked for the full name (the answer bridge: "I can't find **<A'>** …
 * give me the full name"), and the manager's next message holds this name in full as whole words. "use <A'>" keeps <A'>.
 */
export function spellingKeysConfirmedForName(view: NameQuestionView, name: string): string[] {
  const key = personKey(name);
  return [...replyTurns(view.history, view.records)]
    // Offered by name (the which-person question), or the app asked for the full name and this is a different name given.
    .filter(([, record]) => record.offeredNameKeys?.includes(key) || (record.asksFullName === true && record.typedKey !== key))
    .flatMap(([reply, record]) => {
      const next = view.history.findIndex((turn, at) => at > reply && turn.role === "user");
      const answer = next < 0 ? view.question : String(view.history[next]!.content ?? "");
      return name.trim().split(/\s+/).length > 1 && holdsPhrase(answer, name) ? [record.typedKey] : [];
    });
}

/** A name read from the manager's words is one the manager confirmed as this person. */
export function isConfirmedSpelling(name: string, keys: readonly string[]): boolean {
  return keys.length > 0 && keys.includes(personKey(name));
}

/** The message being answered now confirms this roster person in answer to a recorded name question. */
export function latestTurnConfirms(view: NameQuestionView, employeeId: string): AnsweredNameQuestion | null {
  return answeredNameQuestions(view).find((asked) => asked.latest && asked.confirmed?.id === employeeId) ?? null;
}

/**
 * Item 3 (c137): the message being answered now answers a recorded question that offered this person, is not a yes (no
 * offered full name, and its first clause is not today's bare yes), and names somebody else in full (a capitalised name
 * `extractEmployeeNames` reads, or a roster person's full name as whole words). Null otherwise.
 */
export function answerNamesSomeoneElse(view: NameQuestionView, employeeId: string): { others: string[] } | null {
  const asked = answeredNameQuestions(view).find((question) => question.latest && question.offered.some((person) => person.id === employeeId));
  if (!asked || asked.confirmed) return null;
  // A yes that goes on with the account ("yes, she was late on 11/14, <B> saw it"): its first clause is today's bare yes.
  if (AFFIRMATIVE.test(asked.answer.split(/[,.;!\n]/)[0] ?? "")) return null;
  const offeredNames = asked.offered.flatMap(fullNames);
  const isOffered = (name: string) => personKey(name) === asked.record.typedKey || offeredNames.some((offered) => samePerson(name, offered));
  const read = extractEmployeeNames(asked.answer).filter((name) => name.trim().split(/\s+/).length > 1 && !notAPerson(name));
  const onRoster = view.roster.flatMap(fullNames).filter((name) => holdsPhrase(asked.answer, name));
  const others = [...new Set([...onRoster, ...read])].filter((name) => !isOffered(name));
  return others.length > 0 ? { others } : null;
}

/**
 * fix-name, live s10: the message being answered now answers a recorded name question for THIS typed name (the record's
 * typedKey), confirming nobody, with today's "no" / "keep it as typed" (ruling A: the name goes on as typed). The question
 * comes from the server's record, never from the reply's text.
 */
export function latestTurnKeepsTyped(view: NameQuestionView, typed: string): boolean {
  return answeredNameQuestions(view).some((asked) => asked.latest && !asked.confirmed && asked.record.typedKey === personKey(typed) && saysNo(asked.answer));
}

/** The message being answered now answers a recorded name question for this typed name (whatever it says). */
export function latestTurnAnswersFor(view: NameQuestionView, typed: string): boolean {
  return answeredNameQuestions(view).some((asked) => asked.latest && asked.record.typedKey === personKey(typed));
}
