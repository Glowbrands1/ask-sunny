import "server-only";

import { z } from "zod/v4";

import type { AskResponse } from "@/lib/ai/types";
import { updateChatTrace } from "@/lib/ai/chat-trace-store";
import { cardCheckedAgainstWordsEnabled, closeSpellingMatchEnabled } from "@/lib/config/chat-quality-flags";
import { PRODUCTION_SALONS } from "@/data/salons";

import type { RosterEmployee } from "./employee-match";

/** A roster person as the check reads them: the name, and the job title where the directory has one. */
export type CardPerson = Pick<RosterEmployee, "firstName" | "lastName" | "preferredFirstName"> & { readonly positionName?: string | null };
import { closeWordDistance } from "./close-spelling";
import { fold } from "./form-reducer";

/**
 * ============================================================================
 * THE CARD, CHECKED AGAINST THE MANAGER'S OWN WORDS (CARD_CHECKED_AGAINST_WORDS_ENABLED)
 * ============================================================================
 *
 * Pau's direction via QA (13 Nov 2026): before a card is shown, it is checked against what the manager said. Today's
 * live failures: an Issue that was a hedge about the decision ("do not terminate yet"), a job title or a warning level,
 * a salon label, or the employee's name. A person on the card who is a title or a store.
 *
 * 1. CODE CHECKS, on every card (cheap): the Issue must be an account in the manager's words; the person must not be a
 *    title or a salon.
 * 2. A failed Issue is first repaired from the manager's own clauses (the request after the employee's name, without
 *    the hedge, the level, the title or the store).
 * 3. Only when that fails, or a check is unsure: one structured model call (the patch model's client), at most two
 *    rounds. Every correction must quote the manager's words, and its words must come from that quote, or it is
 *    dropped.
 * 4. NEVER INVENTED: an Issue nothing repairs is left blank and the card asks "What happened?". A person who is a title
 *    or a store is taken off the card and it asks who it is for.
 *
 * The trace (`slots.card_check`) holds the kinds of problem, the model's calls and milliseconds, and what was repaired:
 * never text. Off, the card as built.
 */

export const CARD_CHECK_HEADING = "CARD CHECK";
/** At most this many model calls for one card. */
export const CARD_CHECK_MAX_CALLS = 2;

export type CardProblem = "issue_hedge" | "issue_title" | "issue_place" | "issue_name" | "issue_unsaid" | "issue_missing_fact" | "person_title" | "person_place";

export interface CardCheckInput {
  /** The manager's turns in this conversation, oldest first, the latest last. */
  readonly turns: readonly string[];
  readonly roster: readonly CardPerson[];
}

export type CardCheckModel = (prompt: { readonly system: string; readonly prompt: string; readonly schema: Record<string, unknown> }) => Promise<
  { readonly ok: true; readonly output: unknown } | { readonly fallback: string }
>;

const HEDGE = /\bterminat|\btermination\b|\bterm\s+(?:ca|c\/a)\b/i;
const LEVEL =
  /^(?:an?\s+)?(?:(?:verbal|written|final|first|second|last)(?:\s+(?:written\s+)?(?:warning|ca|c\/a|corrective action|write[- ]?up))?|coaching|corrective action|ca|c\/a|write[- ]?up|warning)$/i;
