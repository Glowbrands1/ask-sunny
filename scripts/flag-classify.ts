/**
 * ============================================================================
 * WHICH TESTS A FLAG CHANGES, AND WHY (QA CONDITION 6; dev only, no network)
 * ============================================================================
 *
 *   node scripts/flag-classify.ts [--flag NAME] [--with NAME,...] [--and NAME,...] [--runs 3] [--keep] [path ...]
 *
 * `--and` names flags turned on WITH the flag, in the "on" mode only: the
 * flags flipped together (QA, 4 Nov 2026: FORM_NAME_FROM_ROSTER_ENABLED and
 * CA_SALES_POLICY_ENABLED flip together), against a baseline with all of them
 * off. The results go to `<FLAG>+<AND…>.md` / `.classes.json`.
 *
 * `--with` names flags turned on in BOTH modes — the flags the flag under
 * test needs (FORM_EDIT_TOOL_IN_STREAM_ENABLED needs
 * FORM_EDIT_SINGLE_WRITER_ENABLED), so only the flag's own change is diffed.
 *
 * Runs `vitest run --reporter=json` RUNS times with the flag off and RUNS
 * times with it on, each as a child process with a clean environment (only
 * PATH, HOME, TMPDIR, LANG; no keys, so nothing can reach a model or a
 * database), then:
 *
 *   1. diffs the failing test ids between off and on — a test whose result
 *      differs between runs of the SAME mode is FLAKY;
 *   2. diffs the replay pack's records (each case's replies and claimed keys,
 *      `REPLAY_RECORD`), so a behaviour change in a case that still passes is
 *      seen too;
 *   3. classifies every changed test from `docs/flag-classification/<FLAG>.classes.json`
 *      (test id → category, twin test, reason). Categories: INTENDED (needs a
 *      flag-off twin that pins the old behaviour), INTENDED-HARNESS (the test
 *      spied on the old writer), REGRESSION (fix the code), FLAKY (3-run
 *      evidence, automatic), UNCLASSIFIED (anything not in the file);
 *   4. writes `docs/flag-classification/<FLAG>.md` (test | off | on |
 *      category | twin | reason) and exits non-zero if anything is
 *      UNCLASSIFIED.
 *
 * Paths default to the whole suite. `src/lib/ai/flags-off-parity.test.ts` is
 * left out: it re-runs the suites itself with every flag forced off.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

type Category = "INTENDED" | "INTENDED-HARNESS" | "REGRESSION" | "FLAKY" | "UNCLASSIFIED";
interface Classified {
  readonly category: Exclude<Category, "FLAKY" | "UNCLASSIFIED">;
  readonly twin?: string;
  readonly reason: string;
}
interface Row {
  readonly test: string;
  readonly off: string;
  readonly on: string;
  readonly category: Category;
  readonly twin: string;
  readonly reason: string;
}
interface ReplayRecord {
  readonly id: string;
  readonly mode: string;
  readonly ok: boolean;
  readonly error: string | null;
  readonly ms: number;
  readonly turns: readonly { question: string; reply: string; updated: string[] | null }[];
}

function argument(name: string): string | null {
  const at = process.argv.indexOf(name);
  return at >= 0 ? (process.argv[at + 1] ?? null) : null;
}

const FLAG = argument("--flag") ?? "FORM_EDIT_SINGLE_WRITER_ENABLED";
const RUNS = Number(argument("--runs") ?? "3");
const WITH = (argument("--with") ?? "").split(",").map((name) => name.trim()).filter((name) => name !== "");
const AND = (argument("--and") ?? "").split(",").map((name) => name.trim()).filter((name) => name !== "");
const KEEP = process.argv.includes("--keep");
const PATHS = process.argv.slice(2).filter((value, index, all) => !value.startsWith("--") && !["--flag", "--runs", "--with", "--and"].includes(all[index - 1] ?? ""));
const DOCS = join("docs", "flag-classification");
/** The doc's name: the flag, and any flags flipped with it (`--and`). */
const NAME = [FLAG, ...AND].join("+");
const CLASSES = join(DOCS, `${NAME}.classes.json`);
const OUT = join(DOCS, `${NAME}.md`);

