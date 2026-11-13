import "server-only";

import { z } from "zod/v4";

import type { AskResponse } from "@/lib/ai/types";
import { updateChatTrace } from "@/lib/ai/chat-trace-store";
import { cardCheckedAgainstWordsEnabled } from "@/lib/config/chat-quality-flags";
import { PRODUCTION_SALONS } from "@/data/salons";

import type { RosterEmployee } from "./employee-match";

/** A roster person as the check reads them: the name, and the job title where the directory has one. */
export type CardPerson = Pick<RosterEmployee, "firstName" | "lastName" | "preferredFirstName"> & { readonly positionName?: string | null };
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
export function accountFromWords(employee: string | null, input: CardCheckInput): string | null {
  const turns = [...input.turns].reverse();
  const naming = employee ? turns.find((turn) => fold(turn).includes(fold(employee))) : undefined;
  const turn = naming ?? turns[0] ?? "";
  const at = employee ? fold(turn).indexOf(fold(employee)) : -1;
  const after = at >= 0 ? turn.slice(at + employee!.length) : turn.replace(REQUEST_LEAD, "");
  const clauses = after
    .split(/[,;]|(?<=[.!?])\s+/)
    .map((clause) => clause.trim().replace(/^(?:and|but|because|since|as|for|cause)\s+/i, "").replace(/[.!?]+$/, "").trim())
    .filter((clause) => clause !== "" && issueProblem(clause, employee, input) === null && !REQUEST_LEAD.test(clause) && !REQUEST_FOR.test(clause));
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
      const clause = sentence.trim().replace(/[.!]+$/, "");
      if (clause === "" || !(ACCOUNT_START.test(clause) || (first !== "" && starts.test(clause)))) continue;
      if (issueProblem(clause, employee, input) !== null) continue;
      const fact = clause.replace(/^(?:and|but|plus)\s+/i, "").replace(/\b(also|too)\b\s*/gi, "").replace(/\s+/g, " ").trim();
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
      const shown = new Set(contentWords(out.content));
      const added = addedFacts("", out.formProposal!.employeeName, latest).filter((fact) => contentWords(fact).every((word) => shown.has(word)));
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
