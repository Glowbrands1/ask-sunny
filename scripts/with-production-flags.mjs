#!/usr/bin/env node
/**
 * Runs a command with every flag in src/config/production-flags.json "on" set to "true" in its environment (and every
 * flag in "off" set to "off"), as production runs. CI's "unit-tests-production-flags" job runs the unit tests this way:
 * a test that says what a flag does "off" must set that flag off itself, or it passes only while the flag is unset and
 * fails the day QA turns the flag on (QA, 11 Nov 2026: four gated fixes held back, and a release e2e).
 *
 *   node scripts/with-production-flags.mjs npx vitest run --project unit
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const flags = JSON.parse(readFileSync(new URL("../src/config/production-flags.json", import.meta.url), "utf8"));
const env = { ...process.env };
for (const name of flags.off ?? []) env[name] = "off";
for (const name of flags.on ?? []) env[name] = "true";

const [command, ...args] = process.argv.slice(2);
if (!command) {
  console.error("usage: node scripts/with-production-flags.mjs <command> [args…]");
  process.exit(2);
}
const run = spawnSync(command, args, { stdio: "inherit", env, shell: false });
process.exit(run.status ?? 1);
