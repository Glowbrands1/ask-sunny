/**
 * One replay round, written to docs/scoreboard.md before the next round starts.
 *
 * Flags-off and flags-on are separate columns. A case passes only when every
 * run passes. Latency is the runs together, and over the gate is a failure.
 * A dropped first message that the harness re-sends is not a case failure.
 */

export const REPLAY_RUNS = 3;
/** Three local runs of one case. A confirm loop blows past this. */
export const REPLAY_LATENCY_GATE_MS = 20_000;

export interface ReplayCardCriteria {
  readonly employee: string | null;
  readonly salon: string | null;
  readonly date: string | null;
  readonly policy: string | null;
  readonly noBlockingQuestion: boolean;
  readonly noLeakedInternalText: boolean;
}

export interface ReplayCaseResult {
  readonly id: string;
  readonly pass: boolean;
  readonly ms: number;
  readonly failure?: string;
}

export interface PromptAb {
  readonly lastKnownGoodCommit: string;
  readonly lastKnownGoodFileHash: string;
  readonly currentBuiltHash: string;
  readonly lastKnownGoodBuiltHash: string;
  readonly promptsDiffer: boolean;
  /** None when the old prompt did not pass a case the current prompt failed. */
  readonly revert: string;
  readonly lastKnownGood: readonly ReplayCaseResult[];
}

export interface ReplayRound {
  readonly title: string;
  readonly replaySetHash: string;
  readonly promptHash: string;
  readonly commit: string;
  readonly model: string;
  readonly flags: readonly string[];
  readonly runs: number;
  readonly latencyGateMs: number;
  readonly criteria: readonly { readonly id: string; readonly criteria: ReplayCardCriteria }[];
  readonly flagsOff: readonly ReplayCaseResult[];
  readonly flagsOn: readonly ReplayCaseResult[];
  readonly promptAb?: PromptAb;
  readonly harnessEvents: readonly { readonly caseId: string; readonly event: string }[];
}

const BLOCKING_QUESTION =
  /did you mean|who is this|which employee|want to be sure before it goes on the form|reply with the number|^I still need\b/im;

const LEAKED_INTERNAL =
  /I cannot repair|does not appear on the employee roster|I cannot create this form|couldn'?t find \*\*|didn'?t find \*\*|employee list for your salons|not found in the roster/i;

export function latencyOverGate(ms: number, gateMs = REPLAY_LATENCY_GATE_MS): boolean {
  return ms > gateMs;
}

