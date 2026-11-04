import { matchEmployeeName, normalizeTypedName, type RosterEmployee } from "./employee-match";

/**
 * ============================================================================
 * COULD THIS CANDIDATE BE SOMEONE ON THE ROSTER?
 * ============================================================================
 *
 * Pau, 4 Nov 2026: "I need a corrective action verbal for <name>. This is for
 * Under Performance on PPTA, LPSVA, Club Average, Club Close %, and Spa %."
 * The name reader offers "Club Close" and "Under" as names. Neither is shaped
 * like anybody on the manager's roster, and neither should be announced as a
 * person missing from it (FORM_NAME_FROM_ROSTER_ENABLED).
 *
 * A candidate is roster-shaped when:
 *   - it has 2+ words and its first word is the first or preferred name of
 *     someone on the roster ("Perpetua Thornqist" for Perpetua Thornquist);
 *   - it is one word that is someone's first, preferred or last name.
 *
 * Roster data only: no list of phrases, no reading of intent or metric words.
 * An empty roster says nothing, so the caller does not ask.
 */
export function rosterShaped(name: string, roster: readonly RosterEmployee[]): boolean {
  const words = normalizeTypedName(name).split(/[\s-]+/).filter(Boolean);
  if (words.length === 0) return false;
  const firsts = new Set<string>();
  const lasts = new Set<string>();
  for (const employee of roster) {
    for (const first of [employee.firstName, employee.preferredFirstName ?? ""]) {
      const word = normalizeTypedName(first).split(/[\s-]+/)[0];
      if (word) firsts.add(word);
    }
    for (const part of normalizeTypedName(employee.lastName).split(/[\s-]+/)) {
      if (part) lasts.add(part);
    }
  }
  if (words.length === 1) return firsts.has(words[0]!) || lasts.has(words[0]!);
  return firsts.has(words[0]!);
}

/**
 * The person guard's roster ("Kate Smith", one entry per name a person goes
 * by) as rows: the first word is the first name, the rest the last name.
 */
function rowsFromNames(names: readonly string[]): RosterEmployee[] {
  return names.flatMap((name, index) => {
    const words = name.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return [];
    return [{ id: `roster-name-${index}`, firstName: words[0]!, lastName: words.slice(1).join(" "), salonIds: [] }];
  });
}

/** Roster-shaped, or an exact or close match for somebody on the roster ("Leocadja Wexcombe"). */
export function couldBeOnRoster(name: string, names: readonly string[]): boolean {
  const rows = rowsFromNames(names);
  if (rows.length === 0) return true;
  if (rosterShaped(name, rows)) return true;
  return matchEmployeeName(name, rows).kind !== "none";
}

/* ------------------------------------------------- the message's anchor -- */

/**
 * FORM_NAME_FROM_ROSTER_ENABLED, the middle ground (QA, 4 Nov 2026): a
 * candidate shaped like nobody is set aside only when another candidate in
 * the same message is somebody on the roster (exact or close). "Zuleika
 * Brightwell" alone is still a person the manager means, and is read as
 * today. The grounding step decides it per message; the server installs the
 * reader (`roster-anchor-store.ts`), so this module stays free of
 * `node:async_hooks`. Unset — a test, the browser — no anchor.
 */
let readAnchor: () => boolean | undefined = () => undefined;

export function installRosterAnchor(read: () => boolean | undefined): void {
  readAnchor = read;
}

/** True while the current message names somebody on the roster. */
export function rosterAnchored(): boolean {
  return readAnchor() === true;
}

/** The candidate is somebody on the roster: an exact or a close match. */
export function anchorsOnRoster(name: string, roster: readonly RosterEmployee[]): boolean {
  const match = matchEmployeeName(name, roster);
  return match.kind === "exact" || match.kind === "confirm";
}
