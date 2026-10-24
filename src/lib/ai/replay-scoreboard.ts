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
