import { withoutPersonPronouns } from "@/lib/ai/agent-loop/reply-pronouns";

import { employeeFirstName } from "./employee-reference";

/**
 * ============================================================================
 * THE SAVED WRITE-UP CALLS THE EMPLOYEE BY FIRST NAME, NEVER A PRONOUN
 * ============================================================================
 *
 * Pau via QA (20 Nov 2026, item 15; Runner 2's c151): Create from a loop card saved "She said her new job pays more." as
 * the exit form's Reason for Resignation, and "she"/"her" in the drafted Observation. The saved text uses the first name.
 *
 * The same deterministic pass the loop's replies use (`reply-pronouns.ts`): it reads the saved TEXT (never a word list
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
    const named = withoutPersonPronouns(value, first);
    if (named.replaced > 0 && named.text !== value) {
      out[key] = named.text;
      changed.push(key);
    }
  }
  return changed.length > 0 ? { values: out, changed } : { values, changed };
}
