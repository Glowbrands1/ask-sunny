#!/usr/bin/env node
/**
 * ============================================================================
 * OFF PINS HOLD UNDER PRODUCTION'S FLAGS (QA, 11 Nov 2026)
 * ============================================================================
 *
 * A test named for a flag's "off" behaviour ("off: …", "flag off …", "… as before off") must set that flag off itself
 * (`vi.stubEnv(FLAG, "")` or `delete process.env[FLAG]`). One that leaves it to the environment passes while the flag is
 * unset and fails the day QA turns it on in production-flags.json "on" — five gated fixes were held back that way in one
 * day. This runs every such test (by name) with production's flags set (`with-production-flags.mjs`):
 *
 * - a failure not in src/config/off-pins-known.json fails the job (a new test that does not pin its own flag);
 * - a known one that now passes is reported: take it off the list (`--update` rewrites the list from this run).
 *
 * The list is the tests that failed this way when the guard went in; it may only shrink.
 *
 *   node scripts/off-pins-guard.mjs [--update] [vitest args…]
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const KNOWN_FILE = join(ROOT, "src/config/off-pins-known.json");
/** The names that claim a flag's "off" behaviour. */
const OFF_NAME = String.raw`(^|[^A-Za-z-])off([:,)]| as before| —| -|$)|flags? (is |are )?off|_ENABLED off|with the flag off`;

const update = process.argv.includes("--update");
const passThrough = process.argv.slice(2).filter((arg) => arg !== "--update");
const out = join(mkdtempSync(join(tmpdir(), "off-pins-")), "results.json");

const run = spawnSync(
  process.execPath,
  [
    join(ROOT, "scripts/with-production-flags.mjs"),
    "npx",
    "vitest",
    "run",
    ...passThrough,
    "--exclude",
    "src/app/api/chat/replay-pack/**",
    "--exclude",
    "src/lib/ai/flags-off-parity.test.ts",
    "-t",
    OFF_NAME,
    "--reporter=dot",
    "--reporter=json",
    `--outputFile.json=${out}`,
  ],
  { stdio: "inherit", cwd: ROOT },
);
if (!existsSync(out)) {
  console.error(`off-pins: vitest wrote no results (exit ${run.status}).`);
  process.exit(1);
}

const results = JSON.parse(readFileSync(out, "utf8"));
const failed = new Set();
const passed = new Set();
for (const file of results.testResults ?? []) {
  const path = relative(ROOT, file.name);
  // A file that failed to load has no assertion results: the whole file is one entry.
  if ((file.assertionResults ?? []).length === 0 && file.status === "failed") failed.add(`${path}`);
  for (const test of file.assertionResults ?? []) {
    const key = `${path} > ${test.fullName}`;
    if (test.status === "failed") failed.add(key);
    else if (test.status === "passed") passed.add(key);
  }
}

const known = existsSync(KNOWN_FILE) ? JSON.parse(readFileSync(KNOWN_FILE, "utf8")).known : [];
if (update) {
  const next = [...failed].sort();
  writeFileSync(
    KNOWN_FILE,
    `${JSON.stringify({ _about: "scripts/off-pins-guard.mjs: tests named for a flag's off behaviour that fail with production's flags set. It may only shrink: fix a test by setting its own flag off (vi.stubEnv), then take it off.", known: next }, null, 2)}\n`,
  );
  console.log(`off-pins: wrote ${next.length} known entries.`);
  process.exit(0);
}

const knownSet = new Set(known);
const fresh = [...failed].filter((key) => !knownSet.has(key)).sort();
const healed = known.filter((key) => passed.has(key)).sort();
if (healed.length > 0) {
  console.log(`\noff-pins: ${healed.length} listed test(s) now hold with production's flags — take them off src/config/off-pins-known.json:`);
  for (const key of healed) console.log(`  ${key}`);
}
if (fresh.length > 0) {
  console.error(`\noff-pins: ${fresh.length} test(s) named for a flag's off behaviour fail with production's flags set.`);
  console.error("Set the flag the test is about off in the test itself (vi.stubEnv(\"<FLAG>_ENABLED\", \"\") or delete process.env[...]):");
  for (const key of fresh) console.error(`  ${key}`);
  process.exit(1);
}
console.log(`off-pins: no new failures (${failed.size} known, ${passed.size} passing).`);
