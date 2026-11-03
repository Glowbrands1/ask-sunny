import type { ChatFormProposal } from "@/types";

/**
 * The pure half of the replay eval: the case shape, the judge, the baseline
 * comparison and the latency summary. No mocks and no I/O, so the judge itself
 * is tested in `replay-harness.test.ts`.
 */

/**
 * The card a case must end on. A null field, or a false check, was not part of
 * the case and is not judged — the same shape as
 * `ReplayCardCriteria` (`src/lib/ai/replay-scoreboard.ts`).
 */
export interface EvalCriteria {
  readonly employee: string | null;
  /** The `loc-<salon number>` id of the salon on the card. */
  readonly salon: string | null;
  /** The card's Date, ISO. */
  readonly date: string | null;
  /** "<manual heading> p.<printed page>", read off the reply or the card. */
  readonly policy: string | null;
  readonly noBlockingQuestion: boolean;
  readonly noLeakedInternalText: boolean;
  /** Words the last reply must contain (each, case-insensitive). Optional. */
  readonly replyIncludes?: readonly string[];
  /** Words the last reply must not contain (each, case-insensitive). Optional. */
  readonly replyExcludes?: readonly string[];
}

/** One person on the Woven-synced directory, for a case that needs a roster. */
export interface EvalRosterPerson {
  readonly id: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly preferredFirstName?: string | null;
  readonly employmentStatus?: string;
  readonly positionName?: string | null;
  /** Woven's employee id (`external_employee_id`); defaults to `woven-<id>`. */
  readonly wovenEmployeeId?: string;
  /** `loc-<code>` ids. */
  readonly locationIds: readonly string[];
}

export interface EvalCase {
  readonly id: string;
  readonly source?: string;
  readonly turns: readonly string[];
  readonly criteria: EvalCriteria;
  readonly today?: string;
  readonly roster?: readonly EvalRosterPerson[];
  readonly actor?: { readonly role: string; readonly scope: Record<string, unknown> };
  /** Flags this case needs on in BOTH columns (a feature the case exercises), on top of production. */
  readonly flags?: readonly string[];
  /** What the reporter expected, in prose. Informational only: never judged. */
  readonly expected?: string;
}

export interface EvalResult {
  readonly id: string;
  readonly pass: boolean;
  /** Every criterion that missed, in a fixed order. Empty on a pass. */
  readonly misses: readonly string[];
  /** What the card ended as, so a baseline diff shows what changed. */
  readonly card: {
    readonly employee: string | null;
    readonly salon: string | null;
    readonly date: string | null;
    readonly status: string | null;
  };
  readonly ms: number;
}

export interface EvalFlags {
  /** Today's production flags: on in BOTH columns, so flags off is today's app. */
  readonly production: readonly string[];
  /** Flags turned on for the ON run only. The step's own flag goes here. */
  readonly on: readonly string[];
}

function flagList(value: unknown, key: string): string[] {
  if (!Array.isArray(value) || !value.every((flag) => typeof flag === "string" && /^[A-Z0-9_]+$/.test(flag))) {
    throw new Error(`evals/flags.json "${key}" must be a list of flag names`);
  }
  return value;
}

export function readEvalFlags(raw: unknown): EvalFlags {
  const input = (raw ?? {}) as { production?: unknown; on?: unknown };
  const production = flagList(input.production ?? [], "production");
  const on = flagList(input.on, "on");
  const both = on.filter((flag) => production.includes(flag));
  if (both.length) throw new Error(`evals/flags.json: ${both.join(", ")} cannot be both production and the step's flag`);
  return { production, on };
}

/**
 * Sets one run's flags and returns the restore: the production flags on in
 * both columns, the step's flags on only in ON. OFF clears the step's flags,
 * so one exported in the shell cannot leak into the flags-off column.
 */
export function modeFlags(flags: EvalFlags, mode: "off" | "on"): () => void {
  const saved = new Map<string, string | undefined>();
  for (const flag of [...flags.production, ...flags.on]) saved.set(flag, process.env[flag]);
  for (const flag of flags.production) process.env[flag] = "true";
  for (const flag of flags.on) {
    if (mode === "on") process.env[flag] = "true";
    else delete process.env[flag];
  }
  return () => {
    for (const [flag, value] of saved) {
      if (value === undefined) delete process.env[flag];
      else process.env[flag] = value;
    }
  };
}

