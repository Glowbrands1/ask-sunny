import "server-only";

import { staleNeedsRosterPersonEnabled } from "@/lib/config/chat-quality-flags";
import { displayName } from "@/lib/forms/employee-match";
import { loadScopedRoster } from "@/lib/forms/employee-roster";
import type { AccessScope } from "@/types";

/**
 * STALE_NEEDS_ROSTER_PERSON_ENABLED: the people on the manager's own roster,
 * by full name and by preferred name, for the creation check
 * (`checkProposalIsCurrent`'s `rosterNames`). Off, or no roster: undefined,
 * and the check reads names as before.
 */
export async function rosterNamesFor(scope: AccessScope | null): Promise<string[] | undefined> {
  if (!staleNeedsRosterPersonEnabled()) return undefined;
  const roster = await loadScopedRoster(scope);
  if (roster.length === 0) return undefined;
  return roster.flatMap((person) => [
    displayName(person),
    ...(person.preferredFirstName?.trim() ? [`${person.preferredFirstName.trim()} ${person.lastName.trim()}`] : []),
  ]);
}
