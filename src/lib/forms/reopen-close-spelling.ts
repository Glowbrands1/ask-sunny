import { candidateNameWords } from "./chat-form-records";
import { foldName } from "./fold-name";
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
  /* QA's f072 (20 Nov 2026): accents fold first, as `foldName` does wherever names are compared. */
  return foldName(name).toLowerCase().split(/[^a-z]+/).filter((word) => word.length >= 2);
}

function close(typed: string, word: string): boolean {
  if (typed[0] !== word[0] || Math.abs(typed.length - word.length) > 2) return false;
  return editDistance(typed, word) <= (word.length >= 6 ? 2 : 1);
}

/**
 * QA (20 Nov 2026, live after #1131: "show me forms for Tes" opened "Test Te"'s draft): each word of the name needs ITS
 * OWN typed word that spells it closely. One typed word ("tes") one letter from two name words ("test" and "te") is never
 * a two-word name. Assigned in order of the name's words, each typed word used once.
 */
function eachWordOwnTyped(words: readonly string[], typed: readonly string[]): boolean {
  const used = new Set<number>();
  return words.every((word) => {
    const at = typed.findIndex((said, index) => !used.has(index) && close(said, word));
    if (at === -1) return false;
    used.add(at);
    return true;
  });
}

/** The one employee on these forms whose name the request spells closely, or null. Exact names are not this reader's. */
export function closelySpelledEmployee(question: string, employeeNames: readonly string[]): string | null {
  const typed = candidateNameWords(question);
  const fits = [...new Set(employeeNames)].filter((name) => {
    const words = wordsOf(name);
    if (words.length < 2) return false;
    if (words.every((word) => typed.includes(word))) return false;
    return eachWordOwnTyped(words, typed);
  });
  return fits.length === 1 ? fits[0]! : null;
}
