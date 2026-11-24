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
  /**
   * Port of Ask Bubbles #1053 (its QA, 22 Nov 2026, production): the other people the manager's words name and those
   * words, so a coworker's "she" is never the employee's, and another person's "they" stays "they" (`reply-pronouns.ts`,
   * the pronoun-kind checks). Without it, as before.
   */
  people?: { readonly others: readonly string[]; readonly managerWords: string },
): { values: Record<string, string>; changed: string[] } {
  const first = employeeFirstName(employeeName ?? null);
  if (!first) return { values, changed: [] };
  const changed: string[] = [];
  const out = { ...values };
  for (const [key, value] of Object.entries(values)) {
    if (!keys.has(key) || typeof value !== "string" || value.trim() === "") continue;
    /*
     * A value that names another person the manager named goes only through the reply pass, which reads whose pronoun it
     * is; the forms' natural rewrite names the employee in any sentence that names nobody else ("She was giving her an
     * attitude." after "<B> was on register.").
     */
    const others = people?.others ?? [];
    const namesOther = others.some((other) => other.trim() !== "" && new RegExp(`(?<![\\p{L}'-])${other.trim().split(/\s+/)[0]!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}-])`, "iu").test(value));
    const natural = namesOther ? value : nameInsteadOfPronouns(value, employeeName).text;
    const named = withoutPersonPronouns(natural, first, others, people?.managerWords);
    if (named.text !== value) {
      out[key] = named.text;
      changed.push(key);
    }
  }
  return changed.length > 0 ? { values: out, changed } : { values, changed };
}

/**
 * Port of Ask Bubbles #1053 (its QA, 22 Nov 2026, production): the roster people, other than the form's employee, that
 * the manager's notes name by full or first name (preferred or legal), as the names `firstNameNotPronouns` reads whose
 * pronoun is whose. The employee is left out by every name they hold, so their legal first name is never read as someone
 * else. Pure.
 */
export function otherRosterPeopleIn(
  notes: string,
  roster: readonly { readonly firstName: string; readonly lastName: string; readonly preferredFirstName?: string | null }[],
  employeeName: string | null | undefined,
): string[] {
  const words = ` ${notes.toLowerCase().replace(/[^\p{L}\p{N}'-]+/gu, " ")} `;
  const holds = (name: string) => name.trim() !== "" && words.includes(` ${name.trim().toLowerCase()} `);
  const employee = (employeeName ?? "").trim().toLowerCase().split(/\s+/);
  const isEmployee = (row: { firstName: string; lastName: string; preferredFirstName?: string | null }) =>
    row.lastName.trim().toLowerCase() === (employee.at(-1) ?? "") && [row.firstName, row.preferredFirstName ?? ""].some((first) => first.trim().toLowerCase() === employee[0]);
  const named: string[] = [];
  for (const row of roster) {
    if (isEmployee(row)) continue;
    for (const first of new Set([row.preferredFirstName ?? "", row.firstName].filter((first) => first.trim() !== ""))) {
      const full = `${first} ${row.lastName}`;
      if (holds(full) || holds(first)) named.push(full);
    }
  }
  return [...new Set(named)];
}