/** Card fields only. A null criterion was not part of the case and is not judged. */
export function judgeReplayCard(input: {
  readonly criteria: ReplayCardCriteria;
  readonly employeeName: string | null;
  readonly locationId: string | null;
  readonly formDate: string | null;
  readonly content: string;
  readonly policySatisfied: boolean;
}): string[] {
  const failures: string[] = [];
  const { criteria } = input;
  if (criteria.employee) {
    const name = input.employeeName ?? "";
    if (!new RegExp(`^${criteria.employee.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i").test(name)) {
      failures.push(`employee "${name}" is not "${criteria.employee}"`);
    }
  }
  if (criteria.salon && input.locationId !== criteria.salon) {
    failures.push(`salon "${input.locationId ?? ""}" is not "${criteria.salon}"`);
  }
  if (criteria.date && input.formDate !== criteria.date) {
    failures.push(`date "${input.formDate ?? ""}" is not "${criteria.date}"`);
  }
  if (criteria.policy && !input.policySatisfied) failures.push(`policy ${criteria.policy} is not on the card`);
  if (criteria.noBlockingQuestion && BLOCKING_QUESTION.test(input.content)) {
    failures.push("blocking question");
  }
  if (criteria.noLeakedInternalText && LEAKED_INTERNAL.test(input.content)) {
    failures.push("leaked internal text");
  }
  return failures;
}

/** Cases the old prompt passed and the current prompt failed. A tie is empty. */
export function casesWhereOldPromptScoresBetter(
  current: readonly ReplayCaseResult[],
  oldPrompt: readonly ReplayCaseResult[],
): string[] {
  const prior = new Map(oldPrompt.map((row) => [row.id, row]));
  return current.filter((row) => prior.get(row.id)?.pass === true && row.pass === false).map((row) => row.id);
}

function cell(result: ReplayCaseResult | undefined): string {
  if (!result) return "—";
  const mark = result.pass ? "PASS" : "FAIL";
  const detail = result.failure ? ` ${result.failure}` : "";
  return `${mark} ${result.ms}ms${detail}`;
}

function criteriaCell(criteria: ReplayCardCriteria): string {
  return [criteria.employee, criteria.salon, criteria.date, criteria.policy].map((value) => value ?? "—").join(" · ");
}

const SCOREBOARD_INTRO = `Each case runs ${REPLAY_RUNS} times and passes only when every run passes. Latency is those runs together and fails over ${REPLAY_LATENCY_GATE_MS} ms. Flags-off and flags-on are separate columns. Flags-on is judged on the card criteria in \`replay_set.json\`, written before the run: employee, salon, date, policy and printed page, no blocking question, no leaked internal text. A re-send of a dropped first message is a harness event, not a case failure. A last-known-good column is the same code and the same flags with the system prompt from before the latest prompt edit. The current prompt stays when it ties or wins. A case the old prompt passes and the current prompt fails is reverted in the prompt, and the fix stays in code.`;

/** One round, without the scoreboard title, so a later round can be appended. */
export function renderScoreboardRound(round: ReplayRound): string {
  const lines: string[] = [];
  lines.push(`## ${round.title}`, "");
  lines.push(`- replay_set.json sha256: \`${round.replaySetHash}\``);
  lines.push(`- prompts.ts sha256: \`${round.promptHash}\``);
  lines.push(`- commit: \`${round.commit}\``);
  lines.push(`- model: \`${round.model}\``);
  lines.push(`- flag set: \`${round.flags.join(", ")}\``);
  lines.push(`- runs: ${round.runs}`);
  lines.push(`- latency gate: ${round.latencyGateMs} ms`);
  if (round.promptAb) {
    lines.push(`- last-known-good prompt commit: \`${round.promptAb.lastKnownGoodCommit}\``);
    lines.push(`- last-known-good prompts.ts sha256: \`${round.promptAb.lastKnownGoodFileHash}\``);
    lines.push(`- built prompt sha256, current: \`${round.promptAb.currentBuiltHash}\``);
    lines.push(`- built prompt sha256, last-known-good: \`${round.promptAb.lastKnownGoodBuiltHash}\``);
    lines.push(`- prompt text differs: ${round.promptAb.promptsDiffer ? "yes" : "no"}`);
    lines.push(`- prompt revert: ${round.promptAb.revert}`);
  }
  lines.push("");
  const ab = round.promptAb ? new Map(round.promptAb.lastKnownGood.map((result) => [result.id, result])) : null;
  if (ab) {
    lines.push("| Case | Card criteria | Flags off | Current prompt | Last-known-good prompt |");
    lines.push("| --- | --- | --- | --- | --- |");
  } else {
    lines.push("| Case | Card criteria | Flags off | Flags on |");
    lines.push("| --- | --- | --- | --- |");
  }
  const off = new Map(round.flagsOff.map((result) => [result.id, result]));
  const on = new Map(round.flagsOn.map((result) => [result.id, result]));
  for (const item of round.criteria) {
    const cells = [item.id, criteriaCell(item.criteria), cell(off.get(item.id)), cell(on.get(item.id))];
    if (ab) cells.push(cell(ab.get(item.id)));
    lines.push(`| ${cells.join(" | ")} |`);
  }
  lines.push("");
  if (round.harnessEvents.length === 0) {
    lines.push("Harness events: none.");
  } else {
    const counts = new Map<string, number>();
    for (const event of round.harnessEvents) {
      const key = `${event.caseId}: ${event.event}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    lines.push("Harness events (not case failures):", "");
    for (const [key, count] of counts) lines.push(`- ${key}${count > 1 ? ` × ${count}` : ""}`);
  }
  return lines.join("\n");
}

export function renderScoreboard(rounds: readonly ReplayRound[]): string {
  const body = rounds.map((round) => renderScoreboardRound(round)).join("\n\n");
  return `# Replay scoreboard\n\n${SCOREBOARD_INTRO}\n\n${body}\n`;
}

/**
 * Guide v3, scored on the card. A rule that does not apply to the case is
 * left out, so it cannot make a column look worse. Latency is the three runs
 * together and is added by `judgeRulebookRuns`.
 */
export const RULEBOOK_RULE_ORDER = [
  "employee",
  "typed",
  "salon",
  "date",
  "policy",
  "plan",
  "amount",
  "blocking",
  "leaked",
  "latency",
] as const;

export type RulebookRule = (typeof RULEBOOK_RULE_ORDER)[number];

export type RulebookVerdict = "better" | "same" | "worse";

export interface RulebookSpec {
  readonly employee: string | null;
  readonly salon: string | null;
  /** A card is expected even when the salon is still unknown. */
  readonly cardExpected: boolean;
  readonly date: string | null;
  readonly policy: string | null;
  readonly expectPlan: boolean;
  /** Null skips the amount rule. `expect: null` means the field stays empty. */
  readonly amount: { readonly expect: string | null } | null;
}

export interface RulebookRun {
  readonly employeeName: string | null;
  readonly locationId: string | null;
  readonly formDate: string | null;
  readonly hasCard: boolean;
  /** Every turn, joined. Blocking questions and leaked text are read here. */
  readonly speech: string;
  /** The last turn. The plan and the policy citation are read here. */
  readonly cardText: string;
  readonly policySatisfied: boolean;
  readonly payrollDeductAmount: string | null;
}

const PLAN_TEXT =
  /Management will review\b[^]*?Future policy violations may result in additional corrective action[^.\n]*\./i;

export function normalizePayrollAmount(value: string | null | undefined): string | null {
  if (!value) return null;
  const compact = value.trim().replace(/\s+/g, "");
  const match = /^\$(\d{1,3}(?:,\d{3})*|\d+)(?:\.00)?$/.exec(compact);
  return match ? `$${match[1]}` : compact;
}

function exactName(actual: string | null, expected: string): boolean {
  const pattern = new RegExp(`^${expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");
  return pattern.test(actual ?? "");
}

/** The two-sentence plan, with no dollar amount inside it. */
export function twoSentencePlan(content: string): boolean {
  const plan = content.match(PLAN_TEXT)?.[0] ?? "";
  if (!plan) return false;
  const sentences = plan.split(/(?<=[.!?])\s+/).filter((sentence) => sentence.trim());
  return sentences.length === 2 && !/\$\s?\d/.test(plan);
}

/** Rules this one run missed. Latency is not included. */
export function judgeRulebookRun(spec: RulebookSpec, run: RulebookRun): RulebookRule[] {
  const missed: RulebookRule[] = [];
  if (spec.employee) {
    const kept = exactName(run.employeeName, spec.employee);
    if (!kept) {
      missed.push("employee", "typed");
    }
  }
  if (spec.salon) {
    if (!run.hasCard || run.locationId !== spec.salon) missed.push("salon");
  } else if (spec.cardExpected && !run.hasCard) {
    missed.push("salon");
  }
  if (spec.date && run.formDate !== spec.date) missed.push("date");
  if (spec.policy && !run.policySatisfied) missed.push("policy");
  if (spec.expectPlan && !twoSentencePlan(run.cardText)) missed.push("plan");
  if (spec.amount) {
    const actual = normalizePayrollAmount(run.payrollDeductAmount);
    const expected = normalizePayrollAmount(spec.amount.expect);
    if (actual !== expected) missed.push("amount");
  }
  if (BLOCKING_QUESTION.test(run.speech)) missed.push("blocking");
  if (LEAKED_INTERNAL.test(run.speech)) missed.push("leaked");
  return missed;
}

/** A rule misses when any of the three runs misses it. */
export function judgeRulebookRuns(spec: RulebookSpec, runs: readonly RulebookRun[], ms: number): RulebookRule[] {
  const missed = new Set<RulebookRule>();
  for (const run of runs) {
    for (const rule of judgeRulebookRun(spec, run)) missed.add(rule);
  }
  if (latencyOverGate(ms)) missed.add("latency");
  return RULEBOOK_RULE_ORDER.filter((rule) => missed.has(rule));
}

/**
 * Worse when NEW misses a rule OLD passed. Better when NEW passes something
 * OLD missed and misses nothing OLD passed. Otherwise the same.
 */
export function rulebookVerdict(oldMisses: readonly string[], newMisses: readonly string[]): RulebookVerdict {
  const oldSet = new Set(oldMisses);
  const worse = newMisses.some((rule) => !oldSet.has(rule));
  if (worse) return "worse";
  const better = oldMisses.some((rule) => !newMisses.includes(rule));
  return better ? "better" : "same";
}

export function rulebookCasesWorse(
  rows: readonly { readonly id: string; readonly verdict: RulebookVerdict }[],
): string[] {
  return rows.filter((row) => row.verdict === "worse").map((row) => row.id);
}

function missCell(misses: readonly string[]): string {
  return misses.length === 0 ? "pass" : misses.join(", ");
}

export interface RulebookScoreRow {
  readonly id: string;
  readonly oldMisses: readonly string[];
  readonly newMisses: readonly string[];
  readonly verdict: RulebookVerdict;
}

/** OLD is main with the flags off. NEW is this branch with the rulebook flags on. */
export function renderRulebookScoreboard(input: {
  readonly oldCommit: string;
  readonly newCommit: string;
  readonly runs: number;
  readonly rows: readonly RulebookScoreRow[];
}): string {
  const totals = { better: 0, same: 0, worse: 0 };
  for (const row of input.rows) totals[row.verdict] += 1;
  const lines = [
    "## Rulebook — old behaviour against guide v3",
    "",
    "OLD is `origin/main` as-is, flags off, the same turns and the same mocked reply. NEW is this branch with the rulebook flags on. The guide was not pasted over the system prompt. Each case runs 3 times. A rule misses if any run misses it. A rule that does not apply to the case is not scored. Worse means NEW misses a rule OLD passed, and that case is fixed before this pull request is ready.",
    "",
    `- OLD commit: \`${input.oldCommit}\``,
    `- NEW commit: \`${input.newCommit}\``,
    `- runs: ${input.runs}`,
    `- latency gate: ${REPLAY_LATENCY_GATE_MS} ms for the 3 runs together`,
    "- rules: employee on the card, typed name kept, salon does not gate the card, date, policy and printed page, 2-sentence plan, payroll amount only from the manager, no blocking question, no leaked text, latency",
    "",
    "| Case | OLD | NEW | Verdict |",
    "| --- | --- | --- | --- |",
  ];
  for (const row of input.rows) {
    lines.push(`| ${row.id} | ${missCell(row.oldMisses)} | ${missCell(row.newMisses)} | ${row.verdict} |`);
  }
  lines.push("");
  lines.push(`Totals: better ${totals.better}, same ${totals.same}, worse ${totals.worse}.`);
  lines.push("");
  return lines.join("\n");
}