/** One child run: the failing ids, every id's status, and the replay records. */
function run(mode: "off" | "on", index: number, scratch: string): { statuses: Map<string, string>; replay: ReplayRecord[]; seconds: number } {
  const report = join(scratch, `${mode}-${index}.json`);
  const replay = join(scratch, `${mode}-${index}.replay.jsonl`);
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    TMPDIR: process.env.TMPDIR ?? tmpdir(),
    LANG: process.env.LANG ?? "C.UTF-8",
    NODE_ENV: "test",
    REPLAY_RECORD: replay,
    ...Object.fromEntries(WITH.map((name) => [name, "true"])),
    ...(WITH.length > 0 ? { FLAG_CLASSIFY_ON: WITH.join(",") } : {}),
    ...(mode === "on" ? { [FLAG]: "true", ...Object.fromEntries(AND.map((name) => [name, "true"])), FLAG_CLASSIFY_ON: [...WITH, FLAG, ...AND].join(",") } : {}),
  };
  const started = Date.now();
  const child = spawnSync(
    process.execPath,
    [
      "node_modules/vitest/vitest.mjs",
      "run",
      "--reporter=json",
      `--outputFile=${report}`,
      "--exclude",
      "src/lib/ai/flags-off-parity.test.ts",
      "--exclude",
      "**/node_modules/**",
      ...PATHS,
    ],
    { env, encoding: "utf8", stdio: ["ignore", "ignore", "pipe"], maxBuffer: 512 * 1024 * 1024 },
  );
  const seconds = Math.round((Date.now() - started) / 1000);
  if (!existsSync(report)) throw new Error(`vitest wrote no report (${mode} ${index}, exit ${child.status}): ${child.stderr.slice(-2000)}`);
  const parsed = JSON.parse(readFileSync(report, "utf8")) as {
    testResults: { name: string; status: string; message?: string; assertionResults: { fullName: string; status: string }[] }[];
  };
  const statuses = new Map<string, string>();
  for (const file of parsed.testResults) {
    const name = file.name.startsWith(process.cwd()) ? file.name.slice(process.cwd().length + 1) : file.name;
    // A file that fails to load reports no tests: count it as one failing id.
    if (file.assertionResults.length === 0 && file.status === "failed") statuses.set(`${name} :: (file failed to load)`, "failed");
    for (const test of file.assertionResults) statuses.set(`${name} :: ${test.fullName}`, test.status);
  }
  const records = existsSync(replay)
    ? readFileSync(replay, "utf8")
        .split("\n")
        .filter((line) => line.trim() !== "")
        .map((line) => JSON.parse(line) as ReplayRecord)
    : [];
  return { statuses, replay: records, seconds };
}

function pattern(results: readonly Map<string, string>[], id: string): string {
  const seen = results.map((result) => result.get(id) ?? "absent");
  return [...new Set(seen)].length === 1 ? seen[0]! : seen.join("/");
}

function replayKey(record: ReplayRecord): string {
  return `${record.id} [${record.mode}]`;
}

function replayShape(record: ReplayRecord | undefined): string {
  if (!record) return "absent";
  return JSON.stringify({ ok: record.ok, turns: record.turns });
}