/**
 * The four directory tables the roster reads (`readDirectoryRoster`), built from
 * a case's people: Woven location → `salons.id` → `loc-<salon_number>`.
 */
export function rosterTables(people: readonly EvalRosterPerson[]): Record<string, Record<string, unknown>[]> {
  const directory: Record<string, unknown>[] = [];
  const affiliations: Record<string, unknown>[] = [];
  const salons = new Set<string>();
  for (const person of people) {
    directory.push({
      id: person.id,
      external_employee_id: person.wovenEmployeeId ?? `woven-${person.id}`,
      first_name: person.firstName,
      last_name: person.lastName,
      preferred_first_name: person.preferredFirstName ?? null,
      employment_status: person.employmentStatus ?? "active",
      position_name: person.positionName ?? null,
      last_synced_at: "2026-11-02T11:18:00Z",
    });
    for (const location of person.locationIds) {
      salons.add(location);
      affiliations.push({ employee_id: person.id, woven_location_id: `woven-${location}`, active: true });
    }
  }
  return {
    employee_access_directory: directory,
    employee_location_affiliations: affiliations,
    woven_location_map: [...salons].map((location) => ({ woven_location_id: `woven-${location}`, salon_id: `salon-${location}`, status: "mapped" })),
    salons: [...salons].map((location) => ({ id: `salon-${location}`, salon_number: location.replace(/^loc-/, "") })),
  };
}

/*
 * The same two checks Ask Sunny's replay scoreboard reads: a question that
 * blocks the card, and the app's own internal wording reaching a manager.
 */
const BLOCKING_QUESTION =
  /did you mean|who is this|which employee|want to be sure before it goes on the form|reply with the number|^I still need\b/im;
const LEAKED_INTERNAL =
  /I cannot repair|does not appear on the employee roster|I cannot create this form|couldn'?t find \*\*|didn'?t find \*\*|employee list for your salons|not found in the roster/i;

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** "Late Opening p.15" is met when the reply or the card names the heading and its page. */
function policyShown(policy: string, text: string): boolean {
  const match = /^(.*)\s+p\.(\d+)$/.exec(policy.trim());
  if (!match) return new RegExp(escape(policy), "i").test(text);
  const [, heading, page] = match;
  return new RegExp(escape(heading!), "i").test(text) && new RegExp(String.raw`\bp(?:age|\.)?\s*${page}\b`, "i").test(text);
}

export function judgeCase(input: {
  item: EvalCase;
  proposal: ChatFormProposal | null;
  lastReply: string;
  error: string | null;
  ms: number;
}): EvalResult {
  const { item, proposal, lastReply, error, ms } = input;
  const criteria = item.criteria;
  const misses: string[] = [];
  if (error) misses.push(`error: ${error.split("\n")[0]!.trim()}`);
  if (criteria.employee !== null && (proposal?.employeeName ?? "").trim().toLowerCase() !== criteria.employee.toLowerCase()) {
    misses.push("employee");
  }
  if (criteria.salon !== null && proposal?.locationId !== criteria.salon) misses.push("salon");
  if (criteria.date !== null && proposal?.formDate !== criteria.date) misses.push("date");
  if (criteria.policy !== null) {
    const text = [lastReply, proposal?.issue ?? ""].join("\n");
    if (!policyShown(criteria.policy, text)) misses.push("policy");
  }
  if (criteria.noBlockingQuestion && BLOCKING_QUESTION.test(lastReply)) misses.push("blocking question");
  if (criteria.noLeakedInternalText && LEAKED_INTERNAL.test(lastReply)) misses.push("leaked internal text");
  for (const word of criteria.replyIncludes ?? []) {
    if (!lastReply.toLowerCase().includes(word.toLowerCase())) misses.push(`reply lacks "${word}"`);
  }
  for (const word of criteria.replyExcludes ?? []) {
    if (lastReply.toLowerCase().includes(word.toLowerCase())) misses.push(`reply has "${word}"`);
  }
  return {
    id: item.id,
    pass: misses.length === 0,
    misses,
    card: {
      employee: proposal?.employeeName ?? null,
      salon: proposal?.locationId ?? null,
      date: proposal?.formDate ?? null,
      status: proposal?.status ?? null,
    },
    ms,
  };
}

