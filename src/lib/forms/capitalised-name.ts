/**
 * Whether every word of a typed name starts with a capital then a lowercase letter ("Marnie", "Holloway").
 *
 * Kept out of `template-intent.ts` on purpose: the intent router reads no capitals (`form-intent-routing.test.ts` scans
 * its source for an upper-case character class). The termination request (TERMINATION_REQUEST_IS_CA_ENABLED) uses this for
 * the one place a capital matters: with a roster read, a name that is not on it must be typed as a full name in capitals
 * ("Zebulon Marchbanks"), which keeps "job abandonment" and "no call no show" from being read as people.
 */
export function allCapitalised(words: readonly string[]): boolean {
  return words.every((word) => /^\p{Lu}\p{Ll}/u.test(word));
}
