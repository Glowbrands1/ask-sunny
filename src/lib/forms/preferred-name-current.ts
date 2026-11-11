import "server-only";

import { preferredNameCardCurrentEnabled } from "@/lib/config/chat-quality-flags";
import { displayName } from "@/lib/forms/employee-match";
import { loadScopedRoster } from "@/lib/forms/employee-roster";
import type { AccessScope } from "@/types";

/**
 * PREFERRED_NAME_CARD_CURRENT_ENABLED. Audit, 29 Oct 2026: "create a ca for
 * kit dovetail" (Kit is Katrin Dovetail's preferred name) made a card for
 * Katrin Dovetail, and Create refused it as "out of date: the conversation
 * now says the form is for kit dovetail" — the creation check reads names,
 * not the roster. The other names the card's person goes by, from the
 * manager's own roster: "<preferred> <last>" for a roster person whose full
 * name is the card's and who has a preferred first name. The creation check
 * reads them as the card's person (`checkProposalIsCurrent`'s `alsoCalled`),
 * so every other check — the form, an exclusion, a later person — still runs.
 * Off: none.
 */
export async function preferredNamesOf(scope: AccessScope | null, cardName: string): Promise<string[]> {
  if (!preferredNameCardCurrentEnabled()) return [];
  const card = cardName.trim().toLowerCase();
  const roster = await loadScopedRoster(scope);
  return roster
    .filter((person) => Boolean(person.preferredFirstName?.trim()) && displayName(person).toLowerCase() === card)
    .map((person) => `${person.preferredFirstName!.trim()} ${person.lastName}`);
}
