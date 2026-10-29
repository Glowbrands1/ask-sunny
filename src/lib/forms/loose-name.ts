import "server-only";

import { partialNameLooseMatchEnabled } from "@/lib/config/chat-quality-flags";
import { displayName } from "@/lib/forms/employee-match";
import { loadScopedRoster } from "@/lib/forms/employee-roster";
import type { AccessScope } from "@/types";

import type { LoosePerson } from "./loose-fit";

export { looseFits, looseFitsOnly, type LoosePerson } from "./loose-fit";


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
