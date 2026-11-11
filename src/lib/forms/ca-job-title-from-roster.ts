import { caJobTitleFromRosterEnabled } from "@/lib/config/chat-quality-flags";
import type { AccessScope } from "@/types";

import { displayName } from "./employee-match";
import { readDirectoryFacts, type DirectoryFact } from "./employee-roster";

/*
 * ============================================================================
 * A CORRECTIVE ACTION'S JOB TITLE IS THE ROSTER PERSON'S POSITION (CA_JOB_TITLE_FROM_ROSTER_ENABLED; QA, 11 Nov 2026)
 * ============================================================================
 *
 * Found on sf-b5 (audit item 15.10): "When <employee> spoke with District manager <name> …" on a Corrective Action
 * for a roster person. TITLE_OF_THE_EMPLOYEE rightly takes "District Manager" off the card, but leaves Job Title
 * blank, though the employee's position is on the roster; the sibling app fills it from Woven. With the flag on, a
 * Corrective Action card for exactly one roster person, with no title of its own, takes that person's roster
 * position. A title the manager stated for the employee is never replaced. Off, as before.
 */

interface CardLike {
  templateKey?: string;
  employeeName: string | null;
  employeeRole?: string | null;
  subject?: string;
}

/** The roster position of the one roster person named exactly as the card names its employee, or null. */
export function rosterPosition(employeeName: string, facts: readonly DirectoryFact[]): string | null {
  const wanted = employeeName.trim().toLowerCase();
  const named = facts.filter((person) => displayName(person).toLowerCase() === wanted);
  const titles = [...new Set(named.map((person) => person.title?.trim()).filter((title): title is string => Boolean(title)))];
  return named.length >= 1 && titles.length === 1 ? titles[0]! : null;
}

export async function withCaJobTitleFromRoster<T extends { formProposal?: CardLike | null }>(
  answer: T,
  scope: AccessScope | null,
  readFacts: (scope: AccessScope | null) => Promise<DirectoryFact[]> = readDirectoryFacts,
): Promise<T> {
  if (!caJobTitleFromRosterEnabled()) return answer;
  const card = answer.formProposal;
  if (!card || card.templateKey !== "dpoa" || !card.employeeName || card.employeeRole?.trim() || card.subject === "team") return answer;
  const title = rosterPosition(card.employeeName, await readFacts(scope).catch(() => []));
  return title ? { ...answer, formProposal: { ...card, employeeRole: title } } : answer;
}