/** Nearest-rank percentile of the per-case times. */
function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))]!;
}

export function latencySummary(results: readonly EvalResult[]) {
  const ms = results.map((result) => result.ms);
  return { p50: percentile(ms, 50), p95: percentile(ms, 95), total: ms.reduce((sum, value) => sum + value, 0) };
}

/** The run with the median time. */
export function medianRun(runs: readonly EvalResult[]): EvalResult {
  const sorted = [...runs].sort((a, b) => a.ms - b.ms);
  return sorted[Math.floor((sorted.length - 1) / 2)]!;
}

/** The part of a result a baseline records: everything but the time. */
export function withoutTime(result: EvalResult): Omit<EvalResult, "ms"> {
  return { id: result.id, pass: result.pass, misses: result.misses, card: result.card };
}

function stable(result: Omit<EvalResult, "ms">): string {
  return JSON.stringify({ id: result.id, pass: result.pass, misses: result.misses, card: result.card });
}

export function compareToBaseline(
  baseline: readonly Omit<EvalResult, "ms">[],
  off: readonly EvalResult[],
  on: readonly EvalResult[],
): { offChanged: string[]; onBroke: string[] } {
  const offChanged: string[] = [];
  const recorded = new Map(baseline.map((result) => [result.id, result]));
  for (const result of off) {
    const before = recorded.get(result.id);
    if (!before) offChanged.push(`${result.id}: not in the baseline`);
    else if (stable(before) !== stable(result)) offChanged.push(`${result.id}: was ${stable(before)} now ${stable(result)}`);
  }
  for (const id of recorded.keys()) {
    if (!off.some((result) => result.id === id)) offChanged.push(`${id}: in the baseline, not replayed`);
  }
  const onBroke = off
    .filter((result) => result.pass)
    .filter((result) => !on.find((other) => other.id === result.id)?.pass)
    .map((result) => `${result.id}: ${on.find((other) => other.id === result.id)?.misses.join(", ") ?? "not replayed"}`);
  return { offChanged, onBroke };
}

/**
 * At most 25% slower with the flags on, over all cases together. The replay
 * is in memory, so a case takes milliseconds and scheduling noise alone can be
 * 25% of that; 100 ms over the whole set is allowed on top as that noise floor.
 */
export const SPEED_LIMIT = 1.25;
export const SPEED_NOISE_MS = 100;

export function speedVerdict(off: readonly EvalResult[], on: readonly EvalResult[]): { ok: boolean; detail: string } {
  const a = latencySummary(off);
  const b = latencySummary(on);
  const ok = b.total <= a.total * SPEED_LIMIT + SPEED_NOISE_MS;
  return {
    ok,
    detail: `flags on ${b.total} ms vs off ${a.total} ms in total (p50 ${b.p50}/${a.p50} ms, p95 ${b.p95}/${a.p95} ms)`,
  };
}

export function renderTable(off: readonly EvalResult[], on: readonly EvalResult[], flags: readonly string[]): string {
  const lines = [
    `Replay eval — flags on: ${flags.length ? flags.join(", ") : "(none)"}`,
    "| Case | Flags off | Flags on |",
    "|---|---|---|",
  ];
  const cell = (result: EvalResult | undefined) =>
    !result ? "—" : result.pass ? `PASS ${result.ms}ms` : `FAIL (${result.misses.join(", ")}) ${result.ms}ms`;
  for (const result of off) lines.push(`| ${result.id} | ${cell(result)} | ${cell(on.find((other) => other.id === result.id))} |`);
  const a = latencySummary(off);
  const b = latencySummary(on);
  lines.push(`Latency p50/p95 off ${a.p50}/${a.p95} ms, on ${b.p50}/${b.p95} ms; total off ${a.total} ms, on ${b.total} ms.`);
  return lines.join("\n");
}
