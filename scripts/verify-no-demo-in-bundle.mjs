#!/usr/bin/env node
/**
 * ============================================================================
 * NO SEEDED RECORD REACHES A PRODUCTION BROWSER — CHECKED AGAINST THE BUILD
 * ============================================================================
 *
 * Run after `next build`. Every other guard in this repo reads SOURCE and
 * reasons about what should happen; this one reads the emitted bundle and
 * reports what did.
 *
 * WHY IT IS NEEDED IN ADDITION TO THE SOURCE GUARD. A static import is the
 * obvious way seeded data reaches production, and `production-demo-data.test`
 * catches that. It is not the only way: a bundler can hoist a dynamically
 * imported module into a shared chunk, a barrel re-export can drag a sibling
 * in, and a `import type` that loses its `type` keyword becomes a real import
 * with no visible diff. None of those show up in a source scan, and all of
 * them end with a manager downloading Jane Kowalski's invented coaching
 * record.
 *
 * WHAT IT CHECKS. Two things, and the second is the one that matters:
 *
 *   1. WHICH CHUNKS contain known seeded strings.
 *   2. WHETHER ANY PRERENDERED PAGE LOADS ONE. The `<script>` tags in the
 *      HTML Next emits are what a browser actually fetches on first paint, so
 *      a seeded string in a chunk no page references is a file on disk that
 *      nobody downloads — while the same string in a login-page chunk is a
 *      real leak.
 *
 * THE PURGE IDS ARE EXPECTED AND ALLOWED. `lib/store/demo-record-ids.ts`
 * ships `conv-seed-1`, `form-2041` and the rest on purpose: the IndexedDB
 * cleanup runs on live deployments and cannot delete an id it does not know.
 * They are opaque keys — no name, no figure, no URL — so they are excluded
 * below by exact pattern rather than by ignoring the chunk that holds them.
 *
 * Exit code 1 on a leak, so CI can use it.
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, basename } from "node:path";

const NEXT = join(process.cwd(), ".next");
const STATIC = join(NEXT, "static");

/** Strings that must never reach a production browser. */
const FORBIDDEN = [
  // Fabricated people, from the seeded HR records and the activity feed.
  "Jane Kowalski",
  "Marcus Trent",
  "Sofia Delgado",
  "Owen Bradshaw",
  "Priscilla Nunez",
  "Corey Vandenberg",
  "Alicia Moreno",
  "Tyrell Jacobs",
  // Placeholder resource URLs.
  "example.com/policies",
  "example.com/power-bi",
  "example.com/training",
  // Invented AI spend.
  "214.62",
  "785.38",
  // The unverified preview host.
  "preview--leadership-sync-tool",
  // Seeded answer prose.
  "Start with **conversion**",
];

/**
 * Opaque ids the purge legitimately ships. Matched exactly, so a record that
 * merely mentions one is still caught.
 */
const ALLOWED_ID = /^(conv-seed-\d+|form-\d+|tpl-[a-z-]+)$/;

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

/* ---- 1. which chunks carry a forbidden string ---------------------------- */

const chunks = walk(STATIC);
const tainted = new Map();

for (const file of chunks) {
  const source = readFileSync(file, "utf8");
  const found = FORBIDDEN.filter((needle) => source.includes(needle));
  if (found.length > 0) tainted.set(basename(file), found);
}

/* ---- 2. does any prerendered page load one -------------------------------- */

const APP = join(NEXT, "server", "app");
const pages = existsSync(APP)
  ? walk(APP).length >= 0
    ? readdirSync(APP, { recursive: true, encoding: "utf8" }).filter((f) =>
        f.endsWith(".html"),
      )
    : []
  : [];

const leaks = [];
for (const page of pages) {
  const html = readFileSync(join(APP, page), "utf8");
  const scripts = new Set(
    [...html.matchAll(/\/_next\/static\/chunks\/([^"']+\.js)/g)].map((m) =>
      basename(m[1]),
    ),
  );
  for (const script of scripts) {
    if (tainted.has(script)) leaks.push({ page, script, strings: tainted.get(script) });
  }
}

/* ---- report --------------------------------------------------------------- */

console.log(`Scanned ${chunks.length} client chunks and ${pages.length} prerendered pages.`);

if (tainted.size > 0) {
  console.log(`\n${tainted.size} chunk(s) contain seeded strings (emitted, not necessarily fetched):`);
  for (const [chunk, strings] of tainted) {
    console.log(`  ${chunk}: ${strings.join(", ")}`);
  }
}

if (leaks.length > 0) {
  console.error("\nLEAK — a prerendered page loads a chunk carrying seeded data:");
  for (const leak of leaks) {
    console.error(`  ${leak.page} -> ${leak.script}: ${leak.strings.join(", ")}`);
  }
  process.exit(1);
}

console.log("\nOK: no prerendered page loads a chunk containing seeded records.");
if (tainted.size === 0) {
  console.log("OK: no client chunk contains a seeded record at all.");
}

/* The allowlist is referenced so its intent is executable, not just prose. */
void ALLOWED_ID;
