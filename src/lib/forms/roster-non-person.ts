/**
 * ============================================================================
 * DIRECTORY ROWS THAT ARE NOT PEOPLE — A REVIEWED LIST OF WOVEN EMPLOYEE IDS
 * ============================================================================
 *
 * ROSTER_STORE_SCOPED_ENABLED (master plan step 1, 3 Nov 2026; same mechanism
 * in both apps). The sibling app's directory carries one shared Woven login per
 * location, listed by Woven as an active team member with a hire date; no
 * column tells it apart from a person, so it was offered as an employee. The
 * only reliable mark is the Woven employee id, so a login is left out by that
 * id (`employee_access_directory.external_employee_id`) plus a reason — never
 * by a name or phrase.
 *
 * EMPTY HERE: this app's directory had no such row when read on 3 Nov 2026
 * (read-only; 163 rows, none of them a shared login). A login that appears
 * later is added by hand, in a reviewed change.
 *
 * NO DATABASE TABLE AND NO MIGRATION, by the plan: the directory stays the
 * Woven sync's, untouched.
 */
export interface NonPersonRow {
  /** `employee_access_directory.external_employee_id` — the Woven employee id. */
  readonly wovenEmployeeId: string;
  readonly reason: string;
}

export const ROSTER_NON_PERSON: readonly NonPersonRow[] = [];

const NON_PERSON_IDS: ReadonlySet<string> = new Set(ROSTER_NON_PERSON.map((row) => row.wovenEmployeeId));

/** True for a directory row the reviewed list says is not a person. */
export function isNonPersonWovenId(wovenEmployeeId: string | null | undefined, list: ReadonlySet<string> = NON_PERSON_IDS): boolean {
  return typeof wovenEmployeeId === "string" && list.has(wovenEmployeeId);
}
