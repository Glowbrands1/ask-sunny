import "server-only";

import { MEMORY_SECTION } from "@/lib/ai/prompts";
import { CROSS_CHAT_RECORDS_NOTE, isBareNameTurn } from "@/lib/chat/cross-chat-guard";
import { businessToday } from "@/lib/business-date";
import { NOT_A_NAME, NOT_A_TYPED_NAME, TYPED_NAME_WORD } from "@/lib/forms/name-words";
import { readEmployeeMentions, samePerson } from "@/lib/forms/proposal";
import { isFormVocabulary } from "@/lib/forms/template-intent";

/**
 * ============================================================================
 * WHAT SUNNY REMEMBERS ABOUT THE PEOPLE A MANAGER HAS TOLD IT ABOUT
 * ============================================================================
 *
 * A manager tells Sunny about Sarah on Monday — late three times, a coaching
 * form, a follow-up planned for Friday — and on Friday opens a NEW conversation
 * to ask what to do next. Without this the model starts from nothing and the
 * manager types the whole story again. With it, the turn carries a short brief
 * of what that same manager said about Sarah before.
 *
 * THE MEMORY IS THE ACCOUNT'S OWN CHAT HISTORY, NOT A SECOND STORE. Nothing new
 * is written anywhere. That is deliberate, and it is what keeps every promise
 * the History panel already makes true without a word changing:
 *
 *   PRIVATE TO THE ACCOUNT   only the asking person's own conversations and the
 *                            forms they themselves created are read
 *   DELETE MEANS FORGET      a deleted conversation is a tombstone, and a
 *                            tombstone is never recalled
 *   CLEAR MEANS FORGET       nothing created at or before the account's clear
 *                            boundary is recalled
 *
 * THE MANAGER'S WORDS ONLY. Sunny's own earlier answers are advice, not facts
 * about a person, and recalling them would let one confident answer harden
 * into "what we know about Sarah". Only the manager's turns are quoted.
 *
 * WHO A TURN IS ABOUT IS READ THE WAY THE FORMS PATH READS IT. Names come from
 * `readEmployeeMentions` — the one reader of a sentence the form proposals go
 * through — so "Create a coaching form" never makes somebody called Create,
 * and the two paths cannot disagree about who a manager named.
 *
 * This file is pure: no I/O. `person-memory-store.ts` reads the rows.
 */

/** People recalled on one turn. A brief, not a dossier. */
export const MAX_PEOPLE = 3;
/** Earlier conversations quoted for one person, most recent first. */
export const MAX_CONVERSATIONS_PER_PERSON = 2;
/** Characters of the manager's own words quoted from one earlier conversation. */
export const MAX_EXCERPT_CHARS = 1_400;
/** Characters kept from any single earlier turn. */
export const MAX_TURN_CHARS = 500;
/** Forms listed for one person, most recent first. */
export const MAX_FORMS_PER_PERSON = 5;

/**
 * A person this turn may be about.
 *
 * `confirmed` is whether the turn named them ON PURPOSE — a full name, "about
 * Sarah", "for Sarah" — as `readEmployeeMentions` reads it. An unconfirmed name
 * is a lone capitalised word ("Sarah was late again"), which could as easily be
 * a product or a place; it is recalled only where the earlier conversation, or
 * a form, says it is a person.
 */
export interface PersonCandidate {
  readonly name: string;
  readonly confirmed: boolean;
  /**
   * Set only with CROSS_CHAT_REPLY_GUARD_ENABLED: every turn this name was read
   * from is nothing but the name ("asdasd"), so the roster has to say it is a
   * person before anything is recalled for it.
   */
  readonly bareTurnOnly?: boolean;
}

/** One of the manager's own earlier turns. */
export interface RememberedTurn {
  readonly content: string;
  readonly createdAt: string;
}

export interface RememberedConversation {
  readonly title: string;
  /** The manager's own turns, in the order they were written. */
  readonly turns: readonly RememberedTurn[];
}

export interface RememberedForm {
  readonly employeeName: string;
  readonly templateName: string;
  readonly formDate: string | null;
  readonly status: string;
}

export interface PersonRecollection {
  readonly name: string;
  readonly conversations: readonly { title: string; date: string; excerpt: string[] }[];
  readonly forms: readonly RememberedForm[];
}

/*
 * Capitalised words that open a question far more often than they name
 * anybody. Not a correctness list — an unconfirmed name is still checked
 * against what the manager said before — only a way to not spend a query on
 * "Should" or "Can".
 */
