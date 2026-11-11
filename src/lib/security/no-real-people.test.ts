/*
 * NAMES COPIED FROM PRODUCTION CHATS ARE SWAPPED FOR INVENTED ONES BEFORE
 * COMMITTING. This repository is public. A bug report's exact wording becomes a
 * test (CLAUDE.md, "Every bug report becomes a test"), but the people in it do
 * not: every real employee or manager named in a chat, a form or the directory,
 * with their typo, nickname and first-name-only variants, is replaced by an
 * invented name, used the same way across the test and the fixtures it reads.
 * Check an invented name against the directory so it is not someone real.
 *
 * The second check below makes that machine-checkable where a roster export is
 * at hand: one "First Last" per line in `.real-people-roster.txt` (gitignored,
 * never committed) or in a file named by REAL_PEOPLE_ROSTER outside the
 * repository. Without that file the check is skipped, as it is in CI.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * ============================================================================
 * THIS REPOSITORY CARRIES NO REAL PERSON'S CONTACT DETAILS
 * ============================================================================
 *
 * Tests, comments and docs describe production incidents, and the natural way
 * to write one down is with the people it happened to. That put real employees'
 * names and work addresses into a repository that is not private. Every person
 * in this codebase is now synthetic, and this test keeps it that way for the
 * part a machine can check: a personal-format address (first.last@) at a
 * company domain must be one of the invented ones below.
 *
 * A NEW EXAMPLE NEEDS AN INVENTED PERSON. Use a synthetic name and, if it needs
 * an address, add it here. Never copy a name, address or account id out of
 * production — the directory, a form or a feedback comment.
 */
const SYNTHETIC_ADDRESSES = new Set([
  "celeste.ostrander@glowbrands.com",
  "delphine.ashworth@glowbrands.com",
  "elliot.fairbanks@glowbrands.com",
  "elliot.fairbanks+forward@glowbrands.com",
  "harper.lyle@suntancity.com",
  "invented.upstream@glowbrands.com",
  "invented.upstream.message.id@glowbrands.com",
  "invented.upstream.spa@glowbrands.com",
  "kc.manager@suntancity.com",
  "owen.tremaine@glowbrands.com",
  "owen.tremaine@suntancity.com",
  "rosalyn.calloway@glowbrands.com",
  "someone.else@glowbrands.com",
]);

const PERSONAL_ADDRESS = /[a-z0-9_%+-]+\.[a-z0-9._%+-]+@(?:glowbrands|suntancity)\.com\b/gi;

describe("no real person's address in a tracked file", () => {
  it("every first.last@ company address is a synthetic one", () => {
    const files = execFileSync("git", ["ls-files"], { encoding: "utf8" }).split("\n").filter(Boolean);
    const found: string[] = [];
    for (const file of files) {
      let text: string;
      try {
        text = readFileSync(file, "utf8");
      } catch {
        continue;
      }
      for (const match of text.matchAll(PERSONAL_ADDRESS)) {
        const address = match[0].toLowerCase();
        if (!SYNTHETIC_ADDRESSES.has(address)) found.push(`${file}: ${address}`);
      }
    }
    expect(found).toEqual([]);
  });
});

/** "First Last" lines from a local roster export that is never committed. */
function localRosterNames(): string[] {
  const file = process.env.REAL_PEOPLE_ROSTER || ".real-people-roster.txt";
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return [];
  }
  return [
    ...new Set(
      text
        .split("\n")
        .map((line) => line.trim().replace(/\s+/g, " ").toLowerCase())
        .filter((line) => !line.startsWith("#") && /^\S+ \S+/.test(line)),
    ),
  ];
}

const ROSTER_NAMES = localRosterNames();

describe("no real person's name in a tracked file", () => {
  it.skipIf(ROSTER_NAMES.length === 0)("no first-last name from the local roster appears", () => {
    const escape = (word: string) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(
      `(?<![\\p{L}])(?:${ROSTER_NAMES.map((name) => name.split(" ").map(escape).join("\\s+")).join("|")})(?![\\p{L}])`,
      "giu",
    );
    const files = execFileSync("git", ["ls-files"], { encoding: "utf8" }).split("\n").filter(Boolean);
    const found = new Set<string>();
    for (const file of files) {
      let text: string;
      try {
        text = readFileSync(file, "utf8");
      } catch {
        continue;
      }
      // Only the file is reported, so a failure does not print the name.
      if (pattern.test(text)) found.add(file);
      pattern.lastIndex = 0;
    }
    expect([...found]).toEqual([]);
  });
});
