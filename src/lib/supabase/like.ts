/**
 * Escapes a value for an exact (case-insensitive) PostgREST `ilike` match.
 *
 * `_` and `%` are LIKE wildcards and `\` is its escape, so an email such as
 * `jane_doe@gmail.com` would otherwise also match `jane.doe@gmail.com`.
 * Escaped, `ilike` compares the whole value literally, ignoring case.
 */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}
