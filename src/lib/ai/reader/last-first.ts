import { checkReading, type CheckContext, type CheckedReading } from "./check";
import { parseFormReading } from "./schema";

/**
 * ============================================================================
 * LAST_FIRST_NAME_READ_ENABLED — "MARLOWE, QUINN" WITHOUT A MODEL
 * ============================================================================
 *
 * The AI reader's only measured win (QA, 27 Oct 2026: 5 of 60 variants, all
 * "Last, First") was reading a name the way the paperwork writes it. Today's
 * name reader stops at the comma: "My employee Marlowe, Quinn" is the employee
 * "Marlowe", "employee name is Hollis, Ivy" is "Hollis Ivy", and "Marlowe,
 * Quinn was late on 10/20" has no employee at all.
 *
 * This finds a capitalised "Word, Word" pair in the manager's own turns, newest
 * first, and gives it to the same checks the reader's answer goes through
 * (`check.ts`): the pair must be in the manager's words and fit exactly ONE
 * person on the scoped roster, in either order. No pair fits, none is read. The
 * merge (`merge.ts`) then fills only an employee today's readers left open or
 * read as a name nobody on the roster has, and never replaces a settled one.
 * No model, no roster sent anywhere, no cost.
 */
const PAIR = /\b([A-Z][A-Za-z'’-]+),\s+([A-Z][A-Za-z'’-]+)\b/g;

export function lastFirstReading(context: CheckContext): CheckedReading | null {
  for (let index = context.managerTurns.length - 1; index >= 0; index -= 1) {
    const turn = context.managerTurns[index]!;
    for (const pair of turn.matchAll(PAIR)) {
      const reading = parseFormReading({ employee: { value: pair[0], evidence: pair[0] } });
      const checked = reading ? checkReading(reading, context) : null;
      if (checked?.employee?.person) return checked;
    }
  }
  return null;
}
