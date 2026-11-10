import type { ReplayCase } from "./cases";
import { play } from "./nov7-step-b-refusals-cases";
import { STEP_B_READER_FLAGS, STEP_B_REFUSAL_SCENARIOS, patch, type RefusalScenario } from "./nov7-step-b-refusals-scenarios";

/**
 * ============================================================================
 * AN OPEN VERB INSIDE AN EDIT NEVER REOPENS THE FORM ALREADY OPEN (QA's Sunny round-4 gate, 8 Nov 2026)
 * ============================================================================
 *
 * nov7-refusal-sun-msb-format, turn 3, with REOPEN_BY_ANY_OPEN_VERB on: "I need the CA for the Must see behaviors
 * and not the standard of conduct. Make it in the format that I explained above in the first chat for <name>." with
 * that CA open was answered "The Corrective Action Form for <A> is still a draft, so it's open to edit." with no edit:
 * "see" (Must see behaviors) read as a show verb and "the CA" as the form. In QA's gated tree the edit path handed the
 * turn off; here Step B's reading of it is scripted to hand off ("other"), so the turn reaches the reopen path as it
 * did there. REOPEN_NOT_OPEN_FORM_ENABLED lets the reopen step aside. The guard ("show me the draft" still opens it)
 * is a unit test (`forms/reopen-not-open-form.test.ts`): in the pack that turn is taken by the revision path first.
 * The person is the scenario's invented one.
 */
const msb = STEP_B_REFUSAL_SCENARIOS.find((scenario) => scenario.id === "sun-msb-format")!;
const STILL_A_DRAFT = /is still a draft, so it['’]s open to edit/i;
const BASE = [...STEP_B_READER_FLAGS, "REOPEN_BY_ANY_OPEN_VERB_ENABLED"];

const handedOff = (said: string) => ({ ...msb.script, patch: { ...(msb.script.patch ?? {}), [said]: patch("other", []) } });

const SCENARIOS: readonly (RefusalScenario & { readonly status: ReplayCase["status"]; readonly flags: readonly string[] })[] = [
  {
    ...msb,
    id: "msb-format",
    status: "fixed",
    flags: [...BASE, "REOPEN_NOT_OPEN_FORM_ENABLED"],
    script: handedOff(msb.refused),
    expect: {
      says: "the reply is never the reopen's \"still a draft, so it's open to edit\"",
      check: (run) => (STILL_A_DRAFT.test(run.reply) ? `the reopen answered an edit: "${run.reply.slice(0, 200)}"` : null),
    },
  },
];

export const NOV8_REOPEN_NOT_OPEN_FORM_CASES: readonly ReplayCase[] = SCENARIOS.map(
  (scenario): ReplayCase => ({
    id: `nov8-reopen-not-open-form-${scenario.id}`,
    title: `"${scenario.refused.slice(0, 80)}" with the CA open — ${scenario.expect.says}`,
    report: "QA's Sunny round-4 gate, 8 Nov 2026: REOPEN_BY_ANY_OPEN_VERB answered an edit of the open CA as a reopen",
    status: scenario.status,
    fixFlags: [...scenario.flags],
    run: (t) => play(t, scenario),
  }),
);