function main(): void {
  mkdirSync(DOCS, { recursive: true });
  const scratch = mkdtempSync(join(tmpdir(), "flag-classify-"));
  const off: ReturnType<typeof run>[] = [];
  const on: ReturnType<typeof run>[] = [];
  for (let index = 1; index <= RUNS; index += 1) {
    for (const [mode, into] of [["off", off], ["on", on]] as const) {
      const result = run(mode, index, scratch);
      into.push(result);
      process.stderr.write(`${mode} run ${index}: ${result.statuses.size} tests, ${[...result.statuses.values()].filter((status) => status === "failed").length} failing, ${result.seconds}s\n`);
    }
  }

  const classes: Record<string, Classified> = existsSync(CLASSES) ? (JSON.parse(readFileSync(CLASSES, "utf8")) as Record<string, Classified>) : {};
  const rows: Row[] = [];
  const offStatuses = off.map((result) => result.statuses);
  const onStatuses = on.map((result) => result.statuses);
  const ids = [...new Set([...offStatuses, ...onStatuses].flatMap((statuses) => [...statuses.keys()]))].sort();
  for (const id of ids) {
    const was = pattern(offStatuses, id);
    const now = pattern(onStatuses, id);
    if (was === now) continue;
    const flaky = was.includes("/") || now.includes("/");
    const known = classes[id];
    rows.push({
      test: id,
      off: was,
      on: now,
      category: flaky ? "FLAKY" : (known?.category ?? "UNCLASSIFIED"),
      twin: known?.twin ?? "",
      reason: flaky ? `differs between runs of the same mode${known ? `; ${known.reason}` : ""}` : (known?.reason ?? ""),
    });
  }

  /* The replay pack's records: the same case, off against on. */
  const byKey = (records: readonly ReplayRecord[]) => new Map(records.map((record) => [replayKey(record), record]));
  const offReplay = off.map((result) => byKey(result.replay));
  const onReplay = on.map((result) => byKey(result.replay));
  const replayKeys = [...new Set([...offReplay, ...onReplay].flatMap((records) => [...records.keys()]))].sort();
  const ms = { off: 0, on: 0 };
  for (const key of replayKeys) {
    ms.off += offReplay[0]?.get(key)?.ms ?? 0;
    ms.on += onReplay[0]?.get(key)?.ms ?? 0;
    const offShapes = new Set(offReplay.map((records) => replayShape(records.get(key))));
    const onShapes = new Set(onReplay.map((records) => replayShape(records.get(key))));
    const flaky = offShapes.size > 1 || onShapes.size > 1;
    if (!flaky && [...offShapes][0] === [...onShapes][0]) continue;
    const test = `replay: ${key}`;
    const known = classes[test];
    const first = (records: Map<string, ReplayRecord>[]) => records[0]?.get(key);
    const describe = (record: ReplayRecord | undefined) => (record ? `${record.ok ? "holds" : "fails"}, ${record.turns.length} turns` : "absent");
    rows.push({
      test,
      off: describe(first(offReplay)),
      on: `${describe(first(onReplay))}; replies differ`,
      category: flaky ? "FLAKY" : (known?.category ?? "UNCLASSIFIED"),
      twin: known?.twin ?? "",
      reason: flaky ? "the replies differ between runs of the same mode" : (known?.reason ?? ""),
    });
  }

  /* A REGRESSION classified earlier and fixed since: listed, so the table keeps its record. */
  const listed = new Set(rows.map((row) => row.test));
  for (const [test, known] of Object.entries(classes)) {
    if (known.category !== "REGRESSION" || listed.has(test)) continue;
    rows.push({ test, off: "passed", on: "passed (fixed)", category: "REGRESSION", twin: known.twin ?? "", reason: known.reason });
  }

  const counts = new Map<Category, number>();
  for (const row of rows) counts.set(row.category, (counts.get(row.category) ?? 0) + 1);
  const cell = (text: string) => text.split("|").join("\\|").split("\n").join(" ");
  const lines = [
    `# ${NAME}: which tests ${AND.length > 0 ? "they change" : "it changes"}, and why`,
    "",
    `Written by \`node scripts/flag-classify.ts\` (${RUNS} runs off, ${RUNS} on, each a child process with a clean env${WITH.length > 0 ? `; on in both: ${WITH.map((name) => `\`${name}\``).join(", ")}` : ""}${AND.length > 0 ? `; on together with ${FLAG} in the on runs only: ${AND.map((name) => `\`${name}\``).join(", ")}` : ""}). Paths: ${PATHS.length > 0 ? PATHS.map((path) => `\`${path}\``).join(", ") : "the whole suite"}. Classifications are kept in \`${CLASSES}\`.`,
    "",
    `Tests run: ${ids.length}. Changed: ${rows.length}. ${(["INTENDED", "INTENDED-HARNESS", "REGRESSION", "FLAKY", "UNCLASSIFIED"] as const).map((category) => `${category} ${counts.get(category) ?? 0}`).join(", ")}.`,
    "",
    `Replay pack, first run, all cases: ${ms.off} ms off, ${ms.on} ms on (stubbed models; ${replayKeys.length} records).`,
    "",
    "| test | off | on | category | twin | reason |",
    "| --- | --- | --- | --- | --- | --- |",
    ...rows.map((row) => `| ${cell(row.test)} | ${cell(row.off)} | ${cell(row.on)} | ${row.category} | ${cell(row.twin)} | ${cell(row.reason)} |`),
    "",
  ];
  writeFileSync(OUT, lines.join("\n"));
  if (!KEEP) rmSync(scratch, { recursive: true, force: true });
  else process.stderr.write(`kept ${scratch}\n`);
  process.stderr.write(`wrote ${OUT}: ${rows.length} changed\n`);
  if ((counts.get("UNCLASSIFIED") ?? 0) > 0) {
    process.stderr.write(`${counts.get("UNCLASSIFIED")} UNCLASSIFIED: classify them in ${CLASSES}\n`);
    process.exitCode = 1;
  }
}

main();
