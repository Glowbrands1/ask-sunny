import { expect } from "vitest";

import { KEARNEY, replyMatchesDiff, savedForm, type ReplayCase } from "./cases";
import { CASH, ROOM_PROCESS, ROOM_STEPS, STEP_B_REFUSAL_SCENARIOS, STEP_B_READER_FLAGS, SUN_LATE, SUN_MEETING, SUN_TOWEL, SUN_YES, patch, type RefusalScenario } from "./nov7-step-b-refusals-scenarios";

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
const PRODUCTION_HOLDS = new Set<string>(["bub-date-question", "bub-name-redo", "sun-towel-nothing-said", "sun-msb-format", "sun-make-that-update-live-shape", "sun-monthly-meeting-drift", "sun-late-date-drift"]);

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
    const revision = scenario.script.revisionFrom?.[step.say];
    if (revision) t.revisionWrites(revision);
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

/*
 * QA'S LIVE SHAPES (claude-sonnet-5, 7 Nov 2026), replay only: the reader's output and the old revision
 * model's write as the live run showed them, so the two regressions it found are pinned.
 *   sun-yes-do-that: "yes, do that" read as the same sentence again; with the fallback, the old revision
 *     rewrote the form and said "Updated" (a claim nobody asked for).
 *   sun-make-that-update: the process she gave saved as a shorter summary without the fresh towel.
 */
const byId = (id: string) => STEP_B_REFUSAL_SCENARIOS.find((scenario) => scenario.id === id)!;
const LIVE_SHAPES: readonly RefusalScenario[] = [
  {
    ...byId("sun-yes-do-that"),
    id: "sun-yes-do-that-live-shape",
    script: {
      patch: {
        [CASH]: patch("this_form", [{ field: "coaching_details", value: "Reminded her to call a manager for any cash drawer shortage.", how: "add", evidence: "reminded her to call a manager for any cash drawer shortage" }]),
        [SUN_YES]: patch("this_form", [{ field: "coaching_details", value: "Reminded her to call a manager for any cash drawer shortage.", how: "add", evidence: "Reminded her to call a manager for any cash drawer shortage" }]),
      },
      revisionFrom: {
        [SUN_YES]: { coaching_details: "Reminded her to call a manager for any cash drawer shortage.\nReminded her to call a manager for any cash drawer shortage." },
      },
    },
  },
  /*
   * QA's re-run (7 Nov 2026, sonnet-5, patch on Haiku): the reader found nothing to write in "add details about the
   * towel" and "yes, do that"; the old revision then wrote the instruction ("Observed: Add details about the
   * towel.") and the reminder a second time.
   */
  {
    ...byId("sun-towel-nothing-said"),
    id: "sun-towel-nothing-said-live-shape",
    script: {
      patch: { [SUN_TOWEL]: patch("this_form") },
      revisionFrom: { [SUN_TOWEL]: { coaching_details: "Observed:\nAdd details about the towel." } },
    },
  },
  {
    ...byId("sun-yes-do-that"),
    id: "sun-yes-do-that-empty-reading",
    script: {
      patch: {
        [CASH]: patch("this_form", [{ field: "coaching_details", value: "Reminded her to call a manager for any cash drawer shortage.", how: "add", evidence: "reminded her to call a manager for any cash drawer shortage" }]),
        [SUN_YES]: patch("this_form"),
      },
      revisionFrom: {
        [SUN_YES]: { coaching_details: "Reminded her to call a manager for any cash drawer shortage.\nReminded her to call a manager for any cash drawer shortage." },
      },
    },
  },
  /*
   * QA's run 4 (7 Nov 2026): "make it for/about X" written as text about the form, none of her words in it.
   * Refused (the evidence's words are not in the value); the old path then takes the turn, as OFF passed.
   */
  {
    ...byId("sun-monthly-meeting"),
    id: "sun-monthly-meeting-drift",
    // QA: the account is her X, or nothing is written (the old path's honest reply); never text about the form.
    expect: {
      says: "the drift (text about the form) is never written and nothing is claimed; her X is written, or the old refusal stands",
      check: (run) =>
        /addressed the attendance policy/i.test(run.saved.coaching_details ?? "")
          ? `the drift was written: "${(run.saved.coaching_details ?? "").slice(0, 120)}"`
          : /\b(?:updated|changed)\b/i.test(run.reply) && !/haven't changed|didn't change/i.test(run.reply)
            ? `a change is claimed: "${run.reply.slice(0, 120)}"`
            : null,
    },
    script: {
      patch: {
        [SUN_MEETING]: patch("this_form", [
          { field: "coaching_details", value: "Observed:\nThis coaching session with Perrin addressed the attendance policy. No specific incident was described.", how: "replace", evidence: "missing out monthly meeting" },
        ]),
      },
      revisionFrom: { [SUN_MEETING]: { coaching_details: "Observed:\nPerrin missed the monthly meeting." } },
    },
  },
  {
    ...byId("sun-late-date"),
    id: "sun-late-date-drift",
    // QA: the account is her X, or nothing is written (the old path's honest reply); never text about the form.
    expect: {
      says: "the drift (text about the form) is never written and nothing is claimed; her X is written, or the old refusal stands",
      check: (run) =>
        /a prior coaching document exists/i.test(run.saved.coaching_details ?? "")
          ? `the drift was written: "${(run.saved.coaching_details ?? "").slice(0, 120)}"`
          : /\b(?:updated|changed)\b/i.test(run.reply) && !/haven't changed|didn't change/i.test(run.reply)
            ? `a change is claimed: "${run.reply.slice(0, 120)}"`
            : null,
    },
    script: {
      patch: {
        [SUN_LATE]: patch("this_form", [
          { field: "coaching_details", value: "Observed:\nA prior coaching document exists for Thaddeus, but it did not list the policy associated with it.", how: "replace", evidence: "make it about showing up late" },
        ]),
      },
      revisionFrom: { [SUN_LATE]: { coaching_details: "Observed:\nThaddeus showed up late." } },
    },
  },
  {
    ...byId("sun-make-that-update"),
    id: "sun-make-that-update-live-shape",
    script: {
      ...byId("sun-make-that-update").script,
      patch: {
        ...byId("sun-make-that-update").script.patch,
        [ROOM_PROCESS]: patch("this_form", [
          {
            field: "coaching_details",
            value: `Observed:\nReviewed the process for ${ROOM_PROCESS.split(": ")[1]!.split(",")[0]}, including ${ROOM_STEPS.split(",")[0]}.`,
            how: "replace",
            evidence: ROOM_STEPS,
          },
        ]),
      },
      // The old path's revision writes the process she gave (QA's OFF run passed this case).
      revisionFrom: { [ROOM_PROCESS]: { coaching_details: ROOM_STEPS } },
    },
  },
];

export const NOV7_STEP_B_REFUSAL_CASES: readonly ReplayCase[] = [...STEP_B_REFUSAL_SCENARIOS, ...LIVE_SHAPES].map(
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
