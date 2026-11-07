import { expect } from "vitest";

import { KEARNEY, replyMatchesDiff, savedForm, type ReplayCase } from "./cases";
import { STEP_B_REFUSAL_SCENARIOS, STEP_B_READER_FLAGS, type RefusalScenario } from "./nov7-step-b-refusals-scenarios";

/**
 * ============================================================================
 * STEP B'S TARGET — THE REAL "I HAVEN'T CHANGED THE <FORM>" REFUSALS (7 Nov)
 * ============================================================================
 *
 * QA (coding 5's brief): every turn in either app where production answered
 * "I haven't changed the <form> — everything on it is as it was.", in the
 * manager's exact words, people invented. The scenarios and their expected
 * outcomes are in `nov7-step-b-refusals-scenarios.ts`, shared with the LIVE
 * script (LIVE_SCENARIOS=step-b-refusals).
 *
 * The form-patch model is scripted by message (`t.patchReads`): what a model
 * reading the turn the way the real-AI trace did (6 Nov) returns. Everything
 * after it — the zod parse, the evidence checks, the reducer, the one writer,
 * the reload, the reply — is real. The answering model says what production's
 * did where the chat depends on it (`script.says`).
 *
 * Every turn after Create holds `replyMatchesDiff` (no "changed" without a
 * saved change). The last turn is the refused one; its expected outcome is
 * the scenario's `expect`.
 *
 * `fixFlags`: the four Step B flags and FORM_PATCH_READER_FIXES_ENABLED
 * (coding 5, default off). `status` is production's (Step B off).
 */

const OPEN_IN_PRODUCTION = "production answers \"I haven't changed the …\" (Step B is off; the revision path writes nothing)";

/** Production's outcome per case, from the run with production's flags (7 Nov 2026). */
const PRODUCTION_HOLDS = new Set<string>(["bub-date-question", "bub-name-redo", "sun-towel-nothing-said", "sun-msb-format"]);

/** Fix runs that still fail, and why (the path that owns the turn is not Step B's reader). */
const FIX_OPEN: Readonly<Record<string, string>> = {};

async function play(t: Parameters<ReplayCase["run"]>[0], scenario: RefusalScenario): Promise<void> {
  t.directory(scenario.roster);
  t.as("salon_director", KEARNEY);
  t.patchReads!(scenario.script.patch ?? {});
  if (scenario.script.draft || scenario.script.checked) t.draftWrites({ ...(scenario.script.draft ?? {}) }, scenario.script.checked ? { ...scenario.script.checked } : undefined);
  const thread = t.thread();
  const replies: string[] = [];
  let id: string | null = null;
  for (const step of scenario.steps) {
    if ("create" in step) {
      expect(thread.proposal, `${scenario.id}: no card to create`).toBeTruthy();
      id = await thread.create();
      continue;
    }
    t.modelSays(scenario.script.says?.[step.say] ?? null);
    const before = id ? savedForm(t, id) : null;
    const reply = await thread.say(step.say);
    replies.push(reply.content);
    if (id && before !== null) replyMatchesDiff(t, id, before, reply, step.say);
  }
  t.modelSays(null);
  expect(id, `${scenario.id}: Create made no form`).not.toBeNull();
  const why = scenario.expect.check({
    card: thread.proposal ? { templateKey: thread.proposal.templateKey ?? null, employeeName: thread.proposal.employeeName ?? null } : null,
    reply: replies.at(-1) ?? "",
    replies,
    turnCards: [],
    flagsOn: [],
    saved: t.values(id!),
    checked: t.checked(id!),
    error: null,
  } as never);
  expect(why, `${scenario.id} — expected: ${scenario.expect.says}\nlast reply: ${(replies.at(-1) ?? "").slice(0, 300)}`).toBeNull();
}

export const NOV7_STEP_B_REFUSAL_CASES: readonly ReplayCase[] = STEP_B_REFUSAL_SCENARIOS.map(
  (scenario): ReplayCase => ({
    id: `nov7-refusal-${scenario.id}`,
    title: `"${scenario.refused}" — ${scenario.expect.says}`,
    report: scenario.report,
    status: PRODUCTION_HOLDS.has(scenario.id) ? "fixed" : { open: OPEN_IN_PRODUCTION },
    fixFlags: [...STEP_B_READER_FLAGS],
    ...(FIX_OPEN[scenario.id] ? { fixStatus: { open: FIX_OPEN[scenario.id]! } } : {}),
    run: (t) => play(t, scenario),
  }),
);
