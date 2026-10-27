import "server-only";

import { readDirectoryRoster } from "@/lib/forms/employee-roster";

import { nameWords } from "./typo-reading-copy";

/*
 * The names a typo is never read over, from the whole directory: protecting
 * more names than the manager can see only makes the reading more careful,
 * and no name is ever shown from here. Read at most every five minutes.
 */
let cached: { words: Set<string>; at: number } | null = null;

export async function protectedNameWords(now = Date.now()): Promise<Set<string>> {
  if (cached && now - cached.at < 5 * 60_000) return cached.words;
  try {
    cached = { words: nameWords(await readDirectoryRoster()), at: now };
  } catch {
    // The directory unreadable: protect nothing more than before, and correct nothing.
    return new Set(["*"]);
  }
  return cached.words;
}
