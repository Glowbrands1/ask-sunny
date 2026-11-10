import type { AskResponse } from "@/lib/ai/types";
import type { ChatMessage } from "@/types";
import { sameRequestOtherPersonEnabled } from "@/lib/config/chat-quality-flags";
import { displayName, rosterNameNamedIn, type RosterEmployee } from "@/lib/forms/employee-match";

/**
 * ============================================================================
 * "DO THE SAME THING FOR <B>" / "ALSO MAKE A COACHING FORM FOR <B>"
 * ============================================================================
 *
 * SAME_REQUEST_OTHER_PERSON_ENABLED (coding 6, 10 Nov 2026; default off). With
 * <A>'s card on screen (or <A>'s form just created), the manager asked for the
 * same form for somebody else:
 *
 *   "Can you do the same thing for <B> but switch it to a written"  (sf-s11)
 *   "also make a coaching form for <B>"                              (coding3 c)
 *
 * and got <A>'s card back — the request sentence written into <A>'s
 * Observation, or a Coaching card for <A> (the form-type switch read "make …
 * coaching" as "change this to coaching" and dropped <B>).
 *
 * With the flag on, a short turn of that shape that names ONE roster person
 * other than the card's subject is read as a new request for that person:
 *
 *   "the same thing / the same one / the same form for <B>" — <A>'s request
 *   turns, <A>'s name swapped for <B>'s, the warning level switched when the
 *   turn says so ("but switch it to a written");
 *   "also make / also do / also create a <form> for <B>" — a plain request for
 *   that form for <B>, nothing of <A>'s account carried.
 *
 * The rewritten turn is answered without <A>'s card, open form or turns in
 * the history, so no reader can take <A> as the subject again. <A>'s card or
 * form is never written: this turn only ever proposes <B>'s card. PURE.
 */

const FORM = String.raw`(?:coaching(?:\s+form)?|corrective\s+action(?:\s+form)?|ca|write[- ]?up|(?:verbal|written)(?:\s+warning)?|form|one|draft)`;

/** "(do|make|create|…) the same (thing|one|form|…) for …" */
const SAME_FOR = new RegExp(
  String.raw`\b(?:do|make|create|start|draft|write|need|want|same)\b[^.?!\n]{0,30}?\bthe\s+same\s+(?:thing|one|form|draft|${FORM})?\s*(?:for|with)\b|\bsame\s+(?:thing|one)\s+for\b`,
  "i",
);
/** "also make a coaching form for …", "Now make one for …", "make one for … too" */
const ALSO_FOR = new RegExp(
  String.raw`\b(?:also|now)\s+(?:make|do|create|start|draft|write\s+up|need|want)\s+(?:a|an|one)?\s*${FORM}?\s*(?:form\s+)?for\b|\b(?:make|do|create|start|draft)\s+(?:a|an|one)\s+${FORM}?\s*(?:form\s+)?for\b[^.?!\n]{1,40}\b(?:too|as\s+well|also)\b`,
  "i",
);

/** An account of what happened: never a request for another person's form. */
const INCIDENT = /\b(?:was|were|late|tardy|absent|no[- ]?(?:call|show)|yell(?:ed|ing)?|rude|left\s+early|clocked|yesterday|last\s+(?:week|night|shift)|did\s+the\s+same\s+thing)\b/i;

const MAX_WORDS = 25;

export type SameRequestKind = "same" | "also";

export function sameRequestKind(question: string): SameRequestKind | null {
  const turn = question.trim();
  if (turn.split(/\s+/).length > MAX_WORDS || INCIDENT.test(turn)) return null;
  if (SAME_FOR.test(turn)) return "same";
  if (ALSO_FOR.test(turn)) return "also";
  return null;
}

const PRONOUN = /^(?:her|him|them|it|this|that|me|us|the|a|an|my|our|his|their|one|everyone|everybody|all|today|tomorrow|now)$/i;

/**
 * Does the turn ask for a form for somebody it names ("also make a coaching
 * form for Caspian Drummet")? A turn "for her" / "for this" names nobody.
 * PURE: the roster check is the route's (`sameRequestForOtherPerson`).
 */