const REQUEST_LEAD =
  /^(?:please\s+)?(?:can you\s+|could you\s+|i need (?:you )?to\s+|i need\s+|i want to\s+|let'?s\s+)?(?:create|make|start|draft|write(?:\s+up)?|do|open|give|need|pull up|prepare)\b[^,;]*?\b(?:ca|c\/a|corrective action|coaching(?: form)?|form|write[- ]?up|warning)\b(?:\s+(?:for|on))?/i;
/** "CA for <name>", "a coaching form on <name>": a request's lead with no verb, never the account. */
const REQUEST_FOR = /^(?:\S+\s+){0,4}?(?:ca|c\/a|corrective action|coaching(?:\s+form)?|form|write[- ]?up|warning)\s+(?:for|on)\b/i;
const STOP = new Set(["the", "and", "for", "her", "his", "she", "was", "with", "that", "this", "they", "them", "has", "had", "have", "on", "at", "to", "of", "in", "a", "an", "is", "it"]);

function plain(text: string): string {
  return fold(text)
    .replace(/[^\p{L}\p{N}\s/]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function contentWords(text: string): string[] {
  return plain(text)
    .split(" ")
    .filter((word) => word.length > 2 && !STOP.has(word));
}

function storeLabels(): string[] {
  return PRODUCTION_SALONS.map((salon) => salon.name).filter((name) => name.trim() !== "");
}

function titles(roster: readonly CardPerson[]): Set<string> {
  return new Set(roster.map((person) => plain(person.positionName ?? "")).filter((title) => title !== ""));
}

function names(roster: readonly CardPerson[]): Set<string> {
  const out = new Set<string>();
  for (const person of roster) {
    out.add(plain(`${person.firstName} ${person.lastName}`));
    if (person.preferredFirstName) out.add(plain(`${person.preferredFirstName} ${person.lastName}`));
  }
  return out;
}

/** The store label the text is, or is made of (nothing else in it but punctuation), or null. */
function isPlace(text: string): boolean {
  const said = plain(text);
  if (said === "") return false;
  return storeLabels().some((label) => {
    const name = plain(label);
    return name !== "" && (said === name || (said.includes(name) && plain(said.replace(name, "")).replace(/\b(?:store|at|the|in)\b/g, "").trim() === ""));
  });
}

/** What is wrong with the card's Issue, if anything. */
export function issueProblem(issue: string, employee: string | null, input: CardCheckInput): CardProblem | null {
  const text = issue.trim();
  if (text === "") return null;
  const clauses = text.split(/[,;]/).map((clause) => clause.trim()).filter((clause) => clause !== "");
  if (clauses.length > 0 && clauses.every((clause) => HEDGE.test(clause))) return "issue_hedge";
  const said = plain(text);
  if (LEVEL.test(said) || titles(input.roster).has(said)) return "issue_title";
  if (isPlace(text)) return "issue_place";
  if ((employee && said === plain(employee)) || names(input.roster).has(said)) return "issue_name";
  const words = contentWords(text);
  const heard = new Set(contentWords(input.turns.join("\n")));
  if (words.length > 0 && words.filter((word) => heard.has(word)).length / words.length < 0.5) return "issue_unsaid";
  return null;
}

/** What is wrong with the card's person, if anything. */
export function personProblem(employee: string | null, input: CardCheckInput): CardProblem | null {
  if (!employee || employee.trim() === "") return null;
  const said = plain(employee);
  if (LEVEL.test(said) || titles(input.roster).has(said)) return "person_title";
  if (isPlace(employee)) return "person_place";
  return null;
}

/**
 * The account from the manager's own words: the turn that names the employee (else the latest), the clauses after the
 * name, without the request's lead, a hedge, a level, a title, a store or the name. Null when nothing is left.
 */
/** History or a level said with no subject: "coached her 10-16", "signed the manual 10/1", "wrote her up", "verbal on 10/1". */
const SUBJECTLESS_HISTORY =
  /^(?:(?:i|we|management|the manager)\s+)?(?:coached|counseled|counselled|disciplined|warned|documented|wrote\s+(?:her|him|them)\s+up|written\s+up|signed\s+(?:the\s+|her\s+|his\s+)?(?:[\w-]+\s+){0,2}(?:policy|policies|manual|handbook|form|acknowledg\w*|agreement|paperwork|ca|warning|coaching)|gave\s+(?:her|him|them)\s+a)\b/i;
/** A clause that is a level ("written warning on 10-20", "verbal on 10/1", "final warning"). */
const LEVEL_START = /^(?:a\s+|an\s+)?(?:verbal|written|final|first|second|last)(?:\s+(?:written\s+)?(?:warning|ca|c\/a|write[- ]?up|corrective action))?\b(?:\s+(?:on|from|in|last|this)\b.*)?$/i;

export function accountFromWords(employee: string | null, input: CardCheckInput): string | null {
  const turns = [...input.turns].reverse();
  const naming = employee ? turns.find((turn) => fold(turn).includes(fold(employee))) : undefined;
  const turn = naming ?? turns[0] ?? "";
  const at = employee ? fold(turn).indexOf(fold(employee)) : -1;
  const after = at >= 0 ? turn.slice(at + employee!.length) : turn.replace(REQUEST_LEAD, "");
  /*
   * Gate-Bubbles-5 / Gate-Sunny-2 (13 Nov 2026): the same split and filter as an added fact. "ca for <A>, coached her
   * 10-16, she was late again 10-20" repairs to "she was late again 10-20"; "…, signed the manual 10/1, late on 10/20"
   * to "late on 10/20"; "…, coached her 10-16, written warning on 10-20" to nothing (no repair, never history).
   */
  const clauses = after
    .split(/[,;]|(?<=[.!?])\s+|\s+(?:and|but)\s+(?:then\s+)?/i)
    .map((clause) => clause.trim().replace(/^(?:and|but|because|since|as|for|cause)\s+/i, "").replace(/[.!?]+$/, "").trim())
    .filter((clause) => {
      if (clause === "" || issueProblem(clause, employee, input) !== null || REQUEST_LEAD.test(clause) || REQUEST_FOR.test(clause)) return false;
      if (SUBJECTLESS_HISTORY.test(clause) || LEVEL_START.test(clause)) return false;
      const subjected = /^(?:she|he|they)\b/i.test(clause) ? clause : `she ${clause}`;
      return !isHistory(subjected) && !notAFact(subjected, input);
    });
  const account = clauses.join(", ").trim();
  return contentWords(account).length > 0 ? account : null;
}

/**
 * QA's 17r-c live test (13 Nov 2026): "create a CA for <A>, she was late on 11/3/26", then, on the open card, "she also
 * didn't call to say she'd be late": the new card's What happened was still the first fact. A fact the manager states
 * AFTER the turn that named the employee — a sentence about what the employee did ("she …", "<first name> …") that is
 * not a question, a level, a title, a store or a hedge — must be on the card. The facts the Issue does not already hold,
 * in her words ("also" dropped). An answer to the card's question ("verbal warning") is never one.
 */
/*
 * NOT A FACT (Gate-Bubbles-5 and Gate-Sunny-2 on the 17r-c fix, 13 Nov 2026): a sentence that starts like an account is
 * not one when the level, the role or title, the place or the hedge IS its predicate: "she gets a verbal warning", "she
 * is a key holder" / "she's our closing lead" / "she is a <title>", "she works at <store>" / "she is at <store label>",
 * "she maybe forgot" / "she might have forgotten". An action that merely CONTAINS such a word is a real fact and joins:
 * "she was at the register on her phone", "she yelled at the manager", "she ignored the posted warning", "she said maybe
 * and walked out", "she was a no-show on Saturday".
 */
const SUBJECT = String.raw`(?:she|he|they|[A-Z][a-z'’-]+)`;
const LEVEL_WORDS = String.raw`(?:(?:a|an|her|his|their|the)\s+)?(?:(?:verbal|written|final|first|second|last)\s+(?:written\s+)?)?(?:warning|ca|c\/a|write[- ]?up|corrective action)s?`;
const GETS_LEVEL = new RegExp(String.raw`^${SUBJECT}\s+(?:gets?|got|getting|will get|should get|is getting|receives?|received|deserves?)\s+${LEVEL_WORDS}\b`, "i");
const GIVE_LEVEL = new RegExp(String.raw`\b(?:give|gave|giving|issue|issued)\s+(?:her|him|them)\s+${LEVEL_WORDS}\b`, "i");
const IDENTITY_OF = new RegExp(String.raw`^${SUBJECT}(?:\s+(?:is|was|are|were)|'s|’s)\s+(?:a|an|our|the|my|their)\s+(.+)$`, "i");
const AT_PLACE = new RegExp(String.raw`^${SUBJECT}\s+(?:works?|worked|working|is based|was based|is stationed|is assigned|was assigned)\s+(?:at|in|out of)\s+(.+)$`, "i");
const IS_AT = new RegExp(String.raw`^${SUBJECT}(?:\s+(?:is|was)|'s|’s)\s+(?:at|in)\s+(.+)$`, "i");
const HEDGED_VERB = new RegExp(String.raw`^${SUBJECT}\s+(?:maybe|probably|possibly|perhaps|might|may|must have|could have)\b`, "i");
const ROLE = /\b(?:key\s*holders?|keyholders?|managers?|leads?|supervisors?)\b/i;
const STREET_SUFFIX = /\b(?:rd|road|st|street|ave|avenue|blvd|boulevard|dr|drive|pkwy|parkway|ln|lane|hwy|highway)\.?$/i;

function placeWords(): string[] {
  const out = new Set<string>();
  for (const label of storeLabels()) {
    for (const part of label.split(/[,()]/)) {
      const word = plain(part).replace(STREET_SUFFIX, "").trim();
      if (word.length >= 4 && !/^[a-z]{2}$/.test(word)) out.add(word);
      // Each word of a label part too ("NE Kearney" → "kearney"), for "she is at the Kearney salon".
      for (const piece of word.split(" ")) if (piece.length >= 4) out.add(piece);
    }
  }
  return [...out];
}

/** The text is only a place: a store or salon label, or its city or street, with nothing else said. */
function onlyPlace(text: string): boolean {
  if (isPlace(text)) return true;
  let rest = ` ${plain(text)} `;
  for (const word of placeWords()) rest = rest.replace(` ${word} `, " ");
  rest = rest.replace(/\b(?:the|our|my|a|store|salon|location|shop|ne|ks|mo|ia|co)\b/g, " ").trim();
  /*
   * CLOSE_SPELLING_MATCH_ENABLED (QA, 13 Nov 2026): "she is at Lincon Pine Lake" — a place one letter off is still only a
   * place. The words left are read with the same close-spelling reader as the salon reader (`close-spelling.ts`).
   */
  if (rest !== "" && closeSpellingMatchEnabled()) {
    const known = [...new Set(placeWords().flatMap((place) => place.split(" ")).filter((word) => word.length >= 4))];
    rest = rest
      .split(/\s+/)
      .filter((word) => !(word.length >= 4 && known.some((place) => closeWordDistance(word, place) !== null)))
      .join(" ")
      .trim();
  }
  return rest === "" && plain(text) !== "";
}

/** Who she is: a role word, a roster title, or a role with a modifier ("closing lead"), and nothing else. */
function onlyRole(text: string, input: CardCheckInput): boolean {
  const said = plain(text);
  if (titles(input.roster).has(said)) return true;
  const words = said.split(" ");
  return ROLE.test(said) && words.length <= 3;
}

/*
 * PRIOR HISTORY (Gate-Bubbles-5's full-pack join scan, 13 Nov 2026): a sentence about an earlier step is not this
 * incident; it belongs in prior actions, never in What happened or the Observation. "<name> signed the jba policy manual
 * on 10-15-26", "he already had a CA on 10/14 for being late", "she had a verbal warning on 10/1".
 */
const PRIOR_STEP = new RegExp(
  String.raw`\b(?:already\s+(?:had|got|has|received|signed)|(?:had|has had|has|received|got|was given|were given)\s+(?:a|an|her|his|their|the)?\s*(?:prior\s+|previous\s+|earlier\s+)?(?:(?:verbal|written|final|first|second|last)\s+)?(?:warning|ca|c\/a|coaching|write[- ]?up|corrective action)s?\b|\bsigned\s+(?:off\s+on\s+)?(?:(?:the|her|his|their|a|an|our)\s+)?(?:[\w-]+\s+){0,3}(?:policy|policies|manual|handbook|form|acknowledg\w*|agreement|document|paperwork|ca|c\/a|write[- ]?up|warning|coaching)s?\b)`,
  "i",
);

/** "she was coached on this on 10/20", "she was written up": an earlier step done to her (Gate-Sunny-2, 13 Nov 2026). */
const WAS_DISCIPLINED = /\b(?:was|were|has been|had been|got|already been)\s+(?:coached|written up|wrote up|counseled|counselled|disciplined|documented)\b/i;
/** "she was given a … on 10/1", "was warned on 10/1": a step given to her on a date. */
const DATED_GIVEN = /\b(?:was|were|got|had been)\s+(?:given|issued|handed|warned)\b[^.;]*\bon\s+(?:\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?|(?:mon|tues|wednes|thurs|fri|satur|sun)day|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i;

/** An earlier step: a signed policy or form, "already had …", a past warning, coaching or write-up. */
export function isHistory(text: string): boolean {
  return PRIOR_STEP.test(text) || WAS_DISCIPLINED.test(text) || DATED_GIVEN.test(text);
}

/*
 * A PAYROLL OR DEDUCTION AMOUNT (Gate-Sunny-2, 13 Nov 2026): "she owes $25 for the late opening", "deduct $40 from her
 * check", "she'll pay back $20", "payroll deduct yes, $15" is the form's payroll answer, never what she did. "she took
 * $20 from the drawer" and "she was short $20" are what she did, and join.
 */
const MONEY = /(?:\$\s?\d|\b\d+(?:\.\d{2})?\s*(?:dollars?|bucks)\b)/i;
const OWED = /\b(?:(?:has|have|had|needs?|must|got|gotta)\s+(?:to\s+)?pay(?:\s+back)?|must\s+pay|(?:will|is|was|'s|’s)\s+(?:be(?:ing)?\s+)?charged|(?:we|we're|we’re|we\s+are|i'm|i’m|i\s+am)\s+(?:charging|charge)\s+(?:her|him|them)|charging\s+(?:her|him|them)|take\s+(?:it|that|this)\s+out\s+of\s+(?:her|his|their)\s+(?:check|pay(?:check)?)|owes?|owed|owing|pay(?:s|ing)?\s+(?:it\s+)?back|paid\s+back|repay|reimburse|deduct(?:ed|ion|ing)?|payroll|charge(?:d)?\s+(?:her|him|them)|(?:take|taken|took)\s+(?:it\s+)?out\s+of\s+(?:her|his|their)\s+(?:check|pay))\b/i;

export function notAFact(clause: string, input: CardCheckInput): boolean {
  const text = clause.trim();
  if (MONEY.test(text) && OWED.test(text)) return true;
  if (isHistory(text)) return true;
  if (GETS_LEVEL.test(text) || GIVE_LEVEL.test(text) || HEDGED_VERB.test(text)) return true;
  const identity = IDENTITY_OF.exec(text)?.[1];
  if (identity && (onlyRole(identity, input) || onlyPlace(identity))) return true;
  const works = AT_PLACE.exec(text)?.[1];
  if (works) return true;
  const at = IS_AT.exec(text)?.[1];
  return at !== undefined && onlyPlace(at);
}

/*
 * NOT AN ADDED DETAIL (Gate-Bubbles-5 / Gate-Sunny-2, 13 Nov 2026):
 * - a name answer: the employee's name alone, or with only her title, position or place ("Tessa Ormond, General
 *   Manager", "Tessa Ormond - Team Member", "<name>, <title>");
 * - a new request: "<she|name> (also) needs|should get|gets|deserves … a <level>|CA|coaching|form …" ("jordan testperson
 *   needs a written warning for cash handling", "she also needs a CA for being late on 11/4").
 */
const REQUEST_SHAPE = new RegExp(
  String.raw`^(?:she|he|they|[\p{L}'’-]+(?:\s+[\p{L}'’-]+)?)\s+(?:also\s+)?(?:needs?|should\s+(?:get|have|receive)|gets?|getting|deserves?|will\s+get|is\s+getting|requires?|must\s+get)\s+(?:(?:a|an|another|her|his|their|the)\s+)?(?:(?:verbal|written|final|first|second|last)\s+)?(?:warning|ca|c\/a|corrective\s+action|coaching(?:\s+form)?|form|write[- ]?up|counseling)\b`,
  "iu",
);
const TITLE_WORDS = new Set([
  "manager", "managers", "member", "members", "team", "general", "assistant", "associate", "consultant", "director", "lead", "supervisor",
  "part", "time", "full", "shift", "key", "holder", "keyholder", "crew", "staff", "employee", "our", "a", "an", "the", "at", "is", "she", "store", "salon",
]);

/** The employee's name (or another roster name) with nothing after it but a title, position or place. */
function nameAnswer(clause: string, employee: string | null, input: CardCheckInput): boolean {
  const said = plain(clause);
  const known = [employee ? plain(employee) : "", ...names(input.roster)].filter((name) => name !== "");
  const name = known.find((candidate) => said === candidate || said.startsWith(`${candidate} `));
  if (!name) return false;
  const rest = said.slice(name.length).trim();
  if (rest === "") return true;
  const titleWords = new Set([...titles(input.roster)].flatMap((title) => title.split(" ")));
  const places = new Set(placeWords().flatMap((place) => place.split(" ")));
  return rest.split(" ").every((word) => TITLE_WORDS.has(word) || titleWords.has(word) || places.has(word));
}

/** A leading time or place phrase before the account: "on Saturday, ", "yesterday ", "at close ", "this morning ". */
const TIME_LEAD =
  /^(?:(?:on\s+(?:(?:mon|tues|wednes|thurs|fri|satur|sun)day|\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?)(?:\s+(?:morning|afternoon|evening|night))?)|yesterday(?:\s+(?:morning|afternoon|evening))?|today|tonight|last\s+night|this\s+(?:morning|afternoon|evening)|earlier\s+today|at\s+(?:close|closing|open|opening)|(?:at|around|about|by)\s+\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)?|then|after\s+that|later(?:\s+on)?|afterwards?)\s*,?\s+/i;
const ACCOUNT_START = /^(?:and\s+|but\s+|plus\s+)?(?:she|he|they)\b/i;
export function addedFacts(issue: string, employee: string | null, input: CardCheckInput): string[] {
  if (!employee) return [];
  const named = input.turns.findIndex((turn) => fold(turn).includes(fold(employee)));
  if (named < 0) return [];
  const first = employee.trim().split(/\s+/)[0] ?? "";
  const starts = new RegExp(`^(?:and\\s+|but\\s+|plus\\s+)?${first.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
  const have = new Set(contentWords(issue));
  const out: string[] = [];
  for (const turn of input.turns.slice(named + 1)) {
    if (/\?\s*$/.test(turn.trim())) continue;
    for (const sentence of turn.split(/(?<=[.!?])\s+|\n+/)) {
      let clause = sentence.trim().replace(/[.!]+$/, "");
      // QA (13 Nov 2026): "on Saturday, she left …", "yesterday she left early", "at close she skipped the deposit": a
      // leading time or place phrase is set aside for the start test and kept in the joined text.
      const timeLead = TIME_LEAD.exec(clause)?.[0] ?? "";
      clause = clause.slice(timeLead.length);
      if (clause === "" || !(ACCOUNT_START.test(clause) || (first !== "" && starts.test(clause)))) continue;
      /*
       * Gate-Sunny-2 / QA (13 Nov 2026): a sentence joined by "and"/"but" can hold a fact AND something that is not one
       * ("she had a CA last week and was late again today", "she yelled at a client and she gets a verbal warning", "she
       * was late and she's a key holder"). Every part goes through the same checks, with her subject where it has none;
       * only the fact parts join ("she was late again today", "she yelled at a client", "she was late").
       */
      // "and"/"but", or a comma that starts a new clause with her subject ("…dirty, she is a <title>").
      const nameStart = first !== "" ? `|${first.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}` : "";
      const parts = clause.split(new RegExp(String.raw`\s+(?:and|but)\s+(?:then\s+)?|,\s+(?=(?:she|he|they${nameStart})\b)`, "i"));
      if (parts.length > 1) {
        const subject = clause.split(/\s+/)[0] ?? "";
        const own = (part: string) => ACCOUNT_START.test(part) || (first !== "" && starts.test(part));
        const whole = (part: string) => (own(part) ? part : `${subject} ${part}`);
        const kept = parts.filter((part) => issueProblem(whole(part), employee, input) === null && !notAFact(whole(part), input) && !REQUEST_SHAPE.test(whole(part)));
        if (kept.length === 0) continue;
        if (kept.length < parts.length) clause = [whole(kept[0]!), ...kept.slice(1)].join(" and ");
      }
      if (issueProblem(clause, employee, input) !== null || notAFact(clause, input) || REQUEST_SHAPE.test(clause) || nameAnswer(clause, employee, input)) continue;
      const fact = `${timeLead}${clause.replace(/^(?:and|but|plus)\s+/i, "")}`.replace(/\b(also|too)\b\s*/gi, "").replace(/\s+/g, " ").trim();
      const words = contentWords(fact);
      if (words.length === 0 || words.every((word) => have.has(word))) continue;
      out.push(fact);
      for (const word of words) have.add(word);
    }
  }
  return out;
}

const ISSUE_SEGMENT = /(\*\*Issue:\*\*\s*)([^·\n]+?)(\s*(?:·|\n|$))/;
const WHAT_HAPPENED = "What happened? Tell me in a sentence and I'll put it on the card.";
const WHO_FOR = "Who is this card for? Tell me their name and I'll put them on it.";

function withIssue(answer: AskResponse, issue: string | null): AskResponse {
  const card = answer.formProposal!;
  if (issue !== null) {
    const content = ISSUE_SEGMENT.test(answer.content)
      ? answer.content.replace(ISSUE_SEGMENT, (_all, lead: string, _old: string, tail: string) => `${lead}${issue}${tail}`)
      : answer.content;
    return { ...answer, content, formProposal: { ...card, issue } };
  }
  // Never a guess: the Issue is blank, and the card asks what happened.
  const content = answer.content
    .replace(/\*\*Issue:\*\*\s*[^·\n]+?\s*·\s*/, "")
    .replace(/\s*·\s*\*\*Issue:\*\*\s*[^·\n]+/, "")
    .replace(/\*\*Issue:\*\*\s*[^·\n]+/, "")
    .trimEnd();
  return { ...answer, content: `${content}\n\n${WHAT_HAPPENED}`, formProposal: { ...card, issue: null } };
}

const outputSchema = z
  .object({
    issue: z.object({ value: z.string().max(400), quote: z.string().min(1).max(600) }).strict().nullable(),
  })
  .strict();

const SYSTEM = [
  "You check a form card against what a manager said, before it is shown. You never invent.",
  "The card's Issue must be what happened (an account of the employee's action or event), in the manager's own words.",
  "It is never a decision about the employee (\"do not terminate yet\"), a warning level, a job title, a store, or a name.",
  "Answer with the Issue as the manager said it, and the exact words you took it from (quote, copied from the manager's messages).",
  "If the manager never said what happened, answer issue: null.",
].join("\n");

function promptFor(card: { readonly issue: string; readonly employee: string | null }, problem: CardProblem, input: CardCheckInput, round: number): string {
  return [
    CARD_CHECK_HEADING,
    `EMPLOYEE ON THE CARD: ${card.employee ?? "(none)"}`,
    `ISSUE ON THE CARD: ${card.issue}`,
    `WHAT IS WRONG WITH IT: ${problem.replace(/_/g, " ")}`,
    ...(round > 1 ? ["Your last answer did not pass the same check: it must be what happened, in the manager's words."] : []),
    "THE MANAGER'S MESSAGES (oldest first):",
    ...input.turns.map((turn) => `MANAGER: ${turn.trim()}`),
  ].join("\n");
}

/** A model correction stands only when its quote is the manager's and its words come from that quote. */
function quoted(value: string, quote: string, input: CardCheckInput): boolean {
  const words = fold(input.turns.join("\n"));
  if (!words.includes(fold(quote).trim())) return false;
  const from = new Set(contentWords(quote));
  const own = contentWords(value);
  return own.length > 0 && own.filter((word) => from.has(word)).length / own.length >= 0.8;
}

export interface CardCheckTrace {
  checked: boolean;
  problems: CardProblem[];
  model_calls: number;
  model_ms: number;
  repaired: ("issue_from_words" | "issue_from_model" | "issue_blank" | "person_removed" | "issue_added_fact")[];
}

/** The card checked against the manager's words. Off, or with no card, the answer as built. Never throws. */
export async function withCardCheckedAgainstWords(answer: AskResponse, input: CardCheckInput, model: CardCheckModel): Promise<AskResponse> {
  if (!cardCheckedAgainstWordsEnabled()) return answer;
  const card = answer.formProposal;
  if (!card) return answer;
  const trace: CardCheckTrace = { checked: true, problems: [], model_calls: 0, model_ms: 0, repaired: [] };
  let out = answer;
  try {
    /* The person: a title or a store is never the person on the card. */
    const person = personProblem(card.employeeName, input);
    if (person) {
      trace.problems.push(person);
      trace.repaired.push("person_removed");
      out = {
        ...out,
        content: `${out.content.trimEnd()}\n\n${WHO_FOR}`,
        formProposal: { ...out.formProposal!, employeeName: null, status: "needs_employee" },
      };
    }
    /* The Issue: an account in the manager's words. */
    const issue = out.formProposal!.issue?.trim() ?? "";
    const employee = out.formProposal!.employeeName;
    const problem = issue === "" ? null : issueProblem(issue, employee, input);
    if (problem) {
      trace.problems.push(problem);
      const fromWords = problem === "issue_unsaid" ? null : accountFromWords(employee, input);
      if (fromWords) {
        trace.repaired.push("issue_from_words");
        out = withIssue(out, fromWords);
      } else {
        let fixed: string | null = null;
        for (let round = 1; round <= CARD_CHECK_MAX_CALLS && fixed === null; round += 1) {
          const started = Date.now();
          const called = await model({ system: SYSTEM, prompt: promptFor({ issue, employee }, problem, input, round), schema: z.toJSONSchema(outputSchema) as Record<string, unknown> });
          trace.model_calls += 1;
          trace.model_ms += Date.now() - started;
          if (!("ok" in called)) break;
          const parsed = outputSchema.safeParse(called.output);
          if (!parsed.success) continue;
          const said = parsed.data.issue;
          if (said === null) break;
          if (quoted(said.value, said.quote, input) && issueProblem(said.value, employee, input) === null) fixed = said.value.trim();
        }
        if (fixed !== null) {
          trace.repaired.push("issue_from_model");
          out = withIssue(out, fixed);
        } else if (problem !== "issue_unsaid") {
          // A hedge, a level, a title, a store or a name is never the Issue: blank, and asked.
          trace.repaired.push("issue_blank");
          out = withIssue(out, null);
        }
        // "issue_unsaid" with no quoted correction: the card's own Issue stays (it may be the reader's summary).
      }
    }
    /* A fact the manager added while the card was open is on it, and the reply says so. */
    const now = out.formProposal!.issue?.trim() ?? "";
    if (now !== "") {
      const added = addedFacts(now, out.formProposal!.employeeName, input);
      if (added.length > 0) {
        trace.problems.push("issue_missing_fact");
        trace.repaired.push("issue_added_fact");
        const issue = [now, ...added].join("; ");
        const withAdded = withIssue(out, issue);
        out = { ...withAdded, content: `${withAdded.content.trimEnd()}\n\n**Added to What happened:** ${added.join("; ")}` };
      }
    } else if (out.formProposal!.issue === undefined && input.turns.length > 1) {
      /*
       * This app's card has no Issue: the account is its Observation of Offense, which already keeps an added fact. The
       * reply repeated the whole draft and never said what changed. A fact the LATEST turn adds, that the card shows, is
       * named.
       */
      const latest = { ...input, turns: [...input.turns.slice(0, -1).filter((turn) => out.formProposal!.employeeName && fold(turn).includes(fold(out.formProposal!.employeeName))).slice(0, 1), input.turns.at(-1)!] };
      // Gate-Sunny-2: only what the card's Observation of Offense says counts as shown, never the rest of the reply.
      const observation = out.content.split("\n").find((line) => line.startsWith("**Observation of Offense:**")) ?? "";
      const shown = new Set(contentWords(observation.replace("**Observation of Offense:**", "")));
      /*
       * QA / Gate-Sunny-2 (13 Nov 2026): a first account is never "Added". When the request turn was only the request
       * ("make a written CA for <name>", or "corrective action" then "<name>"), the next turn IS the account the card is
       * built from. An addition is named only when an earlier turn, from the one that named her, already gave an account;
       * and what those turns said is no addition ("she was late" again).
       */
      const employee = out.formProposal!.employeeName;
      const namedAt = employee ? input.turns.findIndex((turn) => fold(turn).includes(fold(employee))) : -1;
      const earlier = namedAt >= 0 ? input.turns.slice(namedAt, -1) : [];
      // "make a written CA for <name> on performance": a topic ("performance") is no account; an account says something happened.
      const hadAccount = earlier.some((turn) => contentWords(accountFromWords(employee, { ...input, turns: [turn] }) ?? "").length >= 2);
      const said = earlier.join("\n");
      const added = hadAccount
        ? addedFacts(said, employee, latest).filter((fact) => contentWords(fact).every((word) => shown.has(word)))
        : [];
      if (added.length > 0) {
        trace.repaired.push("issue_added_fact");
        out = { ...out, content: `${out.content.trimEnd()}\n\n**Added to the Observation of Offense:** ${added.join("; ")}` };
      }
    }
  } catch {
    out = answer;
  }
  updateChatTrace({ cardCheck: trace as unknown as Record<string, unknown> });
  if (trace.problems.length > 0) console.info(JSON.stringify({ event: "card_check", ...trace }));
  return out;
}
