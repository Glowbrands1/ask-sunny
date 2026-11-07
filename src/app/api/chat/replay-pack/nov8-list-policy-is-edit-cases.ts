import type { ReplayCase } from "./cases";
import { play } from "./nov7-step-b-refusals-cases";
import { STEP_B_READER_FLAGS, STEP_B_REFUSAL_SCENARIOS, patch, type RefusalScenario } from "./nov7-step-b-refusals-scenarios";

/**
 * ============================================================================
 * "PLEASE LIST THE POLICY" ON ITS OWN, WITH THE DRAFT OPEN, IS AN EDIT (QA, 8 Nov 2026)
 * ============================================================================
 *
 * sun-late-date's wording (Ask Sunny, 6–7 Nov 2026; the production chats hold no "list the policy" message on its own),
 * the ask said alone after Create: "please list the policy" read as a question (QUESTION_NOT_FORM), skipped the edit
 * path and was answered as a general policy question, so EDIT_POLICY_ASK never listed it. LIST_POLICY_IS_EDIT_ENABLED
 * hands the turn to the edit path. Guard: "what policy covers lateness?" with the draft open is still answered as a
 * question and writes nothing. The person is the scenario's invented one.
 */

const lateDate = STEP_B_REFUSAL_SCENARIOS.find((scenario) => scenario.id === "sun-late-date")!;
const FLAGS = [...STEP_B_READER_FLAGS, "QUESTION_NOT_FORM_ENABLED", "EDIT_POLICY_ASK_ENABLED", "LIST_POLICY_IS_EDIT_ENABLED"];
const POLICY_LINE = /Policy reference:\s*[^\n]*JBA Policy Manual/i;
const ALONE = "please list the policy";
const QUESTION = "what policy covers lateness?";
const DETAILS = "Thaddeus Lowestoft showed up late to her shift.";

const SCENARIOS: readonly (RefusalScenario & { readonly status: ReplayCase["status"]; readonly flags: readonly string[] })[] = [
  {
    ...lateDate,
    id: "alone",
    refused: ALONE,
    steps: [lateDate.steps[0]!, lateDate.steps[1]!, { say: ALONE }],
    status: { open: "\"please list the policy\" is answered as a general policy question; nothing is listed on the form" },
    flags: FLAGS,
    script: {
      draft: { coaching_details: DETAILS },
      patch: { [ALONE]: { ...patch("this_form", []), policy_asked: true } as never },
    },
    expect: {
      says: "the policy line is listed on Details, and the reply says so",
      check: (run) =>
        !POLICY_LINE.test(run.saved.coaching_details ?? "")
          ? `no policy line on Details: "${(run.saved.coaching_details ?? "").slice(0, 160)}"`
          : !/Listed the policy|already lists the policy/i.test(run.reply)
            ? `the reply does not say what happened to the policy: "${run.reply.slice(0, 200)}"`
            : null,
    },
  },
  {
    ...lateDate,
    id: "question-still-answered",
    refused: QUESTION,
    steps: [lateDate.steps[0]!, lateDate.steps[1]!, { say: QUESTION }],
    status: "fixed",
    flags: FLAGS,
    script: {
      draft: { coaching_details: DETAILS },
      patch: { [QUESTION]: { ...patch("question", []), policy_asked: false } as never },
    },
    expect: {
      says: "guard: a question about the policy is answered and writes nothing",
      check: (run) =>
        POLICY_LINE.test(run.saved.coaching_details ?? "")
          ? `a policy line written for a question: "${(run.saved.coaching_details ?? "").slice(0, 160)}"`
          : /Listed the policy/i.test(run.reply)
            ? `the question was read as the ask: "${run.reply.slice(0, 200)}"`
            : null,
    },
  },
];

export const NOV8_LIST_POLICY_IS_EDIT_CASES: readonly ReplayCase[] = SCENARIOS.map(
  (scenario): ReplayCase => ({
    id: `nov8-list-policy-is-edit-${scenario.id}`,
    title: `"${scenario.refused}" with the Coaching draft open — ${scenario.expect.says}`,
    report: "QA, 8 Nov 2026: \"please list the policy\" on its own with a form open is answered as a general policy question",
    status: scenario.status,
    fixFlags: [...scenario.flags],
    run: (t) => play(t, scenario),
  }),
);
