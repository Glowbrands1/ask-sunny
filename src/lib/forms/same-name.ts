/**
 * SAME_NAME_ASKS_WHICH_ENABLED: the choice is asked only when two or more roster candidates share ONE name (two people
 * named Marnie Holloway). Different close names ("Test Employee" and "Test Employee Two" for "test") stay what
 * TYPED_NAME_PROCEEDS makes them: the name as typed, with a note. Pure.
 */
export function hasSameNamePair(names: readonly string[]): boolean {
  const seen = new Set<string>();
  for (const name of names) {
    const key = name.trim().toLowerCase().replace(/\s+/g, " ");
    if (seen.has(key)) return true;
    seen.add(key);
  }
  return false;
}
