import type { GroundedPerson } from "../grounded-entities";
import type { CheckedReading, LocationRow } from "./check";

/**
 * ============================================================================
 * AI_READS_CODE_CHECKS_ENABLED — WHERE THE CHECKED READING MAY FILL A FIELD
 * ============================================================================
 *
 * Today's readers keep every field they settle. The checked reading fills a
 * field only where they did not: no value, a numbered list of people, salons
 * or dates, a typed name that is nobody on the roster, or a date the manager
 * gave for an earlier step or a follow-up. Where both settled a value and the
 * two differ, today's value stays and the disagreement is traced, so a turn
 * that is right today cannot turn wrong.
 */

type Employee = { person: GroundedPerson | null; name: string | null; ambiguous: readonly GroundedPerson[]; typed: string | null };
type Salon = { id: string | null; name: string | null; ambiguous: readonly LocationRow[] };
type DateRead = { iso: string | null; ambiguous: readonly string[] };
type Warning = { value: "verbal" | "written" | null; ambiguous: boolean };

export interface ReadingMerge {
  employee<T extends Employee>(code: T): T;
  salon<T extends Salon>(code: T): T;
  title(code: string | null): string | null;
  date<T extends DateRead>(code: T): T;
  warningLevel<T extends Warning>(code: T): T;
  payrollAmount(code: string | null): string | null;
  policyHeading(code: string | null): string | null;
  /** Fields the checked reading filled. */
  readonly filled: readonly string[];
  /** Fields both settled, differently; today's value was kept. */
  readonly disputed: readonly string[];
}

/** One merge per turn; with no checked reading every field is today's, untouched. */
export function mergeCheckedReading(checked: CheckedReading | null | undefined): ReadingMerge {
  const filled: string[] = [];
  const disputed: string[] = [];
  /** Today's reader settled this field: it stays, and a different reading is traced. */
  const settled = <T>(name: string, mine: T | null, theirs: T | null, same: (a: T, b: T) => boolean): boolean => {
    if (mine === null) return false;
    if (theirs !== null && !same(mine, theirs)) disputed.push(name);
    return true;
  };
  const fill = <T>(name: string, value: T): T => {
    filled.push(name);
    return value;
  };
  return {
    filled,
    disputed,
    employee(code) {
      const person = checked?.employee?.person ?? null;
      if (!checked || settled("employee", code.person, person, (a, b) => a.id === b.id) || !person) return code;
      return fill("employee", { ...code, person, name: checked.employee!.name, ambiguous: [], typed: code.typed ?? checked.employee!.name });
    },
    salon(code) {
      const row = checked?.location ?? null;
      if (!checked || settled("location", code.id, row?.id ?? null, (a, b) => a === b) || !row) return code;
      return fill("location", { ...code, id: row.id, name: row.name, ambiguous: [] });
    },
    title(code) {
      const read = checked?.jobTitle ?? null;
      if (!checked || settled("jobTitle", code, read, (a, b) => a.toLowerCase() === b.toLowerCase()) || !read) return code;
      return fill("jobTitle", read);
    },
    date(code) {
      const read = checked?.incidentDate ?? null;
      // A date the manager gave for an earlier step or a follow-up is not settled.
      const mine = code.iso && !checked?.notIncidentDates.includes(code.iso) ? code.iso : null;
      if (!checked || settled("incidentDate", mine, read, (a, b) => a === b) || !read) return code;
      return fill("incidentDate", { ...code, iso: read, ambiguous: [] });
    },
    warningLevel(code) {
      const read = checked?.warningLevel ?? null;
      if (!checked || settled("warningLevel", code.value, read, (a, b) => a === b) || !read) return code;
      return fill("warningLevel", { ...code, value: read, ambiguous: false });
    },
    payrollAmount(code) {
      const read = checked?.payrollAmount ?? null;
      if (!checked || settled("payrollAmount", code, read, (a, b) => a === b) || !read) return code;
      return fill("payrollAmount", read);
    },
    policyHeading(code) {
      const read = checked?.policyHeading ?? null;
      if (!checked || settled("policyHeading", code, read, (a, b) => a === b) || !read) return code;
      return fill("policyHeading", read);
    },
  };
}
