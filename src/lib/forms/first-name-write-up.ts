import { withoutPersonPronouns } from "@/lib/ai/agent-loop/reply-pronouns";

import { employeeFirstName, nameInsteadOfPronouns } from "./employee-reference";

/**
 * ============================================================================
 * THE SAVED WRITE-UP CALLS THE EMPLOYEE BY FIRST NAME, NEVER A PRONOUN
 * ============================================================================
 *
 * Pau via QA (20 Nov 2026, item 15; Runner 2's c151): Create from a loop card saved "She said her new job pays more." as
 * the exit form's Reason for Resignation, and "she"/"her" in the drafted Observation. The saved text uses the first name.
 *
 * First the forms' own natural rewrite (`nameInsteadOfPronouns`: "Remy provided a resignation", "for the shift", "and
 * did not call"; QA's item 19, the second mention reads naturally), then the loop's reply pass (`reply-pronouns.ts`) for
 * any pronoun that rewrite leaves (it keeps some, "because she overslept"). Both read the saved TEXT (never a word list
 * over the manager's messages), and text in quotes is left as written. Only the keys given are changed; a quote of the
 * manual (the policy fields) is never given. Pure.
 */
export function firstNameNotPronouns(
  values: Record<string, string>,
  employeeName: string | null | undefined,
  keys: ReadonlySet<string>,
): { values: Record<string, string>; changed: string[] } {
  const first = employeeFirstName(employeeName ?? null);
  if (!first) return { values, changed: [] };
  const changed: string[] = [];
  const out = { ...values };
  for (const [key, value] of Object.entries(values)) {
    if (!keys.has(key) || typeof value !== "string" || value.trim() === "") continue;
    const natural = nameInsteadOfPronouns(value, employeeName).text;
    const named = withoutPersonPronouns(natural, first);
    if (named.text !== value) {
      out[key] = named.text;
      changed.push(key);
    }
  }
  return changed.length > 0 ? { values: out, changed } : { values, changed };
}