export function asksForAnotherPerson(turn: string): boolean {
  if (!sameRequestKind(turn)) return false;
  const after = /\bfor\s+([A-Za-z][A-Za-z'’-]*)/g;
  for (let match = after.exec(turn); match; match = after.exec(turn)) {
    if (!PRONOUN.test(match[1]!)) return true;
  }
  return false;
}

/** The word after "for" when it is, in any case, the first name of exactly one roster person other than the card's. */
function loneFirstName(question: string, roster: readonly RosterEmployee[], subjectName: string): string | null {
  const typed = /\bfor\s+([A-Za-z][A-Za-z'’-]+)\s*[.!?]?\s*$/.exec(question.trim())?.[1];
  if (!typed || PRONOUN.test(typed)) return null;
  const matches = roster.filter(
    (person) =>
      !sameName(displayName(person), subjectName) &&
      [person.firstName, person.preferredFirstName ?? ""].some((first) => first.trim().toLowerCase() === typed.toLowerCase()),
  );
  return matches.length === 1 ? typed : null;
}

/** The warning level the turn switches to ("but switch it to a written", "make it verbal"). */
export function switchedLevel(question: string): "verbal" | "written" | null {
  const said = /\b(?:switch|change|make|turn)\s+(?:it|this|that)\s+(?:to|into)?\s*(?:a|an)?\s*(verbal|written)\b|\bbut\s+(?:as\s+)?(?:a\s+)?(verbal|written)\b|\b(verbal|written)\s+(?:warning|one|instead)\b/i.exec(question);
  const level = (said?.[1] ?? said?.[2] ?? said?.[3])?.toLowerCase();
  return level === "verbal" || level === "written" ? level : null;
}

/** The form the turn names, when it names one ("also make a coaching form for <B>"). */
export function namedTemplate(question: string): "coaching" | "dpoa" | null {
  if (/\bcoaching\b/i.test(question)) return "coaching";
  if (/\b(?:corrective\s+action|ca|write[- ]?up|verbal|written)\b/i.test(question)) return "dpoa";
  return null;
}

function escaped(word: string): string {
  return word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function words(name: string): string[] {
  return name.trim().split(/\s+/).filter(Boolean);
}

function sameName(a: string, b: string): boolean {
  return words(a.toLowerCase()).join(" ") === words(b.toLowerCase()).join(" ");
}

/** <A>'s full name, then <A>'s first name alone, swapped for <B>'s. */
export function swapPerson(text: string, from: string, to: string): string {
  const fromWords = words(from);
  const toWords = words(to);
  if (fromWords.length === 0 || toWords.length === 0) return text;
  let out = text.replace(new RegExp(`\\b${fromWords.map(escaped).join("\\s+")}\\b`, "gi"), to);
  out = out.replace(new RegExp(`\\b${escaped(fromWords[0]!)}\\b`, "gi"), toWords[0]!);
  return out;
}

function switchLevel(text: string, level: "verbal" | "written" | null): string {
  if (!level) return text;
  const other = level === "written" ? "verbal" : "written";
  const cased = (match: string) => (/^[A-Z]/.test(match) ? level[0]!.toUpperCase() + level.slice(1) : level);
  return new RegExp(`\\b${other}\\b`, "i").test(text) ? text.replace(new RegExp(`\\b${other}\\b`, "gi"), cased) : text;
}

/**
 * The card's subject: the last roster person a manager turn named (the
 * history the browser sends is text only — the card itself is never trusted
 * from it), and where that turn is.
 */
export function lastNamed(history: readonly ChatMessage[], roster: readonly RosterEmployee[]): { employeeName: string; index: number } | null {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const turn = history[index]!;
    if (turn.role !== "user" || typeof turn.content !== "string") continue;
    const named = roster.filter((person) => rosterNameNamedIn(turn.content as string, [person]) !== null);
    if (named.length === 1) return { employeeName: displayName(named[0]!), index };
    if (named.length > 1) return null;
  }
  return null;
}

/** The form the chat has open: the browser's continuation key, else the last form the replies named. */
export function openTemplate(history: readonly ChatMessage[], continueKey: string | undefined): string | null {
  if (continueKey) return continueKey;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const turn = history[index]!;
    if (turn.role !== "assistant" || typeof turn.content !== "string") continue;
    if (/\*\*Corrective Action Form\*\*/.test(turn.content)) return "dpoa";
    if (/\*\*Coaching Form\*\*/.test(turn.content)) return "coaching";
  }
  return null;
}

/**
 * <A>'s request: the manager's turns from the last one naming <A>. Turns before
 * it (a general question, another person's request) are not <A>'s account.
 */
export function requestTurnsFor(history: readonly ChatMessage[], namedAt: number): { turns: string[]; from: number } {
  const turns = history
    .slice(namedAt)
    .filter((turn) => turn.role === "user" && typeof turn.content === "string" && turn.content.trim() !== "")
    .map((turn) => String(turn.content).trim());
  return { turns, from: namedAt };
}

const KIND_WORDS = /\b(?:coaching|corrective\s+action|ca|write[- ]?up)\b/i;

function formWords(templateKey: string, level: "verbal" | "written" | null): string {
  if (templateKey === "coaching") return "coaching form";
  return level ? `${level} corrective action` : "corrective action";
}

export interface SameRequestTurn {
  /** "same": <A>'s request carried; "also": a plain request for the form. */
  kind: SameRequestKind;
  /** The turn as it is answered: a request for <B>'s form. */
  question: string;
  /** What of <A>'s request <B>'s card carries, <B>'s name in it ("same" only). */
  carried: string | null;
  /** <B>, as the roster spells them. */
  name: string;
  /** <A>, whose card or form is left as it is. */
  from: string;
  /** The history the rewritten turn is answered with: everything before <A>'s request. */
  historyBefore: number;
  /** <A>'s request turns' ids ("same" only): <B>'s draft is written from them, read with <B>'s name. */
  sourceIds: string[];
}

/**
 * The turn read as a request for <B>'s form, or null — every other turn is
 * answered as before.
 */
export function sameRequestForOtherPerson(input: {
  question: string;
  history: readonly ChatMessage[];
  roster: readonly RosterEmployee[];
  /** The browser's continuation key: the card on screen. */
  continueTemplateKey?: string;
  /** A form open in this chat (created). */
  formOpen?: boolean;
}): SameRequestTurn | null {
  const kind = sameRequestKind(input.question);
  if (!kind) return null;
  const openKey = openTemplate(input.history, input.continueTemplateKey);
  if (!openKey || (!input.continueTemplateKey && !input.formOpen)) return null;
  const subject = lastNamed(input.history, input.roster);
  if (!subject) return null;
  const others = input.roster.filter((person) => !sameName(displayName(person), subject.employeeName) && rosterNameNamedIn(input.question, [person]) !== null);
  // "Now make one for LYsandra": a lone first name, as typed, when it is one roster person's (never the card's) — the
  // name readers then ask "Is this for Lysandra Quade?" as for any first name (`lone`).
  const lone = others.length === 0 ? loneFirstName(input.question, input.roster, subject.employeeName) : null;
  if (others.length !== 1 && !lone) return null;
  if (lone) {
    const templateKey = namedTemplate(input.question.replace(/\b(?:verbal|written)\b/gi, "")) ?? openKey;
    if (kind !== "also") return null;
    return { kind, question: `create a ${formWords(templateKey, null)} for ${lone}`, carried: null, name: lone, from: subject.employeeName, historyBefore: subject.index, sourceIds: [] };
  }
  const name = displayName(others[0]!);
  const level = switchedLevel(input.question);
  const named = namedTemplate(input.question.replace(/\b(?:verbal|written)\b/gi, ""));
  const templateKey = kind === "also" ? (named ?? openKey) : named === "coaching" ? "coaching" : openKey;
  const own = requestTurnsFor(input.history, subject.index);
  if (kind === "also" || own.turns.length === 0 || templateKey !== openKey) {
    return { kind, question: `create a ${formWords(templateKey, templateKey === "dpoa" ? level : null)} for ${name}`, carried: null, name, from: subject.employeeName, historyBefore: own.from, sourceIds: [] };
  }
  const carried = switchLevel(swapPerson(own.turns.join("\n"), subject.employeeName, name), level);
  let account = carried;
  if (!KIND_WORDS.test(account)) {
    // "Odalys Frewen. Verbal Warning. Under Performance." with the form asked for in an earlier, general turn.
    const lead = new RegExp(`^\\s*${words(name).map(escaped).join("\\s+")}\\s*[.,:;-]\\s*`, "i");
    account = `I need a ${formWords(templateKey, level)} for ${name}. ${account.replace(lead, "")}`.trim();
  } else if (level && !/\b(?:verbal|written)\b/i.test(account)) {
    account = `${account}\n${level[0]!.toUpperCase()}${level.slice(1)} Warning.`;
  }
  const sourceIds = input.history
    .slice(own.from)
    .filter((turn) => turn.role === "user" && typeof turn.id === "string" && turn.id !== "")
    .map((turn) => turn.id as string);
  return { kind, question: account, carried, name, from: subject.employeeName, historyBefore: own.from, sourceIds };
}

/**
 * <B>'s card, once, with what it carries of the earlier request, so the
 * manager sees how "the same thing" was read — and that the earlier card is
 * left as it is. Only on <B>'s card; any other answer is left as it is.
 */
export function withSameRequestNote(answer: AskResponse, turn: SameRequestTurn): AskResponse {
  const card = answer.formProposal;
  if (turn.kind !== "same" || !turn.carried || !card?.employeeName || !sameName(card.employeeName, turn.name)) return answer;
  const lead = new RegExp(`^\\s*${words(turn.name).map(escaped).join("\\s+")}\\s*[.,:;-]\\s*`, "i");
  const said = turn.carried.replace(lead, "").replace(/\s*\n+\s*/g, " ").trim();
  if (!said) return answer;
  const note = `A new card for **${turn.name}**, from your earlier request: "${said}". The earlier card or form stays as it is.`;
  // The draft is written from the earlier request's turns, read with <B>'s name (`notesForOtherPerson`), and this one.
  const sources = [...turn.sourceIds.filter((id) => !card.sourceMessageIds.includes(id)), ...card.sourceMessageIds];
  return {
    ...answer,
    content: answer.content.includes(note) ? answer.content : `${note}\n\n${answer.content}`,
    formProposal: { ...card, sourceMessageIds: sources },
  };
}

/**
 * THE CONVERSATION CREATE CHECKS, READ AS THE CHAT READ IT. <B>'s card is
 * checked against the turns from the newest "the same thing for <B>" / "also
 * make a … for <B>" on: the turns before it were <A>'s request, and the chat
 * answered this one without them. Nothing stored is changed. Off: as before.
 */
export function sameRequestReadConversation<T extends { readonly role: string; readonly content: string }>(turns: T[]): T[] {
  if (!sameRequestOtherPersonEnabled()) return turns;
  let at = -1;
  turns.forEach((turn, index) => {
    if (turn.role === "user" && typeof turn.content === "string" && asksForAnotherPerson(turn.content)) at = index;
  });
  return at <= 0 ? turns : turns.slice(at);
}

/**
 * <B>'s DRAFT NOTES, READ AS THE CHAT READ THEM. The card's turns are <A>'s
 * request and "the same thing for <B> …"; the draft is written from <A>'s
 * request with <B>'s name and the level switched — never from the request
 * sentence, and never with <A> in it. Any other notes are returned as they
 * are. Off: as before.
 */
export function notesForOtherPerson(input: {
  notes: string;
  employeeName: string;
  templateKey: string;
  roster: readonly RosterEmployee[];
}): string {
  if (!sameRequestOtherPersonEnabled()) return input.notes;
  const turns = input.notes.split(/\n{2,}/).map((turn) => turn.trim()).filter(Boolean);
  const last = turns.at(-1);
  if (!last || !asksForAnotherPerson(last)) return input.notes;
  const history = turns.slice(0, -1).map((content, index) => ({ id: `n${index}`, role: "user", content }) as ChatMessage);
  const read = sameRequestForOtherPerson({ question: last, history, roster: input.roster, continueTemplateKey: input.templateKey });
  if (!read || !sameName(read.name, input.employeeName)) return input.notes;
  return read.kind === "same" ? read.question : turns.slice(0, -1).length === 0 ? input.notes : read.question;
}
