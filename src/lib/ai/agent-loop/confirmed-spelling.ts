import { AFFIRMATIVE, readNameConfirmation } from "@/lib/forms/employee-match";
import { notAPerson } from "@/lib/forms/person-guard";
import { extractEmployeeNames, samePerson } from "@/lib/forms/proposal";

import { holdsPhrase } from "./evidence";

/**
 * ============================================================================
 * A SPELLING THE MANAGER CONFIRMED IS THAT PERSON (fix batch, item 4; c022)
 * ============================================================================
 *
 * Pau's ruling A (15 Nov 2026): a close spelling is never seated. The app asks "Did you mean **<A>**?" in fixed words
 * (`nameConfirmationQuestion`), and the manager confirms by saying yes OR by typing <A>'s full name back. In the
 * targeted re-run (c022) the full name typed back was not treated as the answer: the turn with the close spelling read
 * as another person's request, so the card lost that turn's date and account, and the chat went 4 turns without a card.
 *
 * This reads only the app's own question (its bolded names) and whether the manager's next turn is a bare yes to a
 * single name (today's `readNameConfirmation`) or holds one offered name in full, as whole words (`holdsPhrase`,
 * how evidence.ts reads quotes). No word list reads the manager's message. A reply that names somebody else confirms
 * nobody: it never holds the offered name.
 */

type Turn = { readonly role: string; readonly content: string };

/** The app's own question: the names it offered, and the name the manager had typed. */
function askedIn(content: string): { offered: string[]; typed: string } | null {
  const question = /Did you mean ((?:\*\*[^*]+\*\*(?:, | or )?)+)\?/.exec(content);
  const typed = /(?:couldn't find|a close match for) \*\*([^*]+)\*\*/.exec(content)?.[1]?.trim();
  if (!question || !typed) return null;
  return { offered: [...question[1]!.matchAll(/\*\*([^*]+)\*\*/g)].map((match) => match[1]!.trim()), typed };
}

/** One settled question: the manager's turn that answered it, the name confirmed and the spelling it replaced. */
export interface ConfirmedSpelling {
  /** The index (in the conversation given) of the manager's answering turn. */
  readonly answerIndex: number;
  /** The roster name the manager confirmed, as the app offered it. */
  readonly name: string;
  /** What the manager had typed ("Remi Calder"). */
  readonly typed: string;
  /** How: a bare yes, or the full name typed back. */
  readonly by: "yes" | "full_name";
}

/** Every "Did you mean" in this chat that the manager answered with yes or with an offered full name, oldest first. */
export function confirmedSpellings(conversation: readonly Turn[]): ConfirmedSpelling[] {
  const turns = conversation.filter((turn) => typeof turn.content === "string");
  const out: ConfirmedSpelling[] = [];
  for (let index = 1; index < turns.length; index += 1) {
    if (turns[index]!.role !== "user") continue;
    const before = turns[index - 1]!;
    if (before.role !== "assistant") continue;
    const asked = askedIn(before.content);
    if (!asked) continue;
    const yes = readNameConfirmation(turns.slice(0, index + 1));
    if (yes?.kind === "accepted" && asked.offered.some((name) => samePerson(name, yes.name))) {
      out.push({ answerIndex: index, name: yes.name, typed: asked.typed, by: "yes" });
      continue;
    }
    // The full name typed back: exactly one offered name, in full, as whole words.
    const held = asked.offered.filter((name) => name.split(/\s+/).length > 1 && holdsPhrase(turns[index]!.content, name));
    if (held.length === 1) out.push({ answerIndex: index, name: held[0]!, typed: asked.typed, by: "full_name" });
  }
  return out;
}

/** The spellings the manager confirmed as this person (any of `names`, e.g. the legal and the shown name). */
export function spellingsConfirmedFor(conversation: readonly Turn[], names: readonly string[]): string[] {
  return confirmedSpellings(conversation)
    .filter((settled) => names.some((name) => samePerson(name, settled.name)))
    .map((settled) => settled.typed);
}

/** The latest turn (the last in `conversation`) answers this chat's Did-you-mean with this person. */
export function latestTurnConfirms(conversation: readonly Turn[], names: readonly string[]): ConfirmedSpelling | null {
  const last = conversation.filter((turn) => typeof turn.content === "string").length - 1;
  return confirmedSpellings(conversation).find((settled) => settled.answerIndex === last && names.some((name) => samePerson(name, settled.name))) ?? null;
}

/**
 * Fix batch item 3 (c137): the latest turn answers this chat's own "Did you mean **<A>**?" for this person, is not a
 * yes, and names somebody else in full (a capitalised name `extractEmployeeNames` reads, or a roster person's full name
 * as whole words). That reply is not a yes: <A> is never carded from it. Null when the turn is a yes, names nobody
 * else, or answers no such question.
 */
export function answerNamesSomeoneElse(
  conversation: readonly Turn[],
  person: string,
  rosterNames: readonly string[],
): { others: string[]; typed: string } | null {
  const turns = conversation.filter((turn) => typeof turn.content === "string");
  const answer = turns[turns.length - 1];
  const before = turns[turns.length - 2];
  if (!answer || answer.role !== "user" || before?.role !== "assistant") return null;
  const asked = askedIn(before.content);
  if (!asked || !asked.offered.some((name) => samePerson(name, person))) return null;
  if (latestTurnConfirms(turns, [person])) return null;
  // A yes that goes on with the account ("yes, she was late on 11/14, <B> saw it"): its first clause is today's bare yes.
  if (AFFIRMATIVE.test(answer.content.split(/[,.;!\n]/)[0] ?? "")) return null;
  const isOffered = (name: string) => samePerson(name, person) || samePerson(name, asked.typed) || asked.offered.some((offered) => samePerson(name, offered));
  const read = extractEmployeeNames(answer.content).filter((name) => name.trim().split(/\s+/).length > 1 && !notAPerson(name));
  const onRoster = rosterNames.filter((name) => name.trim().split(/\s+/).length > 1 && holdsPhrase(answer.content, name));
  const others = [...new Set([...onRoster, ...read])].filter((name) => !isOffered(name));
  return others.length > 0 ? { others, typed: asked.typed } : null;
}
