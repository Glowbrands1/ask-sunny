import "server-only";

import { partialNameLooseMatchEnabled } from "@/lib/config/chat-quality-flags";
import { displayName } from "@/lib/forms/employee-match";
import { loadScopedRoster } from "@/lib/forms/employee-roster";
import type { AccessScope } from "@/types";

/** A roster person as the loose match reads them: the full name and any preferred first name. */
export type LoosePerson = { readonly name: string; readonly preferred: string | null };

/**
 * PARTIAL_NAME_LOOSE_MATCH_ENABLED: the manager's roster for the creation
 * check (`checkProposalIsCurrent`'s `looseRoster`). Off, or no roster:
 * undefined, and no roster is read.
 */
export async function looseRosterFor(scope: AccessScope | null): Promise<LoosePerson[] | undefined> {
  if (!partialNameLooseMatchEnabled()) return undefined;
  const roster = await loadScopedRoster(scope);
  if (roster.length === 0) return undefined;
  return roster.map((person) => ({ name: displayName(person), preferred: person.preferredFirstName?.trim() || null }));
}

const words = (text: string) => text.toLowerCase().match(/[a-z][a-z'’-]*/g) ?? [];

/** `part`'s letters appear in `word` in order, starting with its first letter: "co" in "camacho", "dovtail" in "dovetail". */
function inOrder(part: string, word: string): boolean {
  if (part[0] !== word[0]) return false;
  let at = 0;
  for (const letter of word) if (letter === part[at]) at += 1;
  return at >= part.length;
}

/**
 * QA live, 29 Oct 2026 (Ask Sunny, Pau's own name; invented here): "pls
 * create a coaching form for marisol co" — the card was Marisol Camarillo
 * and Create refused it, because "co" does not begin "camarillo". The typed
 * words fit the person when the first is their first or preferred name (or
 * the start of it) and each further word begins their surname or has its
 * letters in order from the same first letter ("co", "cam", "camach",
 * "dovtail").
 */
export function looseFits(typed: string, person: LoosePerson): boolean {
  const said = words(typed);
  const [first, ...last] = words(person.name);
  if (said.length === 0 || !first) return false;
  const firsts = [first, ...(person.preferred ? words(person.preferred) : [])];
  if (!firsts.some((name) => name === said[0] || (said[0]!.length >= 2 && name.startsWith(said[0]!)))) return false;
  return said
    .slice(1)
    .every((part) => part.length >= 2 && last.some((word) => word.startsWith(part) || inOrder(part, word)));
}

/** The typed words fit the card's person on the roster, and nobody else on it. */
export function looseFitsOnly(typed: string, cardName: string, roster: readonly LoosePerson[]): boolean {
  const card = cardName.trim().toLowerCase();
  const fits = roster.filter((person) => looseFits(typed, person));
  return fits.length === 1 && fits[0]!.name.toLowerCase() === card;
}
