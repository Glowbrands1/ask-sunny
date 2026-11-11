/**
 * ============================================================================
 * THE CORRECTIVE ACTION'S TYPE OF OFFENSE, REVISION 8 (client request relayed
 * by Pau, 4 Nov 2026; template approved)
 * ============================================================================
 *
 * Revision 8 of the Corrective Action Form offers four boxes: Attendance
 * Policy, Standards of Conduct, Dress Code Violation, Other. The boxes it
 * removed are replaced, not forgotten:
 *
 *   Tardiness/Leaving Early, Absenteeism  → Attendance Policy
 *   Under Performance                      → Standards of Conduct
 *   Violation of Company Policies          → Standards of Conduct
 *   (late_opening, the key `ca-policy.ts` reads a late opening as,
 *    cites Late Opening under the attendance box) → Attendance Policy
 *
 * ONLY WHERE THE VERSION DOES NOT OFFER THE OLD BOX. Every reader that ticks a
 * box asks with the version's own options (`offered`): a form on revision 7 or
 * earlier still offers Tardiness/Leaving Early and is ticked exactly as before,
 * and its saved values are never rewritten. A form on revision 8 gets the box
 * that replaced it.
 */

/** The box that replaced a removed one, keyed by the removed box's key. */
export const OFFENSE_KEY_SUCCESSORS: Readonly<Record<string, string>> = {
  tardiness: "attendance_policy",
  absenteeism: "attendance_policy",
  late_opening: "attendance_policy",
  under_performance: "standards_of_conduct",
  company_policies: "standards_of_conduct",
};

/**
 * The drafting model's added line for a revision 8 form, after the existing
 * Type of Offense line (which is not changed).
 */
export const CA_REVISION_8_OFFENSE_RULE =
  "Type of Offense on this form: being late, leaving early, a missed shift and other absences are attendance_policy; results against a sales or performance target are standards_of_conduct. Tick only the keys listed for offense_type.";

/** The new box. */
export const ATTENDANCE_POLICY = "attendance_policy";

/**
 * The Type of Offense boxes of the CURRENT Corrective Action Form, in the
 * form's order. What the chat card names a box by, before any form exists;
 * `offense-keys.test.ts` checks it against the library's document.
 */
export const CURRENT_CA_OFFENSE_KEYS: readonly string[] = ["attendance_policy", "standards_of_conduct", "dress_code", "other"];

/** One key as this version offers it: itself, the box that replaced it, or null. */
export function offeredOffenseKey(key: string, offered: readonly string[]): string | null {
  if (offered.includes(key)) return key;
  const successor = OFFENSE_KEY_SUCCESSORS[key];
  return successor && offered.includes(successor) ? successor : null;
}

/** Keys as this version offers them, each once, in the order given. Keys with no box on it are dropped (as before). */
export function offeredOffenseKeys(keys: readonly string[], offered: readonly string[]): string[] {
  const out: string[] = [];
  for (const key of keys) {
    const mapped = offeredOffenseKey(key, offered);
    if (mapped && !out.includes(mapped)) out.push(mapped);
  }
  return out;
}

/**
 * A drafted `checked` map with its Type of Offense ticks as this version offers
 * them. Returned unchanged (the same object) when every tick is already offered,
 * or the version has no Type of Offense.
 */
export function withOfferedOffense(checked: Record<string, string[]>, offered: readonly string[]): Record<string, string[]> {
  const ticked = checked.offense_type;
  if (!ticked || offered.length === 0 || ticked.every((key) => offered.includes(key))) return checked;
  return { ...checked, offense_type: offeredOffenseKeys(ticked, offered) };
}
