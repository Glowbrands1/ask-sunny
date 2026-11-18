// Ask Sunny only (not in the Leadership Hub). See src/features/l10/owners.server.ts.

/**
 * The owner menu for to-dos and issues: the meeting's own people first, in the Hub's order, then the other DM-or-higher
 * people from Woven (owners.server.ts), without repeating anyone (names compared ignoring case and spacing).
 */
export function ownerMenu(people: readonly string[], extra: readonly string[]): string[] {
  const key = (n: string) => n.trim().replace(/\s+/g, " ").toLowerCase();
  const seen = new Set(people.map(key));
  const out = [...people];
  for (const name of extra) {
    if (!name.trim() || seen.has(key(name))) continue;
    seen.add(key(name));
    out.push(name);
  }
  return out;
}
