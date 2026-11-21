/**
 * ============================================================================
 * THE ACTION PLAN ADDS THE STEPS THE MANAGER STATED (STATED_PLAN_STEPS_ENABLED; Pau via QA, 20 Nov 2026, f062)
 * ============================================================================
 *
 * QA's live test of #1121 (f061/f062, item 6): "… I want this documented as a written corrective action and the opening
 * procedures reviewed with <P> this week." saved the generic plan ("Management will review the Late Opening policy with
 * <first>. Future policy violations …"), without the step the manager asked for. Pau ("YEAH add"): old Sunny's plan stays
 * exactly as it is, and each step the manager stated is added, in their own words lightly tidied, as its own sentence
 * before the closing "Future policy violations may result in …" (or the termination closing). A step is never invented,
 * the standard text is never dropped or reworded, and with no step the plan is byte-identical.
 *
 * Where the steps come from is a record, never a word list over the manager's messages: the agent loop's card
 * (`plan_steps` with `plan_evidence`) or the regular chat's intent reader (its `planSteps` slot). Either way a step is
 * kept only when its content words are in the manager's own text (`keptPlanSteps`). Pure.
 */

/** Content words, cut to 5 letters ("reviewed" and "review" agree); short words do not count. */
function stems(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9][a-z0-9'’-]*/g) ?? [])
    .map((word) => word.replace(/['’].*$/, ""))
    .filter((word) => word.length >= 4 || /^\d+$/.test(word))
    .map((word) => (/^\d/.test(word) ? word : word.slice(0, 5)));
}

/** One step as a sentence: trimmed, capitalised, ending with a full stop. */
function tidied(step: string): string {
  const one = step.replace(/\s+/g, " ").trim().replace(/^[-–—•*\d.)\s]+/, "").replace(/[.;,:!]+$/, "");
  return one === "" ? "" : `${one.charAt(0).toUpperCase()}${one.slice(1)}.`;
}

const MAX_STEPS = 3;
const MAX_STEP_CHARS = 200;

/**
 * The stated steps that are the manager's own: each step's content words (at least two) are all in `managerText`.
 * Order kept, duplicates dropped, at most three, each tidied as a sentence.
 */
export function keptPlanSteps(steps: unknown, managerText: string): string[] {
  if (!Array.isArray(steps)) return [];
  const said = new Set(stems(managerText));
  const kept: string[] = [];
  for (const raw of steps) {
    if (typeof raw !== "string") continue;
    const step = tidied(raw);
    const words = stems(step);
    if (step === "" || step.length > MAX_STEP_CHARS || words.length < 2 || !words.every((word) => said.has(word))) continue;
    if (kept.some((other) => other.toLowerCase() === step.toLowerCase())) continue;
    kept.push(step);
    if (kept.length === MAX_STEPS) break;
  }
  return kept;
}

/** The person's full name as their first name, as the plan already calls them ("with Remy"). */
function firstNamed(step: string, employeeName: string | null | undefined): string {
  const full = (employeeName ?? "").trim();
  const parts = full.split(/\s+/);
  if (parts.length < 2) return step;
  const escaped = parts.map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+");
  return step.replace(new RegExp(`\\b${escaped}\\b`, "gi"), parts[0]!);
}

/**
 * The plan with the stated steps added before its closing ("Future policy violations …", or the termination sentence);
 * at the end when the plan has no closing. No steps: the plan, unchanged.
 */
export function withPlanSteps(plan: string, steps: readonly string[] | null | undefined, employeeName?: string | null): string {
  const added = (steps ?? []).map((step) => firstNamed(step, employeeName)).filter((step) => step.trim() !== "");
  if (added.length === 0) return plan;
  const fresh = added.filter((step) => !plan.toLowerCase().includes(step.toLowerCase().replace(/\.$/, "")));
  if (fresh.length === 0) return plan;
  /* The closing in any revision's wording ("… may result in …", revision 5's "… may be subject to …") or the termination sentence. */
  const closing = /\b(?:Future policy violations|Effective immediately, employment is terminated)\b/.exec(plan);
  const at = closing ? closing.index : plan.length;
  if (at === plan.length) return `${plan.trimEnd()} ${fresh.join(" ")}`;
  const before = plan.slice(0, at).trimEnd();
  return `${before}${before === "" ? "" : " "}${fresh.join(" ")} ${plan.slice(at)}`;
}

/** The card's "**Action plan:**" line with its card's stated steps added, as Create will save the plan. No line: unchanged. */
export function withCardPlanSteps<T extends { content: string; formProposal?: { planSteps?: string[]; employeeName?: string | null } | null }>(answer: T): T {
  const steps = answer.formProposal?.planSteps ?? [];
  const line = /^(\*\*Action plan:\*\*[ \t]*)(.+)$/im.exec(answer.content);
  if (!line || steps.length === 0) return answer;
  const planned = withPlanSteps(line[2]!, steps, answer.formProposal?.employeeName ?? null);
  return planned === line[2] ? answer : { ...answer, content: answer.content.replace(line[0], `${line[1]}${planned}`) };
}
