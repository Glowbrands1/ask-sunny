import { candidateNameWords } from "./chat-form-records";
import { editDistance } from "./typo-match";

/**
 * ============================================================================
 * "EDIT THESALY BRANT CA" OPENS THESSALY BRANDT'S CA (REOPEN_CLOSE_SPELLING_ENABLED)
 * ============================================================================
 *
 * Pau via QA, 5 Nov 2026 (sf-s26): "Edit <misspelled first and last name> CA" with that person's Corrective Action on
 * file was answered "Who is this form for?": the reopen reader found nobody named. With the flag on, when the request
 * names nobody it can find, the forms the manager may already open are read for an employee whose every name word the
 * request spells closely (the same first letter, one or two letters off) — and only when exactly one person on those
 * forms fits. Nothing new is created and nothing is written: the existing form is opened, and the reply names the
 * person as the form spells them. Pure.
 */

function wordsOf(name: string): string[] {
  return name.toLowerCase().split(/[^a-z]+/).filter((word) => word.length >= 2);
}

function close(typed: string, word: string): boolean {
  if (typed[0] !== word[0] || Math.abs(typed.length - word.length) > 2) return false;
  return editDistance(typed, word) <= (word.length >= 6 ? 2 : 1);
}

/** The one employee on these forms whose name the request spells closely, or null. Exact names are not this reader's. */
export function closelySpelledEmployee(question: string, employeeNames: readonly string[]): string | null {
  const typed = candidateNameWords(question);
  const fits = [...new Set(employeeNames)].filter((name) => {
    const words = wordsOf(name);
    if (words.length < 2) return false;
    if (words.every((word) => typed.includes(word))) return false;
    return words.every((word) => typed.some((said) => close(said, word)));
  });
  return fits.length === 1 ? fits[0]! : null;
}
