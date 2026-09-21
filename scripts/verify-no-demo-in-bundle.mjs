#!/usr/bin/env node
/**
 * ============================================================================
 * NO FABRICATED CONTENT IN THE EMITTED PRODUCTION CLIENT ASSETS
 * ============================================================================
 *
 * Run after a production `next build`. Every other guard in this repo reads
 * SOURCE and reasons about what should happen; this one reads the build output
 * and reports what did.
 *
 * ============================================================================
 * IT SCANS EVERYTHING, NOT JUST WHAT A PAGE REFERENCES
 * ============================================================================
 *
 * An earlier version of this script only failed when a PRERENDERED PAGE loaded
 * a tainted chunk, which was the right question for the architecture at the
 * time: the seeds were reached by dynamic import, so they were emitted as
 * chunks nothing fetched. It passed, and eleven files in `.next/static` still
 * carried Jane Kowalski, `example.com/policies` and a fabricated $214.62.
 *
 * "Nobody downloads it" is a weaker promise than "it is not there", and it is
 * the weaker one that depends on the bundler continuing to behave. So this
 * walks every emitted `.js` file and fails on a match anywhere.
 *
 * ============================================================================
 * TWO LISTS, AND THE DISTINCTION IS THE POINT
 * ============================================================================
 *
 * FORBIDDEN is fabricated content: invented people, invented money, invented
 * sentences, placeholder URLs. None of it may appear anywhere.
 *
 * ALLOWED_IDENTIFIERS is the exception, and it is exactly one thing: the
 * opaque record ids the IndexedDB cleanup needs. `purgeDemoRecords` runs on
 * live deployments to remove seeded rows earlier builds wrote into real
 * browsers, and it cannot delete an id it does not know. `conv-seed-1` is a
 * primary key — no name, no figure, no URL, nothing a person could read as a
 * claim — so it ships, from `lib/store/demo-record-ids.ts` and nowhere else.
 *
 * The two lists are separate so that the exception stays exactly as wide as
 * the migration requires. An id being permitted is not a general licence for
 * strings that merely look seeded.
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, basename, relative } from "node:path";

const NEXT = join(process.cwd(), ".next");
const STATIC = join(NEXT, "static");

/**
 * Fabricated content. A match anywhere in the emitted client JS fails.
 *
 * Grouped so a failure report says what KIND of leak it is, which is usually
 * enough to know which module came back.
 */
const FORBIDDEN = {
  "invented people": [
    "Jane Kowalski",
    "Marcus Trent",
    "Sofia Delgado",
    "Owen Bradshaw",
    "Priscilla Nunez",
    "Corey Vandenberg",
    "Alicia Moreno",
    "Tyrell Jacobs",
  ],
  "invented money and usage": [
    "214.62",
    "785.38",
    "228.15",
    "8_942_100",
    "creditPurchasedUsd",
  ],
  "placeholder and unverified URLs": [
    "example.com/policies",
    "example.com/power-bi",
    "example.com/training",
    "example.com/woven",
    "example.com/hr",
    "preview--leadership-sync-tool",
  ],
  "seeded Daily Stats figures": [
    "486 guests",
    "24.6%",
    "$41.80",
    "Start with **conversion**",
  ],
  "seeded conversation and answer text": [
    "Daily Stats — conversion focus",
    "Coaching a consultant on tardiness",
    "This prototype runs on **MockAIProvider**",
  ],
  "fabricated records and rosters": [
    /*
     * "Local prototype storage" is NOT listed, and the near-miss is worth
     * recording: it reads like seeded content and is production config. It
     * describes browser IndexedDB, a real capability whose status the
     * Integrations screen MEASURES from `storageAvailable`. See
     * `data/integrations.ts`.
     */
    "Drafted a Coaching Form for",
    "Asked what to focus on in today's Daily Stats",
  ],
};

/**
 * Opaque migration identifiers the cleanup legitimately ships.
 *
 * Matched as WHOLE STRING LITERALS, so a seeded record that merely mentions
 * one is not excused by it. If a forbidden string and an allowed id ever
 * appear in the same file, the forbidden one still fails.
 */
const ALLOWED_IDENTIFIERS = /^(conv-seed-\d+|form-\d+|tpl-[a-z-]+)$/;

/** The one module permitted to carry those identifiers. */
const ALLOWED_IDENTIFIER_SOURCE = "src/lib/store/demo-record-ids.ts";

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name.endsWith(".js")) out.push(full);
  }
  return out;
}

if (!existsSync(STATIC)) {
  console.error("No .next/static — run `next build` first.");
  process.exit(1);
}

const files = walk(STATIC);
const leaks = [];

for (const file of files) {
  const source = readFileSync(file, "utf8");
  for (const [kind, needles] of Object.entries(FORBIDDEN)) {
    for (const needle of needles) {
      if (source.includes(needle)) {
        leaks.push({ file: relative(process.cwd(), file), kind, needle });
      }
    }
  }
}

/* ---- the permitted identifiers, reported rather than merely tolerated ---- */

const identifierFiles = new Map();
for (const file of files) {
  const source = readFileSync(file, "utf8");
  const ids = [...source.matchAll(/"([^"]{1,40})"/g)]
    .map((match) => match[1])
    .filter((literal) => ALLOWED_IDENTIFIERS.test(literal));
  if (ids.length > 0) identifierFiles.set(basename(file), [...new Set(ids)]);
}

console.log(`Scanned ${files.length} emitted client JS files under .next/static.`);

if (identifierFiles.size > 0) {
  console.log(
    `\nPermitted migration identifiers (from ${ALLOWED_IDENTIFIER_SOURCE}), in ${identifierFiles.size} file(s):`,
  );
  for (const [file, ids] of identifierFiles) {
    console.log(`  ${file}: ${ids.length} ids, e.g. ${ids.slice(0, 3).join(", ")}`);
  }
}

if (leaks.length > 0) {
  console.error(`\nLEAK — fabricated content in ${leaks.length} place(s):`);
  for (const leak of leaks) {
    console.error(`  [${leak.kind}] ${leak.needle}  in  ${leak.file}`);
  }
  process.exit(1);
}

console.log("\nOK: no fabricated demo content in any emitted client asset.");
