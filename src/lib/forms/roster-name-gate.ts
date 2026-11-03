import { formEditNameGateRosterEnabled } from "@/lib/config/chat-quality-flags";
import type { AccessScope } from "@/types";

import { matchEmployeeName, type RosterEmployee } from "./employee-match";
import { readStoreRoster } from "./employee-roster";

/**
 * ============================================================================
 * A "NAME" IN A FORM EDIT IS A PERSON ONLY IF THE MANAGER'S OWN ROSTER HAS THEM
 * ============================================================================
 *
 * FORM_EDIT_NAME_GATE_ROSTER_ENABLED (master plan step 2, 3 Nov 2026; same
 * flag in both apps). With a form open, the revision drops a request that
 * names somebody other than the form's employee — it is about a different
 * person. Names were read from capital letters (`extractEmployeeNames`), so
 * "Must", "Practice", "Daily Stats", "Progress Level", "Buy Online" or a
 * report's name read as another person, and the manager's edit was dropped
 * for the ordinary answer.
 *
 * With the flag, a capitalised word counts as a person only when it matches
 * somebody active at the manager's own salons (`readStoreRoster`, step 1) —
 * exactly, or closely enough that the name check would ask. Data, not a word
 * list. When that roster cannot be read or is empty there is nothing to check
 * against, and every candidate is kept: the flag-off reading, never "nobody
 * is ever another person".
 *
 * Off, the candidates are returned unchanged and no roster is read.
 */
export async function namesOnRoster(names: readonly string[], scope: AccessScope | null): Promise<string[]> {
  if (!formEditNameGateRosterEnabled() || names.length === 0) return [...names];
  let roster: RosterEmployee[];
  try {
    roster = await readStoreRoster(scope);
  } catch {
    return [...names];
  }
  return keepRosterNames(names, roster);
}

/** Pure: the candidates that are somebody on this roster; all of them when there is no roster. */
export function keepRosterNames(names: readonly string[], roster: readonly RosterEmployee[]): string[] {
  if (roster.length === 0) return [...names];
  return names.filter((name) => {
    const match = matchEmployeeName(name, roster);
    return match.kind === "exact" || match.kind === "confirm";
  });
}
