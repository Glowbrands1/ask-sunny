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