const NOT_A_LONE_NAME = new Set([
  "can", "could", "should", "would", "will", "shall", "may", "might", "must",
  "what", "when", "where", "why", "how", "who", "which", "is", "are", "was",
  "were", "do", "does", "did", "has", "have", "had", "hi", "hello", "hey",
  "thanks", "thank", "please", "ok", "okay", "yes", "yeah", "sure", "also",
  "just", "so", "and", "but", "if", "after", "before", "create", "write",
  "draft", "make", "help", "give", "tell", "show", "explain", "list", "send",
  "start", "find", "check", "need", "want", "let", "lets", "im", "ive", "id",
  "my", "our", "we", "there", "here", "this", "that", "sunny", "ask", "last",
  "next", "new", "any", "every", "all", "some", "one", "january", "february",
  "march", "april", "june", "july", "august", "september", "october",
  "november", "december", "spa", "tan", "tanning", "salon", "store", "team",
]);

/** The first word of a name, lower-cased, without a possessive. */
function firstWordOf(name: string): string {
  return (name.trim().split(/\s+/)[0] ?? "").toLowerCase().replace(/['’]s$/, "");
}

/** The words of a sentence, lower-cased, possessives dropped. */
function wordsOf(text: string): string[] {
  return text
    .split(/[^A-Za-z'’-]+/)
    .map((word) => word.toLowerCase().replace(/['’]s$/, "").replace(/^['’-]+|['’-]+$/g, ""))
    .filter(Boolean);
}

/** Whether `text` mentions the first word of `name` as a whole word, in any case. */
export function mentionsPerson(text: string, name: string): boolean {
  const first = firstWordOf(name);
  return first.length > 0 && wordsOf(text).includes(first);
}

/** Lone capitalised words that could be a first name. */
function loneCapitalisedNames(text: string): string[] {
  const found: string[] = [];
  for (const raw of text.split(/[^A-Za-z'’-]+/)) {
    const word = raw.replace(/['’]s$/, "").replace(/^['’-]+|['’-]+$/g, "");
    if (word.length < 2 || !/^[A-Z][a-z]/.test(word) || !TYPED_NAME_WORD.test(word)) continue;
    const lower = word.toLowerCase();
    if (
      NOT_A_NAME.has(lower) ||
      NOT_A_TYPED_NAME.has(lower) ||
      NOT_A_LONE_NAME.has(lower) ||
      isFormVocabulary(lower)
    ) {
      continue;
    }
    found.push(word);
  }
  return found;
}

/**
 * Who this turn may be about, most direct first: the people the question names
 * on purpose, then lone capitalised words in the question, then the people the
 * conversation so far named — which is what lets "what should I do about her
 * now?" recall the Sarah from three turns up.
 *
 * The manager's own name is never a candidate; a manager signing a message is
 * not asking about themselves.
 */
export function namesToRecall(input: {
  question: string;
  history: readonly { role: string; content: string }[];
  userName?: string | null;
  /** CROSS_CHAT_REPLY_GUARD_ENABLED: mark names read only from a bare turn. */
  crossChatGuard?: boolean;
}): PersonCandidate[] {
  const candidates: PersonCandidate[] = [];
  const self = input.userName && input.userName !== "Manager" ? input.userName : null;
  const guard = input.crossChatGuard === true;

  const add = (name: string, confirmed: boolean, from?: string) => {
    const clean = name.trim();
    if (!clean || !TYPED_NAME_WORD.test(firstWordOf(clean))) return;
    if (self && samePerson(self, clean)) return;
    const bareTurn = guard && from !== undefined && isBareNameTurn(from, clean);
    const index = candidates.findIndex((existing) => samePerson(existing.name, clean));
    if (index === -1) {
      candidates.push(guard ? { name: clean, confirmed, bareTurnOnly: bareTurn } : { name: clean, confirmed });
      return;
    }
    const existing = candidates[index]!;
    // Keep the fuller spelling and the stronger reading of the two.
    const fuller = clean.split(/\s+/).length > existing.name.split(/\s+/).length ? clean : existing.name;
    candidates[index] = guard
      ? {
          name: fuller,
          confirmed: existing.confirmed || confirmed,
          bareTurnOnly: Boolean(existing.bareTurnOnly) && bareTurn,
        }
      : { name: fuller, confirmed: existing.confirmed || confirmed };
  };

  for (const name of readEmployeeMentions(input.question).names) add(name, true, input.question);
  for (const name of loneCapitalisedNames(input.question)) {
    // "Avery" in "Jordan Avery" is the surname of somebody already found.
    const partOfAName = candidates.some((existing) =>
      wordsOf(existing.name).includes(name.toLowerCase()),
    );
    if (!partOfAName) add(name, false, input.question);
  }

  const earlierTurns = input.history.filter((turn) => turn.role === "user").reverse();
  for (const turn of earlierTurns) {
    for (const name of readEmployeeMentions(turn.content).names) add(name, true, turn.content);
  }

  return candidates.slice(0, MAX_PEOPLE);
}

/**
 * Whether an earlier conversation is about this person.
 *
 * It has to mention them. And where it names somebody with the same first name
 * on purpose, that has to BE them: an earlier "coaching form for Sarah Miller"
 * is not about Sarah Test, and recalling it would put one employee's history
 * on another's. An unconfirmed name needs the earlier conversation to have
 * named that person on purpose, or `formConfirmed` — a form filed about them.
 */
export function isAboutPerson(
  person: PersonCandidate,
  turns: readonly RememberedTurn[],
  formConfirmed = false,
): boolean {
  if (!turns.some((turn) => mentionsPerson(turn.content, person.name))) return false;

  const first = firstWordOf(person.name);
  const named = turns
    .flatMap((turn) => readEmployeeMentions(turn.content).names)
    .filter((name) => firstWordOf(name) === first);
  const namedThem = named.some((name) => samePerson(name, person.name));

  if (named.length > 0 && !namedThem) return false;
  return person.confirmed || formConfirmed || namedThem;
}

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}

/**
 * The manager's own words from an earlier conversation, starting where they
 * first mentioned the person — "Create a coaching form" two turns before the
 * name says nothing about anybody — and carrying on until the budget is spent,
 * because "She said her car broke down" never repeats the name it is about.
 */
export function excerptFor(person: PersonCandidate, turns: readonly RememberedTurn[]): string[] {
  const start = turns.findIndex((turn) => mentionsPerson(turn.content, person.name));
  if (start === -1) return [];

  const excerpt: string[] = [];
  let used = 0;
  for (const turn of turns.slice(start)) {
    const line = clip(turn.content, MAX_TURN_CHARS);
    if (!line) continue;
    if (excerpt.length > 0 && used + line.length > MAX_EXCERPT_CHARS) break;
    excerpt.push(line);
    used += line.length;
  }
  return excerpt;
}

/** The business day an ISO instant fell on, or null for an unreadable one. */
export function rememberedDate(iso: string): string | null {
  const instant = new Date(iso);
  return Number.isNaN(instant.getTime()) ? null : businessToday(instant);
}

const STATUS_WORDS: Record<string, string> = {
  draft: "draft, not finalized",
  finalized: "finalized",
};

/**
 * The block the model reads, or null when there is nothing to recall.
 *
 * It says plainly what it is — the manager's own account, at the time — so it
 * cannot be read as a verified record, an HR file or company policy.
 */
export function renderMemoryBlock(
  recollections: readonly PersonRecollection[],
  userName: string,
  options: { crossChatGuard?: boolean } = {},
): string | null {
  const people = recollections.filter(
    (person) => person.conversations.length > 0 || person.forms.length > 0,
  );
  if (people.length === 0) return null;

  const sections = people.map((person) => {
    const lines: string[] = [`ABOUT ${person.name.toUpperCase()}`];

    for (const conversation of person.conversations) {
      lines.push(
        "",
        `Earlier conversation, ${conversation.date} — "${clip(conversation.title, 80)}". The manager wrote:`,
        ...conversation.excerpt.map((line) => `> ${line}`),
      );
    }

    if (person.forms.length > 0) {
      lines.push("", `Forms ${userName} created in Ask Sunny about ${person.name}:`);
      for (const form of person.forms) {
        const dated = form.formDate ? `dated ${form.formDate}` : "undated";
        const status = STATUS_WORDS[form.status] ?? form.status;
        lines.push(`- ${form.templateName} for ${form.employeeName} — ${dated}, ${status}`);
      }
    }

    return lines.join("\n");
  });

  const recordsNote = options.crossChatGuard ? `\n\n${CROSS_CHAT_RECORDS_NOTE}` : "";
  return `${MEMORY_SECTION}${recordsNote}

From ${userName}'s own earlier Ask Sunny conversations, and the forms they created, about people named in this conversation. This is what the manager said at the time: their account, not a verified record and not company policy. Nobody else's history is included.

${sections.join("\n\n")}`;
}
